import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { T, exit, pop, rise } from "../theme";

const words: { w: string; c: string }[] = [
  { w: "Agent asks.", c: T.ink },
  { w: "Policy filters.", c: T.accent },
  { w: "Human approves.", c: T.warn },
  { w: "Chain caps.", c: T.ok },
];

export const Thesis = ({ len }: { len: number }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: exit(f, len) }}>
      <div style={{ ...rise(f, 0), fontFamily: T.mono, fontSize: 22, color: T.ink3, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 40 }}>REINS in one sentence</div>
      <div style={{ display: "flex", gap: 28, flexWrap: "wrap", justifyContent: "center", maxWidth: 1500 }}>
        {words.map((x, i) => (
          <span key={x.w} style={{ ...pop(f, fps, 14 + i * 26), fontSize: 84, fontWeight: 600, letterSpacing: "-0.03em", color: x.c }}>{x.w}</span>
        ))}
      </div>
      <div style={{ ...rise(f, 130), marginTop: 56, fontSize: 30, color: T.ink2, maxWidth: 1300, textAlign: "center", lineHeight: 1.4 }}>
        Three layers. Each one catches the failure of the layer above it. The agent never holds a key — it can only ask.
      </div>
    </AbsoluteFill>
  );
};
