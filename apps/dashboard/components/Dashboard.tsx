"use client";
import { useCallback, useEffect, useState } from "react";
import { useConnect, useDisconnect, type UiWallet, type UiWalletAccount } from "@wallet-standard/react";
import { useWallets } from "../lib/useWallets";
import { useWalletAccountTransactionSigner } from "@solana/react";
import { address } from "@solana/kit";
import { api, type AuditRow, type Intent, type Policy, type Status } from "../lib/firewall";
import { createAllowance, listOwnerDelegations, revokeAllowance, usdcBalance, type OwnerDelegation } from "../lib/solana";
import { DEVNET_CHAIN, ago, fmtUsdc, short } from "../lib/config";

const explorerTx = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
const explorerAddr = (a: string) => `https://explorer.solana.com/address/${a}?cluster=devnet`;
const usd = (n: number) => n.toFixed(2);
const clip = (s: string, n = 140) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const flat = (v: unknown) => JSON.stringify(v).replace(/[{}"]/g, "").replace(/,/g, " · ").replace(/:/g, ": ");

export default function Dashboard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [intents, setIntents] = useState<Intent[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [account, setAccount] = useState<UiWalletAccount | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [s, i, a] = await Promise.all([api.status(), api.intents(60), api.audit(40)]);
      setStatus(s);
      setIntents(i);
      setAudit(a);
      setErr(null);
    } catch (e) {
      setErr(`Firewall unreachable at the configured URL: ${(e as Error).message}`);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [refresh]);

  const pending = intents.filter((i) => i.status === "awaiting_approval");

  return (
    <div className="app">
      <nav className="topbar">
        <div className="brand">
          <span className="word">REINS</span>
          <span className="tag">
            agent wallet firewall · <b>Solana devnet</b>
          </span>
        </div>
        <div className="topbar-right">
          {status && (
            <span className={`chip ${status.paused ? "bad" : "ok"}`}>
              <i className="dot" />
              {status.paused ? "Paused" : "Active"}
            </span>
          )}
          {status && (
            <span className={`chip ${status.telegram_chat_bound ? "ok" : status.telegram ? "warn" : ""}`}>
              <i className="dot" />
              {status.telegram_chat_bound ? "Telegram linked" : status.telegram ? "Telegram: send /start" : "Telegram off"}
            </span>
          )}
          <WalletButton account={account} onAccount={setAccount} />
        </div>
      </nav>

      <StatsStrip status={status} pending={pending.length} />

      <div className="layout">
        <main className="feed">
          {err && <div className="alert">{err}</div>}
          {pending.length > 0 && (
            <div className="notice">
              <span>
                <b>{pending.length} request{pending.length > 1 ? "s" : ""} waiting for you.</b> Decide here or on Telegram.
              </span>
              <div className="row-actions" style={{ marginTop: 0 }}>
                <button className="btn ok sm" onClick={() => api.decide(pending[0].id, true).then(refresh)}>
                  Approve {usd(pending[0].amount_usdc)} USDC
                </button>
                <button className="btn bad sm" onClick={() => api.decide(pending[0].id, false).then(refresh)}>
                  Reject
                </button>
              </div>
            </div>
          )}
          <IntentsSection intents={intents} onDecided={refresh} />
          <AuditSection rows={audit} />
        </main>
        <aside className="side">
          {account ? <AllowancePanel account={account} status={status} onChanged={refresh} /> : <ConnectPanel />}
          <ControlsPanel status={status} onChanged={refresh} />
          <PolicyPanel status={status} onSaved={refresh} />
        </aside>
      </div>
    </div>
  );
}

/* ---------------- top-level pieces ---------------- */

function StatsStrip({ status, pending }: { status: Status | null; pending: number }) {
  const d = status?.delegation ?? null;
  const used = d ? d.amount_pulled_in_period / 1e6 : 0;
  const cap = d ? d.amount_per_period / 1e6 : 0;
  const pct = cap > 0 ? Math.min(100, Math.round((100 * used) / cap)) : 0;
  return (
    <section className="stats">
      <div className="stat">
        <div className="label">On-chain cap · this period</div>
        <div className="value">
          {d ? usd(used) : "—"}
          <small>{d ? `of ${usd(cap)} USDC` : "no allowance"}</small>
        </div>
        <div className={`meter ${pct > 80 ? "warn" : ""}`}>
          <i style={{ width: `${pct}%` }} />
        </div>
        <div className="note">
          {d ? `${usd(d.remaining_in_period / 1e6)} USDC left · resets ${new Date(d.current_period_end_ts * 1000).toLocaleString("en-US", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" })}` : "Grant one from the Allowance panel"}
        </div>
      </div>
      <div className="stat">
        <div className="label">Spent today</div>
        <div className="value">
          {status ? usd(status.spent_today_usdc) : "—"}
          <small>USDC</small>
        </div>
        <div className="note">{status ? `soft cap ${usd(status.policy.daily_soft_cap)} USDC` : ""}</div>
      </div>
      <div className="stat">
        <div className="label">Waiting for approval</div>
        <div className="value">{status ? pending : "—"}</div>
        <div className="note">{status ? `auto-reject after ${Math.round(status.approval_timeout_sec / 60)} min` : ""}</div>
      </div>
      <div className="stat">
        <div className="label">Hot wallet</div>
        <div className="value">
          {status ? usd(status.hot_wallet_usdc ?? 0) : "—"}
          <small>USDC</small>
        </div>
        <div className="note">
          {status ? (
            <>
              <a className="mono" href={explorerAddr(status.delegate)} target="_blank" rel="noreferrer">
                {short(status.delegate)}
              </a>{" "}
              · {(status.delegate_sol ?? 0).toFixed(3)} SOL for fees
            </>
          ) : (
            ""
          )}
        </div>
      </div>
    </section>
  );
}

function WalletButton({ account, onAccount }: { account: UiWalletAccount | null; onAccount: (a: UiWalletAccount | null) => void }) {
  const wallets = useWallets().filter((w) => w.chains.some((c: string) => c === DEVNET_CHAIN));
  const [picked, setPicked] = useState<UiWallet | null>(null);
  if (account && picked) return <DisconnectButton wallet={picked} account={account} onDisconnect={() => onAccount(null)} />;
  if (wallets.length === 0) return <span className="chip">No Solana wallet found</span>;
  return (
    <>
      {wallets.map((w) => (
        <ConnectButton key={w.name} wallet={w} onConnected={(a) => { setPicked(w); onAccount(a); }} />
      ))}
    </>
  );
}

function ConnectButton({ wallet, onConnected }: { wallet: UiWallet; onConnected: (a: UiWalletAccount) => void }) {
  const [isConnecting, connect] = useConnect(wallet);
  return (
    <button
      className="btn"
      disabled={isConnecting}
      onClick={async () => {
        const accounts = await connect();
        const a = accounts.find((x) => x.chains.some((c: string) => c === DEVNET_CHAIN)) ?? accounts[0];
        if (a) onConnected(a);
      }}
    >
      {isConnecting ? "Connecting…" : `Connect ${wallet.name}`}
    </button>
  );
}

function DisconnectButton({ wallet, account, onDisconnect }: { wallet: UiWallet; account: UiWalletAccount; onDisconnect: () => void }) {
  const [, disconnect] = useDisconnect(wallet);
  return (
    <button className="btn ghost" onClick={async () => { await disconnect().catch(() => {}); onDisconnect(); }}>
      <span className="mono">{short(account.address)}</span>
      <span style={{ color: "var(--ink-3)" }}>· disconnect</span>
    </button>
  );
}

/* ---------------- feed ---------------- */

function statusView(i: Intent): { cls: string; label: string } {
  switch (i.status) {
    case "settled": return { cls: "ok", label: "Settled" };
    case "allowed": return { cls: "ok live", label: "Allowed" };
    case "executing": return { cls: "warn live", label: "Executing" };
    case "awaiting_approval": return { cls: "warn live", label: "Awaiting you" };
    case "pending": return { cls: "live", label: "Evaluating" };
    case "denied": return { cls: "bad", label: "Denied" };
    case "expired": return { cls: "bad", label: "Expired" };
    case "failed": return { cls: "bad", label: "Failed" };
    default: return { cls: "", label: i.status };
  }
}

function IntentsSection({ intents, onDecided }: { intents: Intent[]; onDecided: () => void }) {
  return (
    <section>
      <div className="section-head">
        <h2>Spend requests</h2>
        <span className="meta">live · refreshes every 3s</span>
      </div>
      <div className="section-body">
        {intents.length === 0 ? (
          <div className="empty">
            No requests yet. Run <code>pnpm agent</code> to send three.
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 70 }}>When</th>
                <th>Request</th>
                <th className="r" style={{ width: 80 }}>Amount</th>
                <th style={{ width: 104 }}>Risk</th>
                <th style={{ width: 150 }}>Status</th>
                <th className="r" style={{ width: 70 }}>Tx</th>
              </tr>
            </thead>
            <tbody>
              {intents.map((i) => {
                const sv = statusView(i);
                const riskCls = i.risk >= 80 ? "high" : i.risk >= 40 ? "mid" : "";
                return (
                  <tr key={i.id}>
                    <td className="mono" style={{ color: "var(--ink-3)" }}>{ago(i.created_at)}</td>
                    <td>
                      <div className="t1">
                        {i.kind === "x402" ? (
                          <>
                            {i.method} <span className="mono">{i.url?.replace(/^https?:\/\//, "")}</span>
                          </>
                        ) : (
                          <>
                            Transfer to <span className="mono">{short(i.to_address)}</span>
                          </>
                        )}
                        <span style={{ color: "var(--ink-3)", fontWeight: 400 }}> · {i.agent_id}</span>
                      </div>
                      {i.memo && <div className="t2">“{i.memo}”</div>}
                      {i.reasons.length > 0 && <div className="t2">{i.reasons.join(" · ")}</div>}
                      {i.error && <div className="t2 bad" title={i.error}>{clip(i.error)}</div>}
                      {i.status === "awaiting_approval" && (
                        <div className="row-actions">
                          <button className="btn ok sm" onClick={() => api.decide(i.id, true).then(onDecided)}>Approve</button>
                          <button className="btn ghost sm" onClick={() => api.decide(i.id, true, true).then(onDecided)}>Approve + trust</button>
                          <button className="btn bad sm" onClick={() => api.decide(i.id, false).then(onDecided)}>Reject</button>
                        </div>
                      )}
                    </td>
                    <td className="r num">{i.amount_atomic ? usd(i.amount_usdc) : "—"}</td>
                    <td>
                      <span className={`risk ${riskCls}`}>
                        <i><b style={{ width: `${i.risk}%` }} /></i>
                        <span className="num" style={{ fontSize: 12 }}>{i.risk}</span>
                      </span>
                    </td>
                    <td>
                      <span className={`status ${sv.cls}`}>
                        <i className="dot" />
                        {sv.label}
                        {i.decided_by && i.decided_by !== "policy" && <small>by {i.decided_by}</small>}
                      </span>
                    </td>
                    <td className="r mono">
                      {i.signature ? (
                        <a href={explorerTx(i.signature)} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>
                          {i.signature.slice(0, 4)}…↗
                        </a>
                      ) : (
                        <span style={{ color: "var(--ink-3)" }}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

function AuditSection({ rows }: { rows: AuditRow[] }) {
  return (
    <section>
      <div className="section-head">
        <h2>Audit log</h2>
        <span className="meta">append-only · last {rows.length}</span>
      </div>
      <div className="section-body audit">
        {rows.map((r) => (
          <div className="line" key={r.id}>
            <span className="t">{new Date(r.ts * 1000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
            <span className="e">{r.event}</span>
            <span className="d" title={JSON.stringify(r.detail)}>{flat(r.detail)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ---------------- side panels ---------------- */

function ConnectPanel() {
  return (
    <section className="panel">
      <div className="panel-head"><h2>Allowance</h2></div>
      <div className="panel-body">
        <p className="help">
          Connect a wallet on devnet to grant the firewall a recurring USDC allowance. Funds stay in your wallet; the program enforces the cap on-chain.
        </p>
      </div>
    </section>
  );
}

function AllowancePanel({ account, status, onChanged }: { account: UiWalletAccount; status: Status | null; onChanged: () => void }) {
  const signer = useWalletAccountTransactionSigner(account, DEVNET_CHAIN);
  const [amount, setAmount] = useState("20");
  const [period, setPeriod] = useState("86400");
  const [days, setDays] = useState("30");
  const [msg, setMsg] = useState<{ t: string; k?: "ok" | "err"; sig?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [mine, setMine] = useState<OwnerDelegation[]>([]);
  const [bal, setBal] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const owner = address(account.address);
      const [ds, b] = await Promise.all([listOwnerDelegations(owner), usdcBalance(owner)]);
      setMine(ds);
      setBal(b);
    } catch (e) {
      setMsg({ t: `Chain read failed: ${(e as Error).message}`, k: "err" });
    }
  }, [account.address]);
  useEffect(() => { void load(); }, [load]);

  const delegatee = status?.delegate;
  const run = async (fn: () => Promise<string>, okText: string) => {
    setBusy(true);
    setMsg(null);
    try {
      const sig = await fn();
      setMsg({ t: okText, k: "ok", sig });
      await api.refresh().catch(() => {});
      await load();
      onChanged();
    } catch (e) {
      setMsg({ t: (e as Error).message, k: "err" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel">
      <div className="panel-head"><h2>Allowance</h2><span className="meta mono">{short(account.address)}</span></div>
      <div className="panel-body stack">
        <dl className="kv">
          <dt>Your USDC</dt>
          <dd className="num">
            {bal == null ? "…" : usd(bal)}{" "}
            {bal === 0 && <a href="https://faucet.circle.com" target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>get devnet USDC</a>}
          </dd>
          <dt>Delegate</dt>
          <dd className="mono">{delegatee ? short(delegatee) : "firewall offline"}</dd>
        </dl>
        <div className="grid-3">
          <div className="field">
            <label>Cap per period</label>
            <div className="with-unit"><input className="input num" value={amount} onChange={(e) => setAmount(e.target.value)} /><span>USDC</span></div>
          </div>
          <div className="field">
            <label>Period</label>
            <select className="input" value={period} onChange={(e) => setPeriod(e.target.value)}>
              <option value="3600">1 hour</option>
              <option value="86400">1 day</option>
              <option value="604800">1 week</option>
            </select>
          </div>
          <div className="field">
            <label>Valid for</label>
            <div className="with-unit"><input className="input num" value={days} onChange={(e) => setDays(e.target.value)} /><span>days</span></div>
          </div>
        </div>
        <button
          className="btn block"
          disabled={busy || !delegatee}
          onClick={() =>
            run(
              () => createAllowance({ owner: signer, delegatee: address(delegatee!), amountPerPeriodUsdc: Number(amount), periodSeconds: Number(period), durationDays: Number(days) }, (t) => setMsg({ t })),
              "Allowance granted",
            )
          }
        >
          {busy ? "Working…" : "Grant allowance · 1 signature"}
        </button>
        {msg && (
          <div className={`msg ${msg.k ?? ""}`}>
            {msg.t}
            {msg.sig && <> · <a href={explorerTx(msg.sig)} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>view tx ↗</a></>}
          </div>
        )}
        {mine.length > 0 && (
          <ul className="list">
            {mine.map((d) => (
              <li key={d.address}>
                <span>
                  <span className="num">{usd(Number(d.amountPerPeriod) / 1e6)} USDC</span>
                  <span style={{ color: "var(--ink-3)" }}> / {Math.round(Number(d.periodLengthS) / 3600)}h · to {d.delegatee === delegatee ? "firewall" : short(d.delegatee)} · until {new Date(Number(d.expiryTs) * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                </span>
                <button className="btn bad sm" disabled={busy} onClick={() => run(() => revokeAllowance(signer, address(d.address), (t) => setMsg({ t })), "Allowance revoked")}>
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function ControlsPanel({ status, onChanged }: { status: Status | null; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  if (!status) return null;
  return (
    <section className="panel">
      <div className="panel-head"><h2>Kill switch</h2></div>
      <div className="panel-body stack">
        <p className="help">
          {status.paused ? "Every request is denied until you resume. The on-chain allowance is untouched." : "Pausing denies every new request instantly, without a transaction. Revoke the allowance to cut the delegate off on-chain too."}
        </p>
        <div className="between">
          <button
            className={`btn ${status.paused ? "ok" : "bad"}`}
            disabled={busy}
            onClick={async () => { setBusy(true); try { status.paused ? await api.resume() : await api.pause(); onChanged(); } finally { setBusy(false); } }}
          >
            {status.paused ? "Resume firewall" : "Pause firewall"}
          </button>
          <button className="link" onClick={() => api.refresh().then(onChanged)}>Re-scan chain</button>
        </div>
      </div>
    </section>
  );
}

function PolicyPanel({ status, onSaved }: { status: Status | null; onSaved: () => void }) {
  const [p, setP] = useState<Policy | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { if (status && !p) setP(status.policy); }, [status, p]);
  if (!p) return null;
  const num = (k: keyof Policy, label: string, unit = "USDC") => (
    <div className="field">
      <label>{label}</label>
      <div className="with-unit"><input className="input num" value={String(p[k])} onChange={(e) => setP({ ...p, [k]: Number(e.target.value) })} /><span>{unit}</span></div>
    </div>
  );
  const lines = (k: "trusted_recipients" | "blocked_recipients", label: string) => (
    <div className="field">
      <label>{label}</label>
      <textarea className="input" rows={2} placeholder="one address per line" value={p[k].join("\n")} onChange={(e) => setP({ ...p, [k]: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })} />
    </div>
  );
  return (
    <section className="panel">
      <div className="panel-head"><h2>Policy</h2><span className="meta">off-chain · fine-grained</span></div>
      <div className="panel-body stack">
        <p className="help">At or below auto-allow → allowed. Above hard max → denied. Everything else, or risk ≥ 40 → asks you. Risk ≥ 80 → denied.</p>
        <div className="grid-2">
          {num("auto_allow_max", "Auto-allow up to")}
          {num("hard_max", "Hard max per request")}
          {num("daily_soft_cap", "Daily soft cap")}
          {num("trusted_allow_max", "Trusted recipients up to")}
          {num("max_intents_per_minute", "Rate limit", "/min")}
        </div>
        {lines("trusted_recipients", "Trusted recipients")}
        {lines("blocked_recipients", "Blocked recipients")}
        <div className="between">
          <button className="btn ghost" onClick={async () => { try { await api.savePolicy(p); setMsg("Saved"); onSaved(); } catch (e) { setMsg((e as Error).message); } }}>Save policy</button>
          {msg && <span className="msg" style={{ marginTop: 0 }}>{msg}</span>}
        </div>
      </div>
    </section>
  );
}
