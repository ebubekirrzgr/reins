//! Human-in-the-loop approvals. `Hub` holds one-shot channels keyed by intent id; the Telegram
//! poller (or the dashboard admin endpoint) resolves them.
use std::{collections::HashMap, sync::Arc, time::Duration};
use tokio::sync::{oneshot, Mutex};

pub mod telegram;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    Approved,
    ApprovedAndTrust,
    Rejected,
    Timeout,
}

#[derive(Default)]
pub struct Hub {
    pending: Mutex<HashMap<String, oneshot::Sender<Outcome>>>,
}

impl Hub {
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    pub async fn register(&self, intent_id: &str) -> oneshot::Receiver<Outcome> {
        let (tx, rx) = oneshot::channel();
        self.pending.lock().await.insert(intent_id.to_string(), tx);
        rx
    }

    /// Returns false when nothing was waiting (already resolved / timed out / unknown id).
    pub async fn resolve(&self, intent_id: &str, outcome: Outcome) -> bool {
        match self.pending.lock().await.remove(intent_id) {
            Some(tx) => tx.send(outcome).is_ok(),
            None => false,
        }
    }

    pub async fn wait(&self, intent_id: &str, rx: oneshot::Receiver<Outcome>, timeout: Duration) -> Outcome {
        match tokio::time::timeout(timeout, rx).await {
            Ok(Ok(o)) => o,
            _ => {
                self.pending.lock().await.remove(intent_id);
                Outcome::Timeout
            }
        }
    }
}
