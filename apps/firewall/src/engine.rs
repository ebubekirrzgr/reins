//! Orchestrator: evaluate -> (ask owner) -> execute -> audit. Shared by the transfer and x402 paths.
use crate::{
    approvals::{telegram::{esc, short}, Outcome},
    chain::DelegationView,
    db::{self, Intent},
    policy::{self, Context, Decision, Policy, Request, Verdict},
    state::AppState,
    x402::{Expected, Req},
};
use anyhow::{anyhow, Result};
use serde_json::json;
use solana_address::Address;
use std::{collections::HashMap, str::FromStr, time::Duration};

pub async fn load_policy(st: &AppState) -> Policy {
    match db::get_setting(&st.db, "policy").await.ok().flatten() {
        Some(raw) => serde_json::from_str(&raw).unwrap_or_default(),
        None => Policy::default(),
    }
}

pub async fn save_policy(st: &AppState, p: &Policy) -> Result<()> {
    db::set_setting(&st.db, "policy", &serde_json::to_string(p)?).await
}

pub async fn is_paused(st: &AppState) -> bool {
    db::get_setting(&st.db, "paused").await.ok().flatten().as_deref() == Some("1")
}

async fn build_context(st: &AppState, intent: &Intent, delegation: Option<&DelegationView>) -> Result<Context> {
    let now = db::now();
    let day_start = now - (now % 86_400);
    Ok(Context {
        paused: is_paused(st).await,
        spent_today_atomic: db::spent_since(&st.db, day_start).await? - intent.amount_atomic, // exclude self
        intents_last_minute: db::count_since(&st.db, &intent.agent_id, now - 60).await?,
        recipient_seen_before: match &intent.to_address {
            Some(to) => db::paid_recipient_before(&st.db, to).await?,
            None => false,
        },
        onchain_remaining_atomic: delegation.map(|d| d.remaining_in_period),
    })
}

/// Full lifecycle for an intent whose amount + recipient are known. Updates DB as it goes.
/// For x402 intents, `receiver` is the delegate's own wallet (JIT funding) and the actual
/// x402 payment happens in `run_x402` after this returns `settled`.
pub async fn decide_and_execute(st: &AppState, intent: &Intent, receiver: &Address) -> Result<Intent> {
    let policy = load_policy(st).await;
    let delegation = st.chain.find_delegation(false).await.unwrap_or_else(|e| {
        tracing::warn!("delegation lookup failed: {e}");
        None
    });
    let ctx = build_context(st, intent, delegation.as_ref()).await?;
    let req = Request {
        amount_atomic: intent.amount_atomic,
        recipient: intent.to_address.as_deref().unwrap_or(""),
        memo: intent.memo.as_deref().unwrap_or(""),
        url: intent.url.as_deref(),
    };
    let verdict: Verdict = policy::evaluate(&policy, &req, &ctx);
    tracing::info!(id = %intent.id, decision = verdict.decision.as_str(), risk = verdict.risk, "policy verdict");

    let status = match verdict.decision {
        Decision::Allow => "allowed",
        Decision::Ask => "awaiting_approval",
        Decision::Deny => "denied",
    };
    db::set_decision(&st.db, &intent.id, status, verdict.decision.as_str(), "policy", verdict.risk, &verdict.reasons).await?;
    db::audit(&st.db, Some(&intent.id), "decided", json!({ "decision": verdict.decision, "risk": verdict.risk, "reasons": verdict.reasons })).await?;

    let approved_by = match verdict.decision {
        Decision::Deny => return finish(st, &intent.id).await,
        Decision::Allow => "policy",
        Decision::Ask => match ask_owner(st, intent, &verdict, &ctx, delegation.as_ref()).await? {
            Outcome::Approved => "owner",
            Outcome::ApprovedAndTrust => {
                if let Some(to) = &intent.to_address {
                    let mut p = load_policy(st).await;
                    if !p.trusted_recipients.contains(to) {
                        p.trusted_recipients.push(to.clone());
                        save_policy(st, &p).await?;
                        db::audit(&st.db, Some(&intent.id), "trusted_recipient_added", json!({ "recipient": to })).await?;
                    }
                }
                "owner"
            }
            Outcome::Rejected => {
                db::set_decided_by(&st.db, &intent.id, "denied", "owner").await?;
                db::audit(&st.db, Some(&intent.id), "rejected", json!({ "by": "owner" })).await?;
                return finish(st, &intent.id).await;
            }
            Outcome::Timeout => {
                db::set_decided_by(&st.db, &intent.id, "expired", "timeout").await?;
                db::audit(&st.db, Some(&intent.id), "timeout", json!({ "after_sec": st.cfg.approval_timeout_sec })).await?;
                return finish(st, &intent.id).await;
            }
        },
    };

    // --- execute on-chain ---------------------------------------------------
    let Some(delegation) = delegation else {
        db::set_failed(&st.db, &intent.id, "no active delegation").await?;
        return finish(st, &intent.id).await;
    };
    db::set_decided_by(&st.db, &intent.id, "executing", approved_by).await?;
    match st.chain.transfer_recurring(&delegation, receiver, intent.amount_atomic as u64).await {
        Ok(sig) => {
            db::set_settled(&st.db, &intent.id, &sig).await?;
            db::audit(&st.db, Some(&intent.id), "executed", json!({ "signature": sig, "amount_atomic": intent.amount_atomic, "receiver": receiver.to_string() })).await?;
        }
        Err(e) => {
            tracing::error!(id = %intent.id, "execution failed: {e:#}");
            db::set_failed(&st.db, &intent.id, &format!("{e:#}")).await?;
            db::audit(&st.db, Some(&intent.id), "failed", json!({ "error": format!("{e:#}") })).await?;
        }
    }
    finish(st, &intent.id).await
}

