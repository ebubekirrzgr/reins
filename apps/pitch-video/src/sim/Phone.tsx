import { useCurrentFrame, interpolate, Easing } from "remotion";
import { T, pop, rise } from "../theme";
import { MERCHANT, TL } from "./timeline";

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

export const Phone = ({ height }: { height: number }) => {
  const f = useCurrentFrame();
  const w = Math.round(height * 0.485);
  const cardIn = f >= TL.phoneCard;
  const approved = f >= TL.phoneApproved;
  const tap = f >= TL.tap && f < TL.tap + 14;
  const slide = interpolate(f, [TL.phoneCard, TL.phoneCard + 16], [40, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  const time = f < TL.phoneCard ? "22:13" : "22:14";
  const Btn = ({ children, pressed }: { children: React.ReactNode; pressed?: boolean }) => (
    <span style={{ flex: 1, height: 32, borderRadius: 8, background: pressed ? "#cfe3ff" : "#eaf2ff", color: "#1d6fd6", fontSize: 12.5, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", transform: pressed ? "scale(.96)" : undefined }}>{children}</span>
  );
  return (
    <div style={{ width: w, height, borderRadius: 44, background: "#0b0b0e", padding: 10, boxShadow: "0 30px 70px rgba(0,0,0,.35)", position: "relative", margin: "0 auto" }}>
      <div style={{ width: "100%", height: "100%", borderRadius: 36, background: "#ffffff", overflow: "hidden", position: "relative", fontFamily: T.sans }}>
        <div style={{ position: "absolute", top: 10, left: "50%", transform: "translateX(-50%)", width: 92, height: 26, borderRadius: 14, background: "#0b0b0e" }} />
        <div style={{ height: 52, display: "flex", alignItems: "flex-end", justifyContent: "space-between", padding: "0 22px 4px", fontSize: 12, fontWeight: 600 }}><span>{time}</span><span style={{ color: "#555" }}>●●● ▲</span></div>
        <div style={{ height: 54, display: "flex", alignItems: "center", gap: 10, padding: "0 14px", borderBottom: "1px solid #ececf0", background: "#f7f7f9" }}>
          <span style={{ color: "#1d6fd6", fontSize: 14 }}>‹</span>
          <span style={{ width: 34, height: 34, borderRadius: 17, background: T.ink, color: T.paper, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 15 }}>R</span>
          <div><div style={{ fontSize: 14, fontWeight: 600 }}>Reins</div><div style={{ fontSize: 11, color: "#8a8a92" }}>bot</div></div>
        </div>
        <div style={{ padding: 12, background: "#eef0f3", height: "calc(100% - 106px)", display: "flex", flexDirection: "column", gap: 10 }}>
          {!cardIn && (
            <div style={{ alignSelf: "flex-start", background: "#fff", borderRadius: 14, padding: "8px 12px", fontSize: 12.5, maxWidth: "88%", boxShadow: "0 1px 1px rgba(0,0,0,.06)" }}>
              👋 Hi Ebubekir. This chat is now the <b>owner approval channel</b> for REINS.
            </div>
          )}
          {cardIn && (
            <div style={{ alignSelf: "flex-start", background: "#fff", borderRadius: 14, padding: "10px 12px 10px", fontSize: 12, width: "96%", boxShadow: "0 1px 1px rgba(0,0,0,.06)", transform: `translateY(${slide}px)`, lineHeight: 1.4 }}>
              {!approved ? (
                <>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>🛡 REINS — approval needed</div>
                  <div><b>Agent:</b> research-agent</div>
                  <div><b>Type:</b> x402 payment</div>
                  <div><b>Amount:</b> 5.00 USDC</div>
                  <div><b>To:</b> <span style={{ fontFamily: T.mono, fontSize: 11.5 }}>{short(MERCHANT)}</span></div>
                  <div><b>Memo:</b> “buying the Q4 market report”</div>
                  <div style={{ marginTop: 6 }}><b>Risk:</b> 4/100</div>
                  <div>• amount 5.00 above auto-allow limit 1.00</div>
                  <div style={{ marginTop: 6 }}><b>Spent today:</b> 0.05 USDC · <b>cap left:</b> 19.95 of 20.00</div>
                  <div style={{ marginTop: 4, color: "#8a8a92" }}>⏱ Auto-reject in 10 min.</div>
                  <div style={{ display: "flex", gap: 6, marginTop: 8 }}><Btn pressed={tap}>✅ Approve</Btn><Btn>❌ Reject</Btn></div>
                  <div style={{ display: "flex", gap: 6, marginTop: 6 }}><Btn>✅ Approve + trust this recipient</Btn></div>
                </>
              ) : (
                <div style={{ ...rise(f, TL.phoneApproved, 10, 6) }}>
                  <div style={{ fontWeight: 700 }}>✅ Approved — executing on-chain</div>
                  <div>5.00 USDC <span style={{ fontFamily: T.mono, fontSize: 11.5, color: "#8a8a92" }}>8c1f…a2e4</span></div>
                </div>
              )}
              <div style={{ textAlign: "right", fontSize: 10.5, color: "#8a8a92", marginTop: 4 }}>{time}</div>
            </div>
          )}
          {f >= TL.s2settled + 10 && (
            <div style={{ ...pop(f, 30, TL.s2settled + 10), alignSelf: "flex-start", background: "#fff", borderRadius: 14, padding: "8px 12px", fontSize: 12.5, boxShadow: "0 1px 1px rgba(0,0,0,.06)" }}>
              Paid. <span style={{ fontFamily: T.mono, fontSize: 11.5, color: "#1d6fd6" }}>explorer.solana.com/tx/3Tq2…</span>
            </div>
          )}
        </div>
        {/* finger tap */}
        {tap && (
          <div style={{ position: "absolute", left: "30%", top: "63%", width: 44, height: 44, borderRadius: 22, background: "rgba(29,111,214,.25)", border: "2px solid rgba(29,111,214,.6)", transform: `scale(${interpolate(f, [TL.tap, TL.tap + 14], [0.6, 1.3])})`, opacity: interpolate(f, [TL.tap, TL.tap + 14], [1, 0]) }} />
        )}
      </div>
    </div>
  );
};
