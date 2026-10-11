import { AbsoluteFill, useCurrentFrame } from "remotion";
import { T, exit, rise } from "../theme";

export const Frame = ({ children, len, kicker, title }: { children?: React.ReactNode; len: number; kicker?: string; title?: string }) => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ padding: "96px 140px", opacity: exit(f, len) }}>
      {kicker && (
        <div style={{ ...rise(f, 0), fontFamily: T.mono, fontSize: 22, color: T.accent, letterSpacing: "0.08em", textTransform: "uppercase" }}>{kicker}</div>
      )}
      {title && <h1 style={{ ...rise(f, 4), fontSize: 64, fontWeight: 600, letterSpacing: "-0.02em", margin: "14px 0 48px", lineHeight: 1.1 }}>{title}</h1>}
      {children}
    </AbsoluteFill>
  );
};

export const Wordmark = ({ size = 28 }: { size?: number }) => (
  <span style={{ fontWeight: 600, letterSpacing: "0.22em", fontSize: size }}>REINS</span>
);

export const Chip = ({ kind, children }: { kind: "ok" | "warn" | "bad" | "muted"; children: React.ReactNode }) => {
  const color = kind === "ok" ? T.ok : kind === "warn" ? T.warn : kind === "bad" ? T.bad : T.ink3;
  const bg = kind === "ok" ? T.okBg : kind === "warn" ? T.warnBg : kind === "bad" ? T.badBg : T.surface2;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10, padding: "6px 14px 6px 10px", borderRadius: 999, background: bg, color, fontSize: 22, fontWeight: 500, whiteSpace: "nowrap" }}>
      <i style={{ width: 10, height: 10, borderRadius: 5, background: color, display: "inline-block" }} />
      {children}
    </span>
  );
};

export const Footer = () => (
  <div style={{ position: "absolute", left: 140, right: 140, bottom: 56, display: "flex", justifyContent: "space-between", fontFamily: T.mono, fontSize: 18, color: T.ink3 }}>
    <span>REINS · agent wallet firewall</span>
    <span>Solana devnet</span>
  </div>
);
