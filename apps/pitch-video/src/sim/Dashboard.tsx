import { useCurrentFrame, interpolate } from "remotion";
import { T, rise, pop } from "../theme";
import { DELEGATE, OWNER, ROWS, TL, rowState } from "./timeline";
import { Cursor } from "./Cursor";

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const usd = (n: number) => n.toFixed(2);

const Chip = ({ kind, children }: { kind: "ok" | "warn" | "bad" | "muted"; children: React.ReactNode }) => {
  const color = kind === "ok" ? T.ok : kind === "warn" ? T.warn : kind === "bad" ? T.bad : T.ink3;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 7, height: 28, padding: "0 11px 0 9px", border: `1px solid ${T.line}`, borderRadius: 999, background: T.surface, fontSize: 13, color: T.ink2, whiteSpace: "nowrap" }}>
      <i style={{ width: 7, height: 7, borderRadius: 4, background: color, boxShadow: kind !== "muted" ? `0 0 0 3px ${color}22` : undefined }} />{children}
    </span>
  );
};

const Btn = ({ children, kind = "primary", style }: { children: React.ReactNode; kind?: "primary" | "ghost" | "bad" | "ok"; style?: React.CSSProperties }) => {
  const base: React.CSSProperties = { display: "inline-flex", alignItems: "center", justifyContent: "center", height: 34, padding: "0 13px", borderRadius: 6, fontSize: 14, fontWeight: 500, whiteSpace: "nowrap", border: `1px solid ${T.line}` };
  const k: Record<string, React.CSSProperties> = {
    primary: { background: T.ink, color: "#fff", borderColor: T.ink },
    ghost: { background: "transparent", color: T.ink },
    bad: { background: "transparent", color: T.bad },
    ok: { background: T.ok, color: "#fff", borderColor: T.ok },
  };
  return <span style={{ ...base, ...k[kind], ...style }}>{children}</span>;
};

const Status = ({ s, by }: { s: string; by?: string }) => {
  const map: Record<string, [string, string]> = {
    evaluating: [T.ink3, "Evaluating"], allowed: [T.ok, "Allowed"], awaiting: [T.warn, "Awaiting you"], executing: [T.warn, "Executing"], settled: [T.ok, "Settled"], denied: [T.bad, "Denied"],
  };
  const [c, label] = map[s];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 14, whiteSpace: "nowrap" }}>
      <i style={{ width: 7, height: 7, borderRadius: 4, background: c }} />{label}{by && <span style={{ color: T.ink3, fontSize: 12 }}>by {by}</span>}
    </span>
  );
};

