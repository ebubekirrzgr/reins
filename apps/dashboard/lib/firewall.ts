import { ADMIN_KEY, FIREWALL_URL } from "./config";

export type Delegation = {
  address: string;
  delegator: string;
  delegatee: string;
  mint: string;
  amount_per_period: number;
  amount_pulled_in_period: number;
  remaining_in_period: number;
  period_length_s: number;
  current_period_start_ts: number;
  current_period_end_ts: number;
  expiry_ts: number;
  expired: boolean;
};

export type Policy = {
  auto_allow_max: number;
  hard_max: number;
  daily_soft_cap: number;
  trusted_recipients: string[];
  trusted_allow_max: number;
  blocked_recipients: string[];
  max_intents_per_minute: number;
  memo_blocklist: string[];
};

export type Status = {
  delegate: string;
  delegate_sol: number | null;
  hot_wallet_usdc: number | null;
  owner: string | null;
  owner_usdc: number | null;
  mint: string;
  paused: boolean;
  spent_today_usdc: number;
  delegation: Delegation | null;
  telegram: boolean;
  telegram_chat_bound: boolean;
  approval_timeout_sec: number;
  policy: Policy;
};

export type Intent = {
  id: string;
  agent_id: string;
  kind: "transfer" | "x402";
  to_address: string | null;
  url: string | null;
  method: string | null;
  amount_atomic: number;
  amount_usdc: number;
  memo: string | null;
  status: string;
  decision: string | null;
  decided_by: string | null;
  risk: number;
  reasons: string[];
  signature: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
};

export type AuditRow = { id: number; ts: number; intent_id: string | null; event: string; detail: unknown };

async function j<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${FIREWALL_URL}${path}`, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}
const admin = { "x-admin-key": ADMIN_KEY };

export const api = {
  status: () => j<Status>("/v1/status"),
  intents: (limit = 50) => j<Intent[]>(`/v1/intents?limit=${limit}`),
  audit: (limit = 60) => j<AuditRow[]>(`/v1/audit?limit=${limit}`),
  pause: () => j("/v1/admin/pause", { method: "POST", headers: admin }),
  resume: () => j("/v1/admin/resume", { method: "POST", headers: admin }),
  refresh: () => j("/v1/admin/refresh", { method: "POST", headers: admin }),
  decide: (id: string, approve: boolean, trust = false) => j(`/v1/admin/decide/${id}`, { method: "POST", headers: admin, body: JSON.stringify({ approve, trust }) }),
  policy: () => j<Policy>("/v1/admin/policy"),
  savePolicy: (p: Policy) => j<Policy>("/v1/admin/policy", { method: "PUT", headers: admin, body: JSON.stringify(p) }),
};
