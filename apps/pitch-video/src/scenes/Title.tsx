import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import { T, exit, pop, rise } from "../theme";

export const Title = ({ len }: { len: number }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const lineW = interpolate(f, [20, 50], [0, 160], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: exit(f, len) }}>
      <div style={{ ...pop(f, fps, 2), width: 112, height: 112, borderRadius: 24, background: T.ink, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ color: T.paper, fontSize: 64, fontWeight: 600 }}>R</span>
      </div>
      <div style={{ ...rise(f, 10), marginTop: 36, fontSize: 56, fontWeight: 600, letterSpacing: "0.26em" }}>REINS</div>
      <div style={{ width: lineW, height: 3, background: T.accent, marginTop: 26, borderRadius: 2 }} />
      <div style={{ ...rise(f, 30), marginTop: 26, fontSize: 32, color: T.ink2 }}>The approval layer for AI-agent wallets on Solana</div>
      <div style={{ ...rise(f, 48), marginTop: 18, fontFamily: T.mono, fontSize: 22, color: T.ink3 }}>Give your agent reins, not keys.</div>
    </AbsoluteFill>
  );
};