export const Dashboard = () => {
  const f = useCurrentFrame();
  const connected = f >= TL.connected;
  const live = f >= TL.allowanceLive;
  const paused = f >= TL.paused && f < TL.resumed;
  const settledSum = ROWS.reduce((a, r) => { const s = rowState(r, f); return a + (s && (s.status === "settled" || s.status === "executing" || s.status === "allowed" || s.status === "awaiting") ? Number(r.amount) : 0); }, 0);
  const pulled = ROWS.reduce((a, r) => { const s = rowState(r, f); return a + (s && (s.status === "settled" || s.status === "executing") ? Number(r.amount) : 0); }, 0);
  const cap = 20;
  const pending = ROWS.filter((r) => rowState(r, f)?.status === "awaiting");
  const visible = ROWS.filter((r) => f >= r.appear).reverse();
  const hot = ROWS.some((r) => rowState(r, f)?.status === "executing") ? Number(ROWS.find((r) => rowState(r, f)?.status === "executing")!.amount) : 0;
  const toast = f >= TL.toast && f < TL.toast + 110;
  const phantom = f >= TL.phantomOpen && f < TL.phantomClose;

  return (
    <div style={{ position: "relative", width: 1240, height: 1080, background: T.paper, fontFamily: T.sans, color: T.ink, fontSize: 14, overflow: "hidden", borderRight: `1px solid ${T.line}`, ...rise(f, TL.dashboardIn, 20, 0) }}>
      {/* topbar */}
      <div style={{ height: 58, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 24px", borderBottom: `1px solid ${T.line}`, background: T.surface }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
          <span style={{ fontWeight: 600, letterSpacing: "0.18em", fontSize: 15 }}>REINS</span>
          <span style={{ color: T.ink3, fontSize: 13 }}>agent wallet firewall · <b style={{ color: T.ink2, fontWeight: 500 }}>Solana devnet</b></span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Chip kind={paused ? "bad" : "ok"}>{paused ? "Paused" : "Active"}</Chip>
          <Chip kind="ok">Telegram linked</Chip>
          {connected ? <Btn kind="ghost"><span style={{ fontFamily: T.mono, fontSize: 13 }}>{short(OWNER)}</span><span style={{ color: T.ink3, marginLeft: 6 }}>· disconnect</span></Btn> : <Btn>Connect Phantom</Btn>}
        </div>
      </div>
      {/* stats */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 360px", borderBottom: `1px solid ${T.line}`, background: T.surface }}>
        {[
          { label: "On-chain cap · this period", value: live ? usd(pulled) : "—", small: live ? `of ${usd(cap)} USDC` : "no allowance", note: live ? `${usd(cap - pulled)} USDC left · resets in 24h` : "Grant one from the Allowance panel", bar: live ? (pulled / cap) * 100 : null },
          { label: "Spent today", value: usd(settledSum), small: "USDC", note: "soft cap 20.00 USDC" },
          { label: "Waiting for approval", value: String(pending.length), small: "", note: "auto-reject after 10 min" },
          { label: "Hot wallet", value: usd(hot), small: "USDC", note: `${short(DELEGATE)} · 0.947 SOL for fees` },
        ].map((s, i) => (
          <div key={s.label} style={{ padding: "16px 24px", borderRight: i < 3 ? `1px solid ${i === 2 ? T.line : "#ebe8df"}` : 0 }}>
            <div style={{ fontSize: 12.5, color: T.ink3, marginBottom: 6 }}>{s.label}</div>
            <div style={{ fontFamily: T.mono, fontSize: 26, letterSpacing: "-0.02em" }}>{s.value}<span style={{ fontSize: 13, color: T.ink3, marginLeft: 6, fontFamily: T.mono }}>{s.small}</span></div>
            {s.bar != null && <div style={{ height: 4, background: "#ebe8df", borderRadius: 2, marginTop: 10, overflow: "hidden" }}><div style={{ width: `${s.bar}%`, height: "100%", background: T.accent }} /></div>}
            <div style={{ fontSize: 12.5, color: T.ink3, marginTop: 6 }}>{s.note}</div>
          </div>
        ))}
      </div>
      {/* body */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", height: 1080 - 58 - 118 }}>
        <div style={{ borderRight: `1px solid ${T.line}`, minWidth: 0 }}>
          {pending.length > 0 && (
            <div style={{ ...pop(f, 30, TL.s2ask), margin: "14px 24px 0", padding: "9px 14px", border: "1px solid #ebd6ad", background: T.warnBg, borderRadius: 6, fontSize: 13.5, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span><b>1 request waiting for you.</b> Decide here or on Telegram.</span>
              <span style={{ display: "flex", gap: 6 }}><Btn kind="ok" style={{ height: 28, fontSize: 12.5 }}>Approve 5.00 USDC</Btn><Btn kind="bad" style={{ height: 28, fontSize: 12.5 }}>Reject</Btn></span>
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", padding: "14px 24px", borderBottom: "1px solid #ebe8df" }}>
            <span style={{ fontSize: 13.5, fontWeight: 600 }}>Spend requests</span><span style={{ fontSize: 12.5, color: T.ink3 }}>live · refreshes every 3s</span>
          </div>
          <div style={{ padding: "0 24px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "60px 1fr 70px 96px 150px 60px", gap: 10, fontSize: 11.5, color: T.ink3, padding: "10px 0 8px", borderBottom: "1px solid #ebe8df" }}>
              <span>When</span><span>Request</span><span style={{ textAlign: "right" }}>Amount</span><span>Risk</span><span>Status</span><span style={{ textAlign: "right" }}>Tx</span>
            </div>
            {visible.length === 0 && <div style={{ padding: "48px 0", textAlign: "center", color: T.ink3, fontSize: 13.5 }}>No requests yet. Run <span style={{ fontFamily: T.mono, background: "#efede6", padding: "2px 6px", borderRadius: 4 }}>pnpm agent</span> to send three.</div>}
            {visible.map((r) => {
              const s = rowState(r, f)!;
              const risk = s.risk ?? 0;
              const rc = risk >= 80 ? T.bad : risk >= 40 ? T.warn : T.ok;
              const age = Math.max(0, Math.floor((f - r.appear) / 30));
              return (
                <div key={r.id} style={{ ...rise(f, r.appear, 14, 10), display: "grid", gridTemplateColumns: "60px 1fr 70px 96px 150px 60px", gap: 10, padding: "11px 0", borderBottom: "1px solid #ebe8df", alignItems: "start" }}>
                  <span style={{ fontFamily: T.mono, fontSize: 12.5, color: T.ink3 }}>{age < 60 ? `${age}s ago` : `${Math.floor(age / 60)}m ago`}</span>
                  <span style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 500, fontSize: 14 }}>{r.kind === "x402" ? <>GET <span style={{ fontFamily: T.mono, fontSize: 13 }}>{r.title.slice(4)}</span></> : <>Transfer to <span style={{ fontFamily: T.mono, fontSize: 13 }}>{r.title.slice(12)}</span></>}<span style={{ color: T.ink3, fontWeight: 400 }}> · research-agent</span></div>
                    <div style={{ fontSize: 12.5, color: s.status === "denied" && risk >= 80 ? T.bad : T.ink3, marginTop: 2 }}>“{r.memo}”</div>
                    {s.reasons && <div style={{ fontSize: 12.5, color: T.ink3, marginTop: 2 }}>{s.reasons.join(" · ")}</div>}
                    {s.status === "awaiting" && <div style={{ display: "flex", gap: 6, marginTop: 6 }}><Btn kind="ok" style={{ height: 26, fontSize: 12 }}>Approve</Btn><Btn kind="ghost" style={{ height: 26, fontSize: 12 }}>Approve + trust</Btn><Btn kind="bad" style={{ height: 26, fontSize: 12 }}>Reject</Btn></div>}
                  </span>
                  <span style={{ fontFamily: T.mono, textAlign: "right" }}>{r.amount}</span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><i style={{ width: 44, height: 4, background: "#ebe8df", borderRadius: 2, overflow: "hidden", display: "block" }}><b style={{ display: "block", width: `${risk}%`, height: "100%", background: rc }} /></i><span style={{ fontFamily: T.mono, fontSize: 12 }}>{risk}</span></span>
                  <Status s={s.status} by={s.by} />
                  <span style={{ fontFamily: T.mono, fontSize: 12.5, textAlign: "right", color: s.tx ? T.accent : T.ink3 }}>{s.tx ? `${s.tx.slice(0, 4)}…↗` : "—"}</span>
                </div>
              );
            })}
          </div>
        </div>
        {/* side */}
        <div style={{ background: T.surface }}>
          <div style={{ padding: "14px 22px 18px", borderBottom: `1px solid ${T.line}` }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ fontSize: 13.5, fontWeight: 600 }}>Allowance</span>{connected && <span style={{ fontFamily: T.mono, fontSize: 12.5, color: T.ink3 }}>{short(OWNER)}</span>}</div>
            {!connected ? (
              <p style={{ color: T.ink3, fontSize: 13, lineHeight: 1.5, margin: "10px 0 0" }}>Connect a wallet on devnet to grant the firewall a recurring USDC allowance. Funds stay in your wallet; the program enforces the cap on-chain.</p>
            ) : (
              <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 14px", fontSize: 13 }}>
                  <span style={{ color: T.ink3 }}>Your USDC</span><span style={{ fontFamily: T.mono }}>{usd(20 - pulled)}</span>
                  <span style={{ color: T.ink3 }}>Delegate</span><span style={{ fontFamily: T.mono }}>{short(DELEGATE)}</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr", gap: 8 }}>
                  {[["Cap per period", "20", "USDC"], ["Period", "1 day", ""], ["Valid for", "30", "days"]].map(([l, v, u]) => (
                    <div key={l}><div style={{ fontSize: 12, color: T.ink2, marginBottom: 4 }}>{l}</div><div style={{ height: 32, border: `1px solid ${T.line}`, borderRadius: 6, background: "#fff", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 10px", fontFamily: u ? T.mono : T.sans, fontSize: 13 }}><span>{v}</span><span style={{ color: T.ink3, fontSize: 12 }}>{u}</span></div></div>
                  ))}
                </div>
                <Btn style={{ width: "100%" }}>{f >= TL.grantClick && f < TL.toast ? "Working…" : "Grant allowance · 1 signature"}</Btn>
                {toast && <div style={{ ...rise(f, TL.toast, 10, 6), fontFamily: T.mono, fontSize: 12.5, color: T.ok }}>Allowance granted · <span style={{ color: T.accent }}>view tx ↗</span></div>}
                {live && <div style={{ ...rise(f, TL.allowanceLive, 12, 6), borderTop: "1px solid #ebe8df", paddingTop: 9, display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13 }}><span><span style={{ fontFamily: T.mono }}>20.00 USDC</span><span style={{ color: T.ink3 }}> / 24h · to firewall · until Nov 9</span></span><Btn kind="bad" style={{ height: 26, fontSize: 12 }}>Revoke</Btn></div>}
              </div>
            )}
          </div>
          <div style={{ padding: "14px 22px 18px", borderBottom: `1px solid ${T.line}` }}>
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>Kill switch</div>
            <p style={{ color: T.ink3, fontSize: 13, lineHeight: 1.5, margin: "8px 0 12px" }}>{paused ? "Every request is denied until you resume. The on-chain allowance is untouched." : "Pausing denies every new request instantly, without a transaction. Revoke the allowance to cut the delegate off on-chain too."}</p>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><Btn kind={paused ? "ok" : "bad"}>{paused ? "Resume firewall" : "Pause firewall"}</Btn><span style={{ color: T.accent, fontSize: 13 }}>Re-scan chain</span></div>
          </div>
          <div style={{ padding: "14px 22px" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ fontSize: 13.5, fontWeight: 600 }}>Policy</span><span style={{ fontSize: 12.5, color: T.ink3 }}>off-chain · fine-grained</span></div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10 }}>
              {[["Auto-allow up to", "1"], ["Hard max per request", "50"], ["Daily soft cap", "20"], ["Trusted recipients up to", "10"]].map(([l, v]) => (
                <div key={l}><div style={{ fontSize: 12, color: T.ink2, marginBottom: 4 }}>{l}</div><div style={{ height: 32, border: `1px solid ${T.line}`, borderRadius: 6, background: "#fff", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 10px", fontFamily: T.mono, fontSize: 13 }}><span>{v}</span><span style={{ color: T.ink3, fontSize: 12, fontFamily: T.sans }}>USDC</span></div></div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Phantom approval popup */}
      {phantom && (
        <div style={{ position: "absolute", inset: 0, background: "rgba(23,23,15,.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 40 }}>
          <div style={{ ...pop(f, 30, TL.phantomOpen), width: 380, background: "#1c1c22", color: "#f3f3f7", borderRadius: 16, padding: 22, fontFamily: T.sans, boxShadow: "0 30px 80px rgba(0,0,0,.45)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}><span style={{ width: 28, height: 28, borderRadius: 8, background: "#ab9ff2", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#1c1c22", fontWeight: 700 }}>P</span><span style={{ fontWeight: 600 }}>Phantom</span><span style={{ marginLeft: "auto", fontSize: 12, color: "#9b9bab" }}>devnet</span></div>
            <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>Approve transaction</div>
            <div style={{ fontSize: 13, color: "#9b9bab", marginBottom: 16 }}>localhost:3000 · REINS dashboard</div>
            <div style={{ background: "#26262e", borderRadius: 10, padding: 14, fontSize: 13, display: "grid", gridTemplateColumns: "auto 1fr", gap: "8px 16px" }}>
              <span style={{ color: "#9b9bab" }}>Program</span><span>Subscriptions & Allowances</span>
              <span style={{ color: "#9b9bab" }}>Action</span><span>Create recurring delegation</span>
              <span style={{ color: "#9b9bab" }}>Cap</span><span style={{ fontFamily: T.mono }}>20 USDC / day · 30 days</span>
              <span style={{ color: "#9b9bab" }}>Delegate</span><span style={{ fontFamily: T.mono }}>{short(DELEGATE)}</span>
              <span style={{ color: "#9b9bab" }}>Network fee</span><span style={{ fontFamily: T.mono }}>0.000005 SOL</span>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
              <span style={{ flex: 1, height: 42, borderRadius: 10, background: "#2e2e38", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 600 }}>Cancel</span>
              <span style={{ flex: 1, height: 42, borderRadius: 10, background: f >= TL.phantomApprove ? "#8f7fe8" : "#ab9ff2", color: "#1c1c22", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>{f >= TL.phantomApprove ? "Signing…" : "Approve"}</span>
            </div>
          </div>
        </div>
      )}
      <Cursor />
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 24, background: `linear-gradient(transparent, ${T.paper})` }} />
      <span style={{ display: "none" }}>{interpolate(0, [0, 1], [0, 1])}</span>
    </div>
  );
};