async fn finish(st: &AppState, id: &str) -> Result<Intent> {
    db::get_intent(&st.db, id).await?.ok_or_else(|| anyhow!("intent vanished"))
}

async fn ask_owner(st: &AppState, intent: &Intent, v: &Verdict, ctx: &Context, delegation: Option<&DelegationView>) -> Result<Outcome> {
    let rx = st.approvals.register(&intent.id).await;
    let Some(bot) = &st.bot else {
        tracing::warn!("ASK but no Telegram bot configured; waiting for dashboard decision only");
        db::audit(&st.db, Some(&intent.id), "asked", json!({ "channel": "dashboard" })).await?;
        return Ok(st.approvals.wait(&intent.id, rx, Duration::from_secs(st.cfg.approval_timeout_sec)).await);
    };
    let chat_id = *bot.owner_chat_id.read().await;
    let Some(chat_id) = chat_id else {
        tracing::warn!("ASK but TELEGRAM_OWNER_CHAT_ID unknown: send /start to the bot. Falling back to dashboard approval.");
        return Ok(st.approvals.wait(&intent.id, rx, Duration::from_secs(st.cfg.approval_timeout_sec)).await);
    };

    let kind = if intent.kind == "x402" { "x402 payment" } else { "transfer" };
    let mut text = format!(
        "🛡 <b>REINS — approval needed</b>\n\n<b>Agent:</b> {}\n<b>Type:</b> {}\n<b>Amount:</b> {}\n<b>To:</b> <code>{}</code>\n",
        esc(&intent.agent_id),
        kind,
        policy::fmt_usdc(intent.amount_atomic),
        esc(intent.to_address.as_deref().unwrap_or("?")),
    );
    if let Some(u) = &intent.url {
        text.push_str(&format!("<b>URL:</b> {}\n", esc(u)));
    }
    if let Some(m) = intent.memo.as_deref().filter(|m| !m.is_empty()) {
        text.push_str(&format!("<b>Memo:</b> “{}”\n", esc(m)));
    }
    text.push_str(&format!("\n<b>Risk:</b> {}/100\n", v.risk));
    for r in &v.reasons {
        text.push_str(&format!("• {}\n", esc(r)));
    }
    text.push_str(&format!("\n<b>Spent today:</b> {}\n", policy::fmt_usdc(ctx.spent_today_atomic)));
    if let Some(d) = delegation {
        text.push_str(&format!(
            "<b>On-chain cap left this period:</b> {} of {}\n",
            policy::fmt_usdc(d.remaining_in_period),
            policy::fmt_usdc(d.amount_per_period)
        ));
    }
    text.push_str(&format!("\n⏱ Auto-reject in {} min.  id <code>{}</code>", st.cfg.approval_timeout_sec / 60, short(&intent.id)));

    let kb = vec![
        vec![("✅ Approve".to_string(), format!("ap:{}", intent.id)), ("❌ Reject".to_string(), format!("rj:{}", intent.id))],
        vec![("✅ Approve + trust this recipient".to_string(), format!("tr:{}", intent.id))],
    ];
    match bot.send(chat_id, &text, Some(kb)).await {
        Ok(mid) => {
            db::set_tg_message(&st.db, &intent.id, mid).await?;
            db::audit(&st.db, Some(&intent.id), "asked", json!({ "channel": "telegram", "message_id": mid })).await?;
        }
        Err(e) => {
            tracing::error!("telegram send failed: {e}");
            db::audit(&st.db, Some(&intent.id), "asked", json!({ "channel": "telegram", "error": e.to_string() })).await?;
        }
    }
    let outcome = st.approvals.wait(&intent.id, rx, Duration::from_secs(st.cfg.approval_timeout_sec)).await;
    if outcome == Outcome::Timeout {
        if let Some(mid) = db::get_intent(&st.db, &intent.id).await?.and_then(|i| i.tg_message_id) {
            let _ = bot.edit(chat_id, mid, &format!("{text}\n\n⌛ <b>Expired</b> — auto-rejected after {} min.", st.cfg.approval_timeout_sec / 60)).await;
        }
    }
    Ok(outcome)
}

