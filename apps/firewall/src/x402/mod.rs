//! Client for the Node x402 sidecar (quote without paying, then pay with the approved terms).
use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

#[derive(Clone)]
pub struct Sidecar {
    base: String,
    http: reqwest::Client,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Quote {
    pub scheme: String,
    pub network: String,
    pub asset: String,
    pub amount: String,
    #[serde(rename = "payTo")]
    pub pay_to: String,
    #[serde(default, rename = "maxTimeoutSeconds")]
    pub max_timeout_seconds: u64,
    #[serde(default)]
    pub extra: Value,
}

#[derive(Debug, Clone, Deserialize)]
pub struct QuoteResponse {
    #[serde(rename = "paymentRequired")]
    pub payment_required: bool,
    pub status: u16,
    #[serde(default)]
    #[allow(dead_code)]
    pub accepts: Vec<Quote>,
    #[serde(default)]
    pub selected: Option<Quote>,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default, rename = "contentType")]
    pub content_type: Option<String>,
    #[serde(default)]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PayResponse {
    #[serde(default)]
    pub status: u16,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default, rename = "contentType")]
    pub content_type: Option<String>,
    #[serde(default)]
    pub settle: Option<Value>,
    #[serde(default)]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Req<'a> {
    pub url: &'a str,
    pub method: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub headers: Option<&'a HashMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expected: Option<Expected>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Expected {
    pub amount: String,
    #[serde(rename = "payTo")]
    pub pay_to: String,
    pub asset: String,
}

impl Sidecar {
    pub fn new(base: &str) -> Self {
        Self { base: base.trim_end_matches('/').to_string(), http: reqwest::Client::new() }
    }

    pub async fn health(&self) -> Result<Value> {
        Ok(self.http.get(format!("{}/health", self.base)).send().await?.json().await?)
    }

    pub async fn quote(&self, req: &Req<'_>) -> Result<QuoteResponse> {
        let res = self.http.post(format!("{}/quote", self.base)).json(req).send().await.map_err(|e| anyhow!("sidecar unreachable: {e}"))?;
        let v: QuoteResponse = res.json().await?;
        if let Some(e) = &v.error {
            return Err(anyhow!("sidecar quote: {e}"));
        }
        Ok(v)
    }

    pub async fn pay(&self, req: &Req<'_>) -> Result<PayResponse> {
        let res = self.http.post(format!("{}/pay", self.base)).json(req).send().await.map_err(|e| anyhow!("sidecar unreachable: {e}"))?;
        let v: PayResponse = res.json().await?;
        if let Some(e) = &v.error {
            return Err(anyhow!("sidecar pay: {e}"));
        }
        Ok(v)
    }
}
