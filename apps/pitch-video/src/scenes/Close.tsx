import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { T, exit, pop, rise } from "../theme";

export const Close = ({ len }: { len: number }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: exit(f, len, 20) }}>
      <div style={{ ...pop(f, fps, 0), width: 96, height: 96, borderRadius: 22, background: T.ink, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ color: T.paper, fontSize: 56, fontWeight: 600 }}>R</span>
      </div>
      <div style={{ ...rise(f, 10), marginTop: 30, fontSize: 48, fontWeight: 600, letterSpacing: "0.26em" }}>REINS</div>
      <div style={{ ...rise(f, 26), marginTop: 26, fontSize: 40, fontWeight: 500 }}>Give your agent reins, not keys.</div>
      <div style={{ ...rise(f, 50), marginTop: 36, display: "flex", gap: 40, fontFamily: T.mono, fontSize: 24, color: T.ink3 }}>
        <span>github.com/ebubekirrzgr/reins</span>
        <span>Rust · Next.js · x402 · Solana devnet</span>
      </div>
      <div style={{ ...rise(f, 70), marginTop: 28, fontSize: 22, color: T.ink3 }}>Next: mainnet · multisig approvals · on-chain spending receipts</div>
    </AbsoluteFill>
  );
};
