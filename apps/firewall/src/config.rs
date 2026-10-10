use anyhow::{Context, Result};
use std::env;

#[derive(Clone, Debug)]
pub struct Config {
    pub port: u16,
    pub rpc_url: String,
    pub delegate_keypair_path: String,
    pub usdc_mint: String,
    pub telegram_bot_token: Option<String>,
    pub telegram_owner_chat_id: Option<i64>,
    pub database_url: String,
    pub sidecar_url: String,
    #[allow(dead_code)]
    pub dashboard_url: String,
    pub approval_timeout_sec: u64,
    pub agent_api_key: String,
    pub admin_api_key: String,
    pub owner_pubkey: Option<String>,
}

fn opt(key: &str) -> Option<String> {
    env::var(key).ok().map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
}

impl Config {
    pub fn from_env() -> Result<Self> {
        Ok(Self {
            port: opt("FIREWALL_PORT").map(|p| p.parse()).transpose().context("FIREWALL_PORT")?.unwrap_or(4010),
            rpc_url: opt("RPC_URL").unwrap_or_else(|| "https://api.devnet.solana.com".into()),
            delegate_keypair_path: opt("DELEGATE_KEYPAIR_PATH").unwrap_or_else(|| "./keys/delegate.json".into()),
            usdc_mint: opt("USDC_MINT").unwrap_or_else(|| "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU".into()),
            telegram_bot_token: opt("TELEGRAM_BOT_TOKEN"),
            telegram_owner_chat_id: opt("TELEGRAM_OWNER_CHAT_ID").map(|v| v.parse()).transpose().context("TELEGRAM_OWNER_CHAT_ID")?,
            database_url: opt("DATABASE_URL").unwrap_or_else(|| "sqlite://reins.db".into()),
            sidecar_url: opt("SIDECAR_URL").unwrap_or_else(|| "http://127.0.0.1:4020".into()),
            dashboard_url: opt("DASHBOARD_URL").unwrap_or_else(|| "http://localhost:3000".into()),
            approval_timeout_sec: opt("APPROVAL_TIMEOUT_SEC").map(|v| v.parse()).transpose().context("APPROVAL_TIMEOUT_SEC")?.unwrap_or(600),
            agent_api_key: opt("AGENT_API_KEY").unwrap_or_else(|| "dev-agent-key".into()),
            admin_api_key: opt("ADMIN_API_KEY").unwrap_or_else(|| "dev-admin-key".into()),
            owner_pubkey: opt("OWNER_PUBKEY"),
        })
    }
}
