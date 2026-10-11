import { useCurrentFrame, interpolate } from "remotion";
import { T, rise } from "../theme";
import { TERMINAL } from "./timeline";

const colors = { muted: "#8b93a1", ok: "#5fd3a2", bad: "#ff7a8a", warn: "#f3c969", accent: "#9db4ff" };

export const Terminal = ({ height }: { height: number }) => {
  const f = useCurrentFrame();
  const lines = TERMINAL.filter((l) => f >= l.at);
  const lastCmd = [...TERMINAL].reverse().find((l) => l.cmd && f >= l.at);
  const shown = lines.slice(-40);
  return (
    <div style={{ height, background: "#0f1117", borderRadius: 12, border: "1px solid #272b36", boxShadow: "0 20px 60px rgba(0,0,0,.25)", overflow: "hidden", fontFamily: T.mono, fontSize: 14.5, color: "#e6e9f0", display: "flex", flexDirection: "column" }}>
      <div style={{ height: 40, display: "flex", alignItems: "center", gap: 8, padding: "0 14px", borderBottom: "1px solid #272b36", background: "#151821" }}>
        <i style={{ width: 11, height: 11, borderRadius: 6, background: "#ff5f57" }} /><i style={{ width: 11, height: 11, borderRadius: 6, background: "#febc2e" }} /><i style={{ width: 11, height: 11, borderRadius: 6, background: "#28c840" }} />
        <span style={{ marginLeft: 10, color: "#8b93a1", fontSize: 13 }}>demo agent — zsh · reins</span>
      </div>
      <div style={{ padding: "14px 18px", lineHeight: 1.5, flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
        {shown.map((l) => {
          if (l.cmd) {
            const typed = Math.floor(interpolate(f, [l.at, l.at + 14], [0, l.text.length], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
            return (
              <div key={l.at} style={{ marginTop: shown[0] === l ? 0 : 12 }}>
                <span style={{ color: "#5fd3a2" }}>➜</span> <span style={{ color: "#9db4ff" }}>reins</span> <span style={{ color: "#8b93a1" }}>$</span> {l.text.slice(0, typed)}
                {f < l.at + 16 && <span style={{ display: "inline-block", width: 9, height: 17, background: "#e6e9f0", verticalAlign: "-3px", marginLeft: 2 }} />}
              </div>
            );
          }
          return (
            <div key={l.at} style={{ ...rise(f, l.at, 8, 6), color: l.color ? colors[l.color] : "#e6e9f0", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{l.text}</div>
          );
        })}
        {!lastCmd && <div><span style={{ color: "#5fd3a2" }}>➜</span> <span style={{ color: "#9db4ff" }}>reins</span> <span style={{ color: "#8b93a1" }}>$</span> <span style={{ display: "inline-block", width: 9, height: 17, background: "#e6e9f0", verticalAlign: "-3px", opacity: Math.floor(f / 15) % 2 ? 1 : 0 }} /></div>}
      </div>
    </div>
  );
};
