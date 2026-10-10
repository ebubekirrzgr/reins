//! On-chain layer: delegate keypair, delegation discovery, TransferRecurring executor.
//! Everything here is scoped by the Subscriptions program: the delegate key can only move
//! what the owner's RecurringDelegation PDA allows, in the current period.
use anyhow::{anyhow, Context, Result};
use serde::Serialize;
use solana_account_decoder_client_types::UiAccountEncoding;
use solana_address::Address;
use solana_commitment_config::CommitmentConfig;
use solana_instruction::{AccountMeta, Instruction};
use solana_keypair::Keypair;
use solana_rpc_client::nonblocking::rpc_client::RpcClient;
use solana_rpc_client_api::{
    config::{RpcAccountInfoConfig, RpcProgramAccountsConfig},
    filter::{Memcmp, RpcFilterType},
};
use solana_signer::Signer;
use solana_transaction::Transaction;
use std::{str::FromStr, sync::Arc, time::{Duration, Instant}};
use subscriptions::{
    accounts::{EventAuthority, RecurringDelegation, SubscriptionAuthority},
    instructions::{TransferRecurring, TransferRecurringInstructionArgs},
    types::TransferData,
    SUBSCRIPTIONS_ID,
};
use tokio::sync::RwLock;

pub const TOKEN_PROGRAM: &str = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
pub const ATA_PROGRAM: &str = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
pub const SYSTEM_PROGRAM: &str = "11111111111111111111111111111111";
/// Header layout: discriminator(1) version(1) bump(1) delegator(32) delegatee(32) payer(32) init_id(8)
const DELEGATOR_OFFSET: usize = 3;
const DELEGATEE_OFFSET: usize = 35;
const RECURRING_DISCRIMINATOR: u8 = 3;

#[derive(Debug, Clone, Serialize)]
pub struct DelegationView {
    pub address: String,
    pub delegator: String,
    pub delegatee: String,
    pub mint: String,
    pub amount_per_period: i64,
    pub amount_pulled_in_period: i64,
    pub remaining_in_period: i64,
    pub period_length_s: i64,
    pub current_period_start_ts: i64,
    pub current_period_end_ts: i64,
    pub expiry_ts: i64,
    pub expired: bool,
    pub nonce_hint: Option<u64>,
}

pub struct Chain {
    pub rpc: RpcClient,
    pub delegate: Keypair,
    pub mint: Address,
    pub owner_filter: Option<Address>,
    cache: RwLock<Option<(Instant, Option<DelegationView>)>>,
}

pub fn ata(owner: &Address, mint: &Address) -> Address {
    let token = Address::from_str(TOKEN_PROGRAM).unwrap();
    let ata_prog = Address::from_str(ATA_PROGRAM).unwrap();
    Address::find_program_address(&[owner.as_ref(), token.as_ref(), mint.as_ref()], &ata_prog).0
}

fn create_ata_idempotent_ix(payer: &Address, owner: &Address, mint: &Address) -> Instruction {
    Instruction {
        program_id: Address::from_str(ATA_PROGRAM).unwrap(),
        accounts: vec![
            AccountMeta::new(*payer, true),
            AccountMeta::new(ata(owner, mint), false),
            AccountMeta::new_readonly(*owner, false),
            AccountMeta::new_readonly(*mint, false),
            AccountMeta::new_readonly(Address::from_str(SYSTEM_PROGRAM).unwrap(), false),
            AccountMeta::new_readonly(Address::from_str(TOKEN_PROGRAM).unwrap(), false),
        ],
        data: vec![1], // CreateIdempotent
    }
}

fn view_from(address: Address, d: &RecurringDelegation, now: i64) -> DelegationView {
    let period = d.period_length_s.max(1) as i64;
    // The program lazily rolls the period forward on the next pull; mirror that here.
    let (start, pulled) = if now >= d.current_period_start_ts + period {
        let elapsed = (now - d.current_period_start_ts) / period;
        (d.current_period_start_ts + elapsed * period, 0)
    } else {
        (d.current_period_start_ts, d.amount_pulled_in_period as i64)
    };
    let expired = d.expiry_ts != 0 && now >= d.expiry_ts;
    DelegationView {
        address: address.to_string(),
        delegator: d.header.delegator.to_string(),
        delegatee: d.header.delegatee.to_string(),
        mint: d.mint.to_string(),
        amount_per_period: d.amount_per_period as i64,
        amount_pulled_in_period: pulled,
        remaining_in_period: if expired { 0 } else { (d.amount_per_period as i64 - pulled).max(0) },
        period_length_s: period,
        current_period_start_ts: start,
        current_period_end_ts: start + period,
        expiry_ts: d.expiry_ts,
        expired,
        nonce_hint: None,
    }
}

impl Chain {
    pub fn new(rpc_url: &str, keypair_path: &str, mint: &str, owner: Option<&str>) -> Result<Arc<Self>> {
        let raw = std::fs::read_to_string(keypair_path).with_context(|| format!("reading delegate keypair at {keypair_path} (run `pnpm keygen`)"))?;
        let bytes: Vec<u8> = serde_json::from_str(&raw).context("delegate keypair must be a JSON byte array")?;
        let delegate = Keypair::try_from(bytes.as_slice()).map_err(|e| anyhow!("invalid keypair: {e}"))?;
        Ok(Arc::new(Self {
            rpc: RpcClient::new_with_commitment(rpc_url.to_string(), CommitmentConfig::confirmed()),
            delegate,
            mint: Address::from_str(mint).context("USDC_MINT")?,
            owner_filter: owner.map(Address::from_str).transpose().context("OWNER_PUBKEY")?,
            cache: RwLock::new(None),
        }))
    }

