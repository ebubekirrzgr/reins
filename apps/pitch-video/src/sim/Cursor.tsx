import { interpolate, useCurrentFrame, Easing } from "remotion";
import { CURSOR } from "./timeline";

export const Cursor = () => {
  const f = useCurrentFrame();
  let x = CURSOR[0].x, y = CURSOR[0].y;
  for (let i = 0; i < CURSOR.length - 1; i++) {
    const a = CURSOR[i], b = CURSOR[i + 1];
    if (f >= a.at && f <= b.at) {
      const t = interpolate(f, [a.at, b.at], [0, 1], { easing: Easing.inOut(Easing.quad) });
      x = a.x + (b.x - a.x) * t; y = a.y + (b.y - a.y) * t;
      break;
    }
    if (f > b.at) { x = b.x; y = b.y; }
  }
  const click = CURSOR.find((k) => k.click && f >= k.at && f < k.at + 8);
  const s = click ? 0.85 : 1;
  return (
    <div style={{ position: "absolute", left: x, top: y, transform: `scale(${s})`, transformOrigin: "top left", zIndex: 50, pointerEvents: "none", filter: "drop-shadow(0 2px 3px rgba(0,0,0,.35))" }}>
      <svg width="26" height="30" viewBox="0 0 26 30"><path d="M2 2 L2 24 L8 18 L12 28 L16 26 L12 17 L21 17 Z" fill="#111" stroke="#fff" strokeWidth="1.5" /></svg>
      {click && <div style={{ position: "absolute", left: -14, top: -14, width: 44, height: 44, borderRadius: 22, border: "3px solid rgba(31,58,147,.6)" }} />}
    </div>
  );
};