/// x402 path: quote -> decide/execute (JIT-fund the delegate ATA) -> pay via sidecar.
pub async fn run_x402(st: &AppState, intent: &Intent, headers: Option<HashMap<String, String>>, body: Option<String>, max_amount_atomic: Option<i64>) -> Result<Intent> {
    let url = intent.url.clone().unwrap_or_default();
    let method = intent.method.clone().unwrap_or_else(|| "GET".into());
    let req = Req { url: &url, method: &method, headers: headers.as_ref(), body: body.as_deref(), expected: None };

    // 1. quote (never pays)
    let quote = st.sidecar.quote(&req).await?;
    if !quote.payment_required {
        db::set_x402(&st.db, &intent.id, &json!({ "quote": { "paymentRequired": false, "status": quote.status }, "response": { "status": quote.status, "body": quote.body, "contentType": quote.content_type } })).await?;
        db::set_decision(&st.db, &intent.id, "settled", "allow", "policy", 0, &["upstream did not require payment".into()]).await?;
        db::audit(&st.db, Some(&intent.id), "no_payment_required", json!({ "status": quote.status })).await?;
        return finish(st, &intent.id).await;
    }
    let Some(sel) = quote.selected.clone() else {
        db::set_failed(&st.db, &intent.id, "upstream requires payment but offers no Solana `exact` option").await?;
        return finish(st, &intent.id).await;
    };
    if sel.asset != st.cfg.usdc_mint {
        db::set_failed(&st.db, &intent.id, &format!("upstream wants asset {} but firewall only handles USDC {}", sel.asset, st.cfg.usdc_mint)).await?;
        return finish(st, &intent.id).await;
    }
    let amount: i64 = sel.amount.parse().map_err(|_| anyhow!("bad amount in quote: {}", sel.amount))?;
    db::set_amount(&st.db, &intent.id, amount, &sel.pay_to).await?;
    db::set_x402(&st.db, &intent.id, &json!({ "quote": sel })).await?;
    db::audit(&st.db, Some(&intent.id), "quoted", json!({ "amount_atomic": amount, "payTo": sel.pay_to, "network": sel.network })).await?;

    if let Some(max) = max_amount_atomic {
        if amount > max {
            db::set_decision(&st.db, &intent.id, "denied", "deny", "policy", 100, &[format!("quoted {} exceeds agent max_amount {}", policy::fmt_usdc(amount), policy::fmt_usdc(max))]).await?;
            return finish(st, &intent.id).await;
        }
    }

    // 2. decide + JIT-fund the hot wallet from the owner's allowance
    let intent = db::get_intent(&st.db, &intent.id).await?.ok_or_else(|| anyhow!("intent vanished"))?;
    let delegate = st.chain.delegate_address();
    let intent = decide_and_execute(st, &intent, &delegate).await?;
    if intent.status != "settled" {
        return Ok(intent);
    }
    let funding_sig = intent.signature.clone();

    // 3. standard x402 payment from the hot wallet, pinned to the approved terms
    db::set_status(&st.db, &intent.id, "executing").await?;
    let req = Req {
        url: &url,
        method: &method,
        headers: headers.as_ref(),
        body: body.as_deref(),
        expected: Some(Expected { amount: sel.amount.clone(), pay_to: sel.pay_to.clone(), asset: sel.asset.clone() }),
    };
    match st.sidecar.pay(&req).await {
        Ok(pay) if pay.status >= 400 => {
            db::set_failed(&st.db, &intent.id, &format!("upstream returned {} after payment (funding tx {funding_sig:?})", pay.status)).await?;
            db::audit(&st.db, Some(&intent.id), "x402_failed", json!({ "status": pay.status, "funding_signature": funding_sig })).await?;
        }
        Ok(pay) => {
            let settle_tx = pay.settle.as_ref().and_then(|s| s.get("transaction")).and_then(|t| t.as_str()).map(|s| s.to_string());
            db::set_x402(&st.db, &intent.id, &json!({ "quote": sel, "funding_signature": funding_sig, "settle": pay.settle, "response": { "status": pay.status, "body": pay.body, "contentType": pay.content_type } })).await?;
            if let Some(tx) = &settle_tx {
                db::set_signature(&st.db, &intent.id, tx).await?;
            }
            db::set_status(&st.db, &intent.id, "settled").await?;
            db::audit(&st.db, Some(&intent.id), "x402_paid", json!({ "status": pay.status, "settle_tx": settle_tx, "funding_signature": funding_sig })).await?;
        }
        Err(e) => {
            // Funds now sit in the hot wallet; they are not lost (owner can sweep), but flag loudly.
            db::set_failed(&st.db, &intent.id, &format!("x402 payment failed after funding ({funding_sig:?}): {e:#}")).await?;
            db::audit(&st.db, Some(&intent.id), "x402_failed", json!({ "error": format!("{e:#}"), "funding_signature": funding_sig })).await?;
        }
    }
    finish(st, &intent.id).await
}

pub fn parse_address(s: &str) -> Result<Address> {
    Address::from_str(s).map_err(|_| anyhow!("invalid Solana address: {s}"))
}
