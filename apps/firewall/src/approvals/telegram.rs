//! Minimal Telegram Bot API client (sendMessage / editMessageText / getUpdates long-polling /
//! answerCallbackQuery) over reqwest. No framework: fewer moving parts for the demo.
use anyhow::{anyhow, Result};
use serde_json::{json, Value};
use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Clone)]
pub struct Bot {
    token: String,
    http: reqwest::Client,
    pub owner_chat_id: Arc<RwLock<Option<i64>>>,
}

#[derive(Debug, Clone)]
pub enum Incoming {
    /// (callback_query_id, chat_id, message_id, data)
    Callback { id: String, chat_id: i64, message_id: i64, data: String },
    /// (chat_id, text, from name)
    Message { chat_id: i64, text: String, from: String },
}

impl Bot {
    pub fn new(token: String, owner_chat_id: Option<i64>) -> Self {
        Self { token, http: reqwest::Client::new(), owner_chat_id: Arc::new(RwLock::new(owner_chat_id)) }
    }

    fn url(&self, method: &str) -> String {
        format!("https://api.telegram.org/bot{}/{}", self.token, method)
    }

    async fn call(&self, method: &str, body: Value) -> Result<Value> {
        let res = self.http.post(self.url(method)).json(&body).send().await?;
        let v: Value = res.json().await?;
        if v.get("ok").and_then(|b| b.as_bool()) != Some(true) {
            return Err(anyhow!("telegram {method}: {}", v.get("description").and_then(|d| d.as_str()).unwrap_or("unknown error")));
        }
        Ok(v["result"].clone())
    }

    pub async fn me(&self) -> Result<String> {
        let r = self.call("getMe", json!({})).await?;
        Ok(r["username"].as_str().unwrap_or("?").to_string())
    }

    pub async fn send(&self, chat_id: i64, html: &str, keyboard: Option<Vec<Vec<(String, String)>>>) -> Result<i64> {
        let mut body = json!({ "chat_id": chat_id, "text": html, "parse_mode": "HTML", "disable_web_page_preview": true });
        if let Some(rows) = keyboard {
            let kb: Vec<Vec<Value>> = rows
                .into_iter()
                .map(|row| row.into_iter().map(|(t, d)| json!({ "text": t, "callback_data": d })).collect())
                .collect();
            body["reply_markup"] = json!({ "inline_keyboard": kb });
        }
        let r = self.call("sendMessage", body).await?;
        Ok(r["message_id"].as_i64().unwrap_or(0))
    }

    pub async fn edit(&self, chat_id: i64, message_id: i64, html: &str) -> Result<()> {
        // omitting reply_markup removes the buttons
        self.call("editMessageText", json!({ "chat_id": chat_id, "message_id": message_id, "text": html, "parse_mode": "HTML", "disable_web_page_preview": true })).await?;
        Ok(())
    }

    pub async fn answer_callback(&self, id: &str, text: &str) -> Result<()> {
        self.call("answerCallbackQuery", json!({ "callback_query_id": id, "text": text })).await?;
        Ok(())
    }

    /// One long-poll round. Returns new updates and the next offset.
    pub async fn poll(&self, offset: i64) -> Result<(Vec<Incoming>, i64)> {
        let r = self
            .call("getUpdates", json!({ "offset": offset, "timeout": 25, "allowed_updates": ["message", "callback_query"] }))
            .await?;
        let mut next = offset;
        let mut out = vec![];
        for u in r.as_array().cloned().unwrap_or_default() {
            if let Some(id) = u["update_id"].as_i64() {
                next = next.max(id + 1);
            }
            if let Some(cb) = u.get("callback_query") {
                out.push(Incoming::Callback {
                    id: cb["id"].as_str().unwrap_or("").to_string(),
                    chat_id: cb["message"]["chat"]["id"].as_i64().unwrap_or(0),
                    message_id: cb["message"]["message_id"].as_i64().unwrap_or(0),
                    data: cb["data"].as_str().unwrap_or("").to_string(),
                });
            } else if let Some(m) = u.get("message") {
                out.push(Incoming::Message {
                    chat_id: m["chat"]["id"].as_i64().unwrap_or(0),
                    text: m["text"].as_str().unwrap_or("").to_string(),
                    from: m["from"]["first_name"].as_str().unwrap_or("").to_string(),
                });
            }
        }
        Ok((out, next))
    }
}

pub fn esc(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

pub fn short(addr: &str) -> String {
    if addr.len() > 12 { format!("{}…{}", &addr[..4], &addr[addr.len() - 4..]) } else { addr.to_string() }
}