    pub fn delegate_address(&self) -> Address {
        self.delegate.pubkey()
    }

    pub async fn sol_balance(&self) -> Result<u64> {
        Ok(self.rpc.get_balance(&self.delegate_address()).await?)
    }

    /// Token balance (atomic) of `owner`'s USDC ATA; 0 if the ATA does not exist.
    pub async fn usdc_balance(&self, owner: &Address) -> Result<i64> {
        let acct = self.rpc.get_account_with_commitment(&ata(owner, &self.mint), CommitmentConfig::confirmed()).await?.value;
        Ok(match acct {
            Some(a) if a.data.len() >= 72 => i64::from_le_bytes(a.data[64..72].try_into().unwrap()),
            _ => 0,
        })
    }

    /// Finds the active recurring delegation (owner -> firewall delegate) for the configured mint.
    /// Cached for 20s; `force` bypasses the cache.
    pub async fn find_delegation(&self, force: bool) -> Result<Option<DelegationView>> {
        if !force {
            if let Some((t, v)) = &*self.cache.read().await {
                if t.elapsed() < Duration::from_secs(20) {
                    return Ok(v.clone());
                }
            }
        }
        let mut filters = vec![
            RpcFilterType::Memcmp(Memcmp::new_raw_bytes(0, vec![RECURRING_DISCRIMINATOR])),
            RpcFilterType::Memcmp(Memcmp::new_raw_bytes(DELEGATEE_OFFSET, self.delegate_address().to_bytes().to_vec())),
        ];
        if let Some(owner) = self.owner_filter {
            filters.push(RpcFilterType::Memcmp(Memcmp::new_raw_bytes(DELEGATOR_OFFSET, owner.to_bytes().to_vec())));
        }
        let cfg = RpcProgramAccountsConfig {
            filters: Some(filters),
            account_config: RpcAccountInfoConfig { encoding: Some(UiAccountEncoding::Base64), data_slice: None, commitment: Some(CommitmentConfig::confirmed()), min_context_slot: None },
            with_context: None,
            sort_results: None,
        };
        #[allow(deprecated)]
        let accounts = self.rpc.get_program_accounts_with_config(&SUBSCRIPTIONS_ID, cfg).await.context("getProgramAccounts")?;
        let now = chrono::Utc::now().timestamp();
        let mut best: Option<DelegationView> = None;
        for (addr, acct) in accounts {
            let Ok(d) = RecurringDelegation::from_bytes(&acct.data) else { continue };
            if d.mint != self.mint {
                continue;
            }
            let v = view_from(addr, &d, now);
            if v.expired {
                continue;
            }
            // prefer the one with the largest remaining allowance
            if best.as_ref().map(|b| v.remaining_in_period > b.remaining_in_period).unwrap_or(true) {
                best = Some(v);
            }
        }
        *self.cache.write().await = Some((Instant::now(), best.clone()));
        Ok(best)
    }

    pub async fn invalidate(&self) {
        *self.cache.write().await = None;
    }

    /// Pulls `amount` (atomic) from the owner's ATA to `receiver_owner`'s ATA via TransferRecurring.
    /// Creates the receiver ATA (idempotent) in the same transaction. Returns the tx signature.
    pub async fn transfer_recurring(&self, delegation: &DelegationView, receiver_owner: &Address, amount: u64) -> Result<String> {
        let delegator = Address::from_str(&delegation.delegator)?;
        let delegation_pda = Address::from_str(&delegation.address)?;
        let (sa, _) = SubscriptionAuthority::find_pda(&delegator, &self.mint);
        let (event_authority, _) = EventAuthority::find_pda();
        let delegatee = self.delegate_address();

        let ix = TransferRecurring {
            delegation_pda,
            subscription_authority: sa,
            delegator_ata: ata(&delegator, &self.mint),
            receiver_ata: ata(receiver_owner, &self.mint),
            token_mint: self.mint,
            token_program: Address::from_str(TOKEN_PROGRAM).unwrap(),
            delegatee,
            event_authority,
            self_program: SUBSCRIPTIONS_ID,
        }
        .instruction(TransferRecurringInstructionArgs { transfer_data: TransferData { amount, delegator, mint: self.mint } });

        let ixs = vec![create_ata_idempotent_ix(&delegatee, receiver_owner, &self.mint), ix];
        let blockhash = self.rpc.get_latest_blockhash().await.context("getLatestBlockhash")?;
        let tx = Transaction::new_signed_with_payer(&ixs, Some(&delegatee), &[&self.delegate], blockhash);
        let sig = self.rpc.send_and_confirm_transaction(&tx).await.map_err(|e| anyhow!("TransferRecurring failed: {e}"))?;
        self.invalidate().await;
        Ok(sig.to_string())
    }
}
