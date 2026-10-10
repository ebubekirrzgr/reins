use anyhow::Result;
use serde::{Deserialize, Serialize};
use sqlx::{sqlite::{SqliteConnectOptions, SqlitePoolOptions}, SqlitePool};
use std::str::FromStr;

pub type Db = SqlitePool;

pub fn now() -> i64 {
    chrono::Utc::now().timestamp()
}

pub async fn connect(url: &str) -> Result<Db> {
    let opts = SqliteConnectOptions::from_str(url)?.create_if_missing(true);
    let pool = SqlitePoolOptions::new().max_connections(5).connect_with(opts).await?;
    sqlx::migrate!("./migrations").run(&pool).await?;
    Ok(pool)
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Intent {
    pub id: String,
    pub agent_id: String,
    pub kind: String,
    pub to_address: Option<String>,
    pub url: Option<String>,
    pub method: Option<String>,
    pub amount_atomic: i64,
    pub memo: Option<String>,
    pub status: String,
    pub decision: Option<String>,
    pub decided_by: Option<String>,
    pub risk: i64,
    pub reasons: String,
    pub signature: Option<String>,
    pub x402: Option<String>,
    pub error: Option<String>,
    pub tg_message_id: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

impl Intent {
    pub fn is_terminal(&self) -> bool {
        matches!(self.status.as_str(), "denied" | "settled" | "failed" | "expired")
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct AuditRow {
    pub id: i64,
    pub ts: i64,
    pub intent_id: Option<String>,
    pub event: String,
    pub detail: String,
}

pub async fn insert_intent(db: &Db, i: &Intent) -> Result<()> {
    sqlx::query(
        "INSERT INTO intents (id, agent_id, kind, to_address, url, method, amount_atomic, memo, status, decision, decided_by, risk, reasons, signature, x402, error, tg_message_id, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    )
    .bind(&i.id).bind(&i.agent_id).bind(&i.kind).bind(&i.to_address).bind(&i.url).bind(&i.method)
    .bind(i.amount_atomic).bind(&i.memo).bind(&i.status).bind(&i.decision).bind(&i.decided_by).bind(i.risk)
    .bind(&i.reasons).bind(&i.signature).bind(&i.x402).bind(&i.error).bind(i.tg_message_id).bind(i.created_at).bind(i.updated_at)
    .execute(db).await?;
    Ok(())
}

pub async fn get_intent(db: &Db, id: &str) -> Result<Option<Intent>> {
    Ok(sqlx::query_as::<_, Intent>("SELECT * FROM intents WHERE id = ?").bind(id).fetch_optional(db).await?)
}

pub async fn list_intents(db: &Db, limit: i64) -> Result<Vec<Intent>> {
    Ok(sqlx::query_as::<_, Intent>("SELECT * FROM intents ORDER BY created_at DESC LIMIT ?").bind(limit).fetch_all(db).await?)
}

pub async fn set_status(db: &Db, id: &str, status: &str) -> Result<()> {
    sqlx::query("UPDATE intents SET status = ?, updated_at = ? WHERE id = ?").bind(status).bind(now()).bind(id).execute(db).await?;
    Ok(())
}

pub async fn set_decision(db: &Db, id: &str, status: &str, decision: &str, decided_by: &str, risk: i64, reasons: &[String]) -> Result<()> {
    sqlx::query("UPDATE intents SET status = ?, decision = ?, decided_by = ?, risk = ?, reasons = ?, updated_at = ? WHERE id = ?")
        .bind(status).bind(decision).bind(decided_by).bind(risk).bind(serde_json::to_string(reasons)?).bind(now()).bind(id)
        .execute(db).await?;
    Ok(())
}

pub async fn set_decided_by(db: &Db, id: &str, status: &str, decided_by: &str) -> Result<()> {
    sqlx::query("UPDATE intents SET status = ?, decided_by = ?, updated_at = ? WHERE id = ?")
        .bind(status).bind(decided_by).bind(now()).bind(id).execute(db).await?;
    Ok(())
}

pub async fn set_amount(db: &Db, id: &str, amount_atomic: i64, to_address: &str) -> Result<()> {
    sqlx::query("UPDATE intents SET amount_atomic = ?, to_address = ?, updated_at = ? WHERE id = ?")
        .bind(amount_atomic).bind(to_address).bind(now()).bind(id).execute(db).await?;
    Ok(())
}

pub async fn set_settled(db: &Db, id: &str, signature: &str) -> Result<()> {
    sqlx::query("UPDATE intents SET status = 'settled', signature = ?, updated_at = ? WHERE id = ?")
        .bind(signature).bind(now()).bind(id).execute(db).await?;
    Ok(())
}

pub async fn set_signature(db: &Db, id: &str, signature: &str) -> Result<()> {
    sqlx::query("UPDATE intents SET signature = ?, updated_at = ? WHERE id = ?").bind(signature).bind(now()).bind(id).execute(db).await?;
    Ok(())
}

pub async fn set_failed(db: &Db, id: &str, error: &str) -> Result<()> {
    sqlx::query("UPDATE intents SET status = 'failed', error = ?, updated_at = ? WHERE id = ?")
        .bind(error).bind(now()).bind(id).execute(db).await?;
    Ok(())
}

pub async fn set_x402(db: &Db, id: &str, x402: &serde_json::Value) -> Result<()> {
    sqlx::query("UPDATE intents SET x402 = ?, updated_at = ? WHERE id = ?").bind(x402.to_string()).bind(now()).bind(id).execute(db).await?;
    Ok(())
}

pub async fn set_tg_message(db: &Db, id: &str, message_id: i64) -> Result<()> {
    sqlx::query("UPDATE intents SET tg_message_id = ?, updated_at = ? WHERE id = ?").bind(message_id).bind(now()).bind(id).execute(db).await?;
    Ok(())
}

/// Sum of USDC (atomic) that is settled or in-flight since `since` unix ts.
pub async fn spent_since(db: &Db, since: i64) -> Result<i64> {
    let v: (Option<i64>,) = sqlx::query_as(
        "SELECT SUM(amount_atomic) FROM intents WHERE created_at >= ? AND status IN ('allowed','executing','settled','awaiting_approval')",
    )
    .bind(since).fetch_one(db).await?;
    Ok(v.0.unwrap_or(0))
}

pub async fn count_since(db: &Db, agent_id: &str, since: i64) -> Result<i64> {
    let v: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM intents WHERE agent_id = ? AND created_at >= ?")
        .bind(agent_id).bind(since).fetch_one(db).await?;
    Ok(v.0)
}

pub async fn paid_recipient_before(db: &Db, to: &str) -> Result<bool> {
    let v: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM intents WHERE to_address = ? AND status = 'settled'").bind(to).fetch_one(db).await?;
    Ok(v.0 > 0)
}

pub async fn audit(db: &Db, intent_id: Option<&str>, event: &str, detail: serde_json::Value) -> Result<()> {
    sqlx::query("INSERT INTO audit (ts, intent_id, event, detail) VALUES (?,?,?,?)")
        .bind(now()).bind(intent_id).bind(event).bind(detail.to_string()).execute(db).await?;
    Ok(())
}

pub async fn list_audit(db: &Db, limit: i64) -> Result<Vec<AuditRow>> {
    Ok(sqlx::query_as::<_, AuditRow>("SELECT * FROM audit ORDER BY id DESC LIMIT ?").bind(limit).fetch_all(db).await?)
}

pub async fn get_setting(db: &Db, key: &str) -> Result<Option<String>> {
    let v: Option<(String,)> = sqlx::query_as("SELECT value FROM settings WHERE key = ?").bind(key).fetch_optional(db).await?;
    Ok(v.map(|t| t.0))
}

pub async fn set_setting(db: &Db, key: &str, value: &str) -> Result<()> {
    sqlx::query("INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .bind(key).bind(value).execute(db).await?;
    Ok(())
}
