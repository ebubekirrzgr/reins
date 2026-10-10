CREATE TABLE IF NOT EXISTS intents (
  id            TEXT PRIMARY KEY,
  agent_id      TEXT NOT NULL,
  kind          TEXT NOT NULL,               -- transfer | x402
  to_address    TEXT,                        -- recipient wallet (transfer) or merchant payTo (x402)
  url           TEXT,                        -- x402 only
  method        TEXT,                        -- x402 only
  amount_atomic INTEGER NOT NULL DEFAULT 0,  -- USDC base units (6 dp); x402: filled after quote
  memo          TEXT,
  status        TEXT NOT NULL,               -- pending | awaiting_approval | allowed | denied | executing | settled | failed | expired
  decision      TEXT,                        -- allow | ask | deny
  decided_by    TEXT,                        -- policy | owner | timeout | admin
  risk          INTEGER NOT NULL DEFAULT 0,
  reasons       TEXT NOT NULL DEFAULT '[]',  -- JSON array of strings
  signature     TEXT,                        -- on-chain tx signature (TransferRecurring)
  x402          TEXT,                        -- JSON: quote + pay result
  error         TEXT,
  tg_message_id INTEGER,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_intents_created ON intents(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_intents_status ON intents(status);

CREATE TABLE IF NOT EXISTS audit (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  ts        INTEGER NOT NULL,
  intent_id TEXT,
  event     TEXT NOT NULL,
  detail    TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit(ts DESC);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
