mod api;
mod approvals;
mod chain;
mod config;
mod db;
mod engine;
mod policy;
mod state;
mod x402;

use anyhow::Result;
use approvals::{telegram::{Bot, Incoming}, Outcome};
use serde_json::json;
use state::AppState;
use std::sync::Arc;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> Result<()> {
    // Load .env from CWD and from the repo root (when run via `cargo run -p` from the root, CWD is the root).
    let _ = dotenvy::dotenv();
    let _ = dotenvy::from_filename("../../.env");
    tracing_subscriber::fmt().with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info,sqlx=warn,hyper=warn".into())).init();

    let cfg = Arc::new(config::Config::from_env()?);
    let db = db::connect(&cfg.database_url).await?;
    match db::expire_stale(&db).await {
        Ok(0) => {}
        Ok(n) => {
            tracing::warn!("closed {n} intent(s) left in-flight by the previous run");
            let _ = db::audit(&db, None, "restart_cleanup", json!({ "closed": n })).await;
        }
        Err(e) => tracing::warn!("stale intent cleanup failed: {e}"),
    }
    let chain = chain::Chain::new(&cfg.rpc_url, &cfg.delegate_keypair_path, &cfg.usdc_mint, cfg.owner_pubkey.as_deref())?;
    tracing::info!("delegate (firewall hot key) = {}", chain.delegate_address());

    let bot = match &cfg.telegram_bot_token {
        Some(token) => {
            let stored_chat = db::get_setting(&db, "owner_chat_id").await?.and_then(|s| s.parse::<i64>().ok());
            let bot = Bot::new(token.clone(), cfg.telegram_owner_chat_id.or(stored_chat));
            match bot.me().await {
                Ok(u) => tracing::info!("telegram bot @{u} ready (owner chat: {:?})", *bot.owner_chat_id.read().await),
                Err(e) => tracing::warn!("telegram getMe failed: {e}"),
            }
            Some(bot)
        }
        None => {
            tracing::warn!("TELEGRAM_BOT_TOKEN not set: ASK decisions can only be resolved from the dashboard");
            None
        }
    };

    let st = AppState { cfg: cfg.clone(), db: db.clone(), chain: chain.clone(), approvals: approvals::Hub::new(), bot: bot.clone(), sidecar: x402::Sidecar::new(&cfg.sidecar_url) };

    match chain.find_delegation(true).await {
        Ok(Some(d)) => tracing::info!("active delegation from {} : {} / period, {} left", d.delegator, policy::fmt_usdc(d.amount_per_period), policy::fmt_usdc(d.remaining_in_period)),
        Ok(None) => tracing::warn!("no active recurring delegation to the delegate yet — create one from the dashboard"),
        Err(e) => tracing::warn!("delegation lookup failed (RPC?): {e:#}"),
    }
    match st.sidecar.health().await {
        Ok(h) => tracing::info!("x402 sidecar ok: {h}"),
        Err(_) => tracing::warn!("x402 sidecar not reachable at {} (only needed for /v1/x402/fetch)", cfg.sidecar_url),
    }

    if let Some(bot) = bot {
        tokio::spawn(telegram_loop(st.clone(), bot));
    }

    let addr = format!("0.0.0.0:{}", cfg.port);
    tracing::info!("REINS firewall listening on http://{addr}");
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, api::router(st)).await?;
    Ok(())
}

async fn telegram_loop(st: AppState, bot: Bot) {
    let mut offset = 0i64;
    loop {
        let (updates, next) = match bot.poll(offset).await {
            Ok(x) => x,
            Err(e) => {
                tracing::warn!("telegram poll: {e}");
                tokio::time::sleep(std::time::Duration::from_secs(3)).await;
                continue;
            }
        };
        offset = next;
        for u in updates {
            match u {
                Incoming::Message { chat_id, text, from } => {
                    let bound = *bot.owner_chat_id.read().await;
                    if bound.is_none() {
                        *bot.owner_chat_id.write().await = Some(chat_id);
                        let _ = db::set_setting(&st.db, "owner_chat_id", &chat_id.to_string()).await;
                        let _ = db::audit(&st.db, None, "telegram_bound", json!({ "chat_id": chat_id, "from": from })).await;
                        let _ = bot.send(chat_id, &format!("👋 Hi {from}. This chat is now the <b>owner approval channel</b> for REINS.\nChat id: <code>{chat_id}</code> (put it in TELEGRAM_OWNER_CHAT_ID to pin it)."), None).await;
                    } else if bound == Some(chat_id) {
                        let reply = match text.trim() {
                            "/pause" => { let _ = db::set_setting(&st.db, "paused", "1").await; let _ = db::audit(&st.db, None, "paused", json!({"by":"telegram"})).await; "⏸ Firewall paused. Every request is denied until /resume.".to_string() }
                            "/resume" => { let _ = db::set_setting(&st.db, "paused", "0").await; let _ = db::audit(&st.db, None, "resumed", json!({"by":"telegram"})).await; "▶️ Firewall resumed.".to_string() }
                            "/status" => match st.chain.find_delegation(false).await {
                                Ok(Some(d)) => format!("Delegate <code>{}</code>\nCap: {} per period, {} left\nPaused: {}", st.chain.delegate_address(), policy::fmt_usdc(d.amount_per_period), policy::fmt_usdc(d.remaining_in_period), engine::is_paused(&st).await),
                                _ => "No active on-chain allowance.".to_string(),
                            },
                            _ => format!("Commands: /status /pause /resume\nChat id <code>{chat_id}</code>"),
                        };
                        let _ = bot.send(chat_id, &reply, None).await;
                    } else {
                        let _ = bot.send(chat_id, "This bot only talks to its owner.", None).await;
                    }
                }
                Incoming::Callback { id, chat_id, message_id, data } => {
                    let bound = *bot.owner_chat_id.read().await;
                    if bound != Some(chat_id) {
                        let _ = bot.answer_callback(&id, "not the owner").await;
                        continue;
                    }
                    let (action, intent_id) = data.split_once(':').unwrap_or(("", ""));
                    let outcome = match action {
                        "ap" => Outcome::Approved,
                        "tr" => Outcome::ApprovedAndTrust,
                        "rj" => Outcome::Rejected,
                        _ => { let _ = bot.answer_callback(&id, "unknown action").await; continue; }
                    };
                    let resolved = st.approvals.resolve(intent_id, outcome).await;
                    let label = match (resolved, outcome) {
                        (false, _) => "⌛ Too late — this request already expired or was decided.",
                        (true, Outcome::Rejected) => "❌ Rejected",
                        (true, Outcome::ApprovedAndTrust) => "✅ Approved — recipient marked trusted",
                        (true, _) => "✅ Approved — executing on-chain",
                    };
                    let _ = bot.answer_callback(&id, label).await;
                    let amount = db::get_intent(&st.db, intent_id).await.ok().flatten().map(|i| policy::fmt_usdc(i.amount_atomic)).unwrap_or_default();
                    let _ = bot.edit(chat_id, message_id, &format!("{label}\n{amount}  <code>{}</code>", approvals::telegram::short(intent_id))).await;
                    if resolved {
                        let _ = db::audit(&st.db, Some(intent_id), if matches!(outcome, Outcome::Rejected) { "rejected" } else { "approved" }, json!({ "by": "telegram", "trust": matches!(outcome, Outcome::ApprovedAndTrust) })).await;
                    }
                }
            }
        }
    }
}
