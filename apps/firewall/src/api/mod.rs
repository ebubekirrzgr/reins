use crate::{
    approvals::Outcome,
    db::{self, Intent},
    engine,
    policy::{self, Policy},
    state::AppState,
};
use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{collections::HashMap, time::Duration};
use tower_http::cors::{Any, CorsLayer};

pub struct ApiError(StatusCode, String);

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(json!({ "error": self.1 }))).into_response()
    }
}

impl From<anyhow::Error> for ApiError {
    fn from(e: anyhow::Error) -> Self {
        ApiError(StatusCode::INTERNAL_SERVER_ERROR, format!("{e:#}"))
    }
}

fn bad(msg: impl Into<String>) -> ApiError {
    ApiError(StatusCode::BAD_REQUEST, msg.into())
}

fn check_key(headers: &HeaderMap, header: &str, expected: &str) -> Result<(), ApiError> {
    let got = headers.get(header).and_then(|v| v.to_str().ok()).unwrap_or("");
    if got == expected {
        Ok(())
    } else {
        Err(ApiError(StatusCode::UNAUTHORIZED, format!("missing or invalid {header}")))
    }
}

pub fn router(st: AppState) -> Router {
    let cors = CorsLayer::new().allow_origin(Any).allow_methods(Any).allow_headers(Any);
    Router::new()
        .route("/health", get(health))
        .route("/v1/status", get(status))
        .route("/v1/intents", post(create_intent).get(list_intents))
        .route("/v1/intents/{id}", get(get_intent))
        .route("/v1/x402/fetch", post(x402_fetch))
        .route("/v1/audit", get(list_audit))
        .route("/v1/admin/pause", post(pause))
        .route("/v1/admin/resume", post(resume))
        .route("/v1/admin/policy", get(get_policy).put(put_policy))
        .route("/v1/admin/decide/{id}", post(decide))
        .route("/v1/admin/refresh", post(refresh))
        .layer(cors)
        .with_state(st)
}

async fn health() -> Json<Value> {
    Json(json!({ "ok": true, "service": "reins-firewall" }))
}

fn intent_json(i: &Intent) -> Value {
    let mut v = serde_json::to_value(i).unwrap_or(Value::Null);
    v["amount_usdc"] = json!(policy::to_usdc(i.amount_atomic));
    v["reasons"] = serde_json::from_str(&i.reasons).unwrap_or(json!([]));
    v["x402"] = i.x402.as_deref().and_then(|s| serde_json::from_str(s).ok()).unwrap_or(Value::Null);
    v
}

async fn status(State(st): State<AppState>) -> Result<Json<Value>, ApiError> {
    let delegation = st.chain.find_delegation(false).await.ok().flatten();
    let now = db::now();
    let spent_today = db::spent_since(&st.db, now - (now % 86_400)).await?;
    let owner = delegation.as_ref().map(|d| d.delegator.clone()).or_else(|| st.cfg.owner_pubkey.clone());
    let owner_usdc = match owner.as_deref().and_then(|o| engine::parse_address(o).ok()) {
        Some(a) => st.chain.usdc_balance(&a).await.ok(),
        None => None,
    };
    let hot_usdc = st.chain.usdc_balance(&st.chain.delegate_address()).await.ok();
    let sol = st.chain.sol_balance().await.ok();
    Ok(Json(json!({
        "delegate": st.chain.delegate_address().to_string(),
        "delegate_sol": sol.map(|l| l as f64 / 1e9),
        "hot_wallet_usdc": hot_usdc.map(policy::to_usdc),
        "owner": owner,
        "owner_usdc": owner_usdc.map(policy::to_usdc),
        "mint": st.cfg.usdc_mint,
        "paused": engine::is_paused(&st).await,
        "spent_today_usdc": policy::to_usdc(spent_today),
        "delegation": delegation,
        "telegram": st.bot.is_some(),
        "telegram_chat_bound": match &st.bot { Some(b) => b.owner_chat_id.read().await.is_some(), None => false },
        "approval_timeout_sec": st.cfg.approval_timeout_sec,
        "policy": engine::load_policy(&st).await,
    })))
}

#[derive(Deserialize)]
struct CreateIntent {
    #[serde(default = "default_kind")]
    kind: String,
    to: Option<String>,
    amount: Option<Value>,
    #[serde(default)]
    memo: String,
    #[serde(default = "default_agent")]
    agent_id: String,
}
fn default_kind() -> String {
    "transfer".into()
}
fn default_agent() -> String {
    "agent".into()
}

fn parse_amount(v: &Value) -> Result<i64, ApiError> {
    let usdc: f64 = match v {
        Value::Number(n) => n.as_f64().ok_or_else(|| bad("amount"))?,
        Value::String(s) => s.trim().parse().map_err(|_| bad(format!("amount '{s}' is not a number")))?,
        _ => return Err(bad("amount must be a number or string, in USDC")),
    };
    if !(usdc > 0.0) || usdc > 1_000_000.0 {
        return Err(bad("amount out of range"));
    }
    Ok(policy::to_atomic(usdc))
}

