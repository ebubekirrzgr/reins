import { useCurrentFrame } from "remotion";
import { T, rise } from "../theme";
import { Footer, Frame } from "./common";

const items = [
  { h: "Audited allowance primitive", b: "The Foundation’s Subscriptions & Allowances program gives recurring, auto-resetting caps as PDAs. REINS ships no cap contract of its own — the layer that must never fail is not ours to get wrong." },
  { h: "x402 is live here", b: "Exact-scheme USDC payments with a public facilitator on devnet. The demo pays a real merchant through a real facilitator in under four seconds." },
  { h: "Finality a human can wait for", b: "Intent → policy → tap → TransferRecurring → settlement, in seconds. On a minute-finality chain an approval queue feels like email." },
  { h: "Fees that survive per-call policy", b: "JIT funding plus settlement costs fractions of a cent, so every five-cent API call gets its own policy check instead of batching and hoping." },
  { h: "Wallet Standard + Kit", b: "One Phantom signature grants the allowance, built with @solana/kit and the Foundation’s generated client. No custom signing flows." },
  { h: "Where the agents are", b: "The agent-payments stack that is actually shipping — x402, facilitators, allowance primitives, USDC-paying services — settles on Solana." },
];

export const WhySolana = ({ len }: { len: number }) => {
  const f = useCurrentFrame();
  return (
    <Frame len={len} kicker="Why Solana" title="Not ported to Solana. Only possible on it.">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "36px 56px" }}>
        {items.map((it, i) => (
          <div key={it.h} style={{ ...rise(f, 20 + i * 22), borderLeft: `3px solid ${T.accent}`, paddingLeft: 22 }}>
            <div style={{ fontSize: 31, fontWeight: 600, marginBottom: 8 }}>{it.h}</div>
            <div style={{ fontSize: 24.5, color: T.ink2, lineHeight: 1.42 }}>{it.b}</div>
          </div>
        ))}
      </div>
      <Footer />
    </Frame>
  );
};
