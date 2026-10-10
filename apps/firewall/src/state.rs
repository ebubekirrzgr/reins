use crate::{approvals::{telegram::Bot, Hub}, chain::Chain, config::Config, db::Db, x402::Sidecar};
use std::sync::Arc;

#[derive(Clone)]
pub struct AppState {
    pub cfg: Arc<Config>,
    pub db: Db,
    pub chain: Arc<Chain>,
    pub approvals: Arc<Hub>,
    pub bot: Option<Bot>,
    pub sidecar: Sidecar,
}