async fn create_intent(State(st): State<AppState>, headers: HeaderMap, Json(body): Json<CreateIntent>) -> Result<(StatusCode, Json<Value>), ApiError> {
    check_key(&headers, "x-agent-key", &st.cfg.agent_api_key)?;
    if body.kind != "transfer" {
        return Err(bad("kind must be 'transfer' (use /v1/x402/fetch for paid HTTP)"));
    }
    let to = body.to.as_deref().ok_or_else(|| bad("'to' is required"))?;
    let to_addr = engine::parse_address(to).map_err(|e| bad(e.to_string()))?;
    let amount = parse_amount(body.amount.as_ref().ok_or_else(|| bad("'amount' is required"))?)?;
    let now = db::now();
    let intent = Intent {
        id: uuid::Uuid::new_v4().to_string(),
        agent_id: body.agent_id.chars().take(64).collect(),
        kind: "transfer".into(),
        to_address: Some(to_addr.to_string()),
        url: None,
        method: None,
        amount_atomic: amount,
        memo: Some(body.memo.chars().take(500).collect()),
        status: "pending".into(),
        decision: None,
        decided_by: None,
        risk: 0,
        reasons: "[]".into(),
        signature: None,
        x402: None,
        error: None,
        tg_message_id: None,
        created_at: now,
        updated_at: now,
    };
    db::insert_intent(&st.db, &intent).await?;
    db::audit(&st.db, Some(&intent.id), "created", json!({ "kind": "transfer", "to": to_addr.to_string(), "amount_atomic": amount, "agent": intent.agent_id })).await?;

    // Run the lifecycle in the background; the agent polls GET /v1/intents/:id?wait=25
    let st2 = st.clone();
    let i2 = intent.clone();
    tokio::spawn(async move {
        if let Err(e) = engine::decide_and_execute(&st2, &i2, &to_addr).await {
            tracing::error!(id = %i2.id, "intent lifecycle error: {e:#}");
            let _ = db::set_failed(&st2.db, &i2.id, &format!("{e:#}")).await;
        }
    });
    // give the policy engine a moment so fast ALLOW/DENY verdicts come back inline
    tokio::time::sleep(Duration::from_millis(300)).await;
    let latest = db::get_intent(&st.db, &intent.id).await?.unwrap_or(intent);
    Ok((StatusCode::ACCEPTED, Json(intent_json(&latest))))
}

#[derive(Deserialize)]
struct WaitQ {
    wait: Option<u64>,
}

async fn get_intent(State(st): State<AppState>, Path(id): Path<String>, Query(q): Query<WaitQ>) -> Result<Json<Value>, ApiError> {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(q.wait.unwrap_or(0).min(60));
    loop {
        let Some(i) = db::get_intent(&st.db, &id).await? else {
            return Err(ApiError(StatusCode::NOT_FOUND, "intent not found".into()));
        };
        if i.is_terminal() || tokio::time::Instant::now() >= deadline {
            return Ok(Json(intent_json(&i)));
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
}

#[derive(Deserialize)]
struct LimitQ {
    limit: Option<i64>,
}

async fn list_intents(State(st): State<AppState>, Query(q): Query<LimitQ>) -> Result<Json<Value>, ApiError> {
    let rows = db::list_intents(&st.db, q.limit.unwrap_or(50).clamp(1, 500)).await?;
    Ok(Json(json!(rows.iter().map(intent_json).collect::<Vec<_>>())))
}

async fn list_audit(State(st): State<AppState>, Query(q): Query<LimitQ>) -> Result<Json<Value>, ApiError> {
    let rows = db::list_audit(&st.db, q.limit.unwrap_or(100).clamp(1, 1000)).await?;
    Ok(Json(json!(rows
        .iter()
        .map(|r| json!({ "id": r.id, "ts": r.ts, "intent_id": r.intent_id, "event": r.event, "detail": serde_json::from_str::<Value>(&r.detail).unwrap_or(Value::Null) }))
        .collect::<Vec<_>>())))
}

#[derive(Deserialize)]
struct X402Fetch {
    url: String,
    #[serde(default = "default_get")]
    method: String,
    headers: Option<HashMap<String, String>>,
    body: Option<Value>,
    max_amount: Option<Value>,
    #[serde(default = "default_agent")]
    agent_id: String,
    #[serde(default)]
    memo: String,
}
fn default_get() -> String {
    "GET".into()
}

async fn x402_fetch(State(st): State<AppState>, headers: HeaderMap, Json(body): Json<X402Fetch>) -> Result<Json<Value>, ApiError> {
    check_key(&headers, "x-agent-key", &st.cfg.agent_api_key)?;
    let url = url_check(&body.url)?;
    let max_amount = body.max_amount.as_ref().map(parse_amount).transpose()?;
    let raw_body = body.body.as_ref().map(|b| match b {
        Value::String(s) => s.clone(),
        other => other.to_string(),
    });
    let now = db::now();
    let intent = Intent {
        id: uuid::Uuid::new_v4().to_string(),
        agent_id: body.agent_id.chars().take(64).collect(),
        kind: "x402".into(),
        to_address: None,
        url: Some(url.clone()),
        method: Some(body.method.to_uppercase()),
        amount_atomic: 0,
        memo: Some(body.memo.chars().take(500).collect()),
        status: "pending".into(),
        decision: None,
        decided_by: None,
        risk: 0,
        reasons: "[]".into(),
        signature: None,
        x402: None,
        error: None,
        tg_message_id: None,
        created_at: now,
        updated_at: now,
    };
    db::insert_intent(&st.db, &intent).await?;
    db::audit(&st.db, Some(&intent.id), "created", json!({ "kind": "x402", "url": url, "method": intent.method, "agent": intent.agent_id })).await?;

    let result = engine::run_x402(&st, &intent, body.headers, raw_body, max_amount).await;
    let latest = match result {
        Ok(i) => i,
        Err(e) => {
            db::set_failed(&st.db, &intent.id, &format!("{e:#}")).await?;
            db::get_intent(&st.db, &intent.id).await?.unwrap_or(intent)
        }
    };
    let mut v = intent_json(&latest);
    // surface the upstream response at top level for convenience
    if let Some(resp) = v["x402"].get("response").cloned() {
        v["response"] = resp;
    }
    Ok(Json(v))
}

fn url_check(u: &str) -> Result<String, ApiError> {
    let u = u.trim();
    if !(u.starts_with("http://") || u.starts_with("https://")) || u.len() > 2048 {
        return Err(bad("url must be http(s)"));
    }
    Ok(u.to_string())
}

// ---------------- admin ----------------

async fn pause(State(st): State<AppState>, headers: HeaderMap) -> Result<Json<Value>, ApiError> {
    check_key(&headers, "x-admin-key", &st.cfg.admin_api_key)?;
    db::set_setting(&st.db, "paused", "1").await?;
    db::audit(&st.db, None, "paused", json!({})).await?;
    Ok(Json(json!({ "paused": true })))
}

async fn resume(State(st): State<AppState>, headers: HeaderMap) -> Result<Json<Value>, ApiError> {
    check_key(&headers, "x-admin-key", &st.cfg.admin_api_key)?;
    db::set_setting(&st.db, "paused", "0").await?;
    db::audit(&st.db, None, "resumed", json!({})).await?;
    Ok(Json(json!({ "paused": false })))
}

async fn get_policy(State(st): State<AppState>) -> Json<Policy> {
    Json(engine::load_policy(&st).await)
}

async fn put_policy(State(st): State<AppState>, headers: HeaderMap, Json(p): Json<Policy>) -> Result<Json<Policy>, ApiError> {
    check_key(&headers, "x-admin-key", &st.cfg.admin_api_key)?;
    engine::save_policy(&st, &p).await?;
    db::audit(&st.db, None, "policy_updated", serde_json::to_value(&p).unwrap_or(Value::Null)).await?;
    Ok(Json(p))
}

#[derive(Deserialize)]
struct Decide {
    approve: bool,
    #[serde(default)]
    trust: bool,
}

async fn decide(State(st): State<AppState>, headers: HeaderMap, Path(id): Path<String>, Json(d): Json<Decide>) -> Result<Json<Value>, ApiError> {
    check_key(&headers, "x-admin-key", &st.cfg.admin_api_key)?;
    let outcome = match (d.approve, d.trust) {
        (true, true) => Outcome::ApprovedAndTrust,
        (true, false) => Outcome::Approved,
        (false, _) => Outcome::Rejected,
    };
    let ok = st.approvals.resolve(&id, outcome).await;
    if ok {
        db::audit(&st.db, Some(&id), if d.approve { "approved" } else { "rejected" }, json!({ "by": "dashboard" })).await?;
        if let (Some(bot), Some(i)) = (&st.bot, db::get_intent(&st.db, &id).await?) {
            if let (Some(chat), Some(mid)) = (*bot.owner_chat_id.read().await, i.tg_message_id) {
                let _ = bot.edit(chat, mid, &format!("{} via dashboard — {}", if d.approve { "✅ Approved" } else { "❌ Rejected" }, policy::fmt_usdc(i.amount_atomic))).await;
            }
        }
    }
    Ok(Json(json!({ "resolved": ok })))
}

async fn refresh(State(st): State<AppState>, headers: HeaderMap) -> Result<Json<Value>, ApiError> {
    check_key(&headers, "x-admin-key", &st.cfg.admin_api_key)?;
    let d = st.chain.find_delegation(true).await?;
    Ok(Json(json!({ "delegation": d })))
}
