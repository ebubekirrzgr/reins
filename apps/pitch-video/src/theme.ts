import { loadFont as loadSans } from "@remotion/google-fonts/IBMPlexSans";
import { loadFont as loadMono } from "@remotion/google-fonts/IBMPlexMono";
import { interpolate, spring, Easing } from "remotion";

const sans = loadSans("normal", { weights: ["400", "500", "600"], subsets: ["latin"] });
const mono = loadMono("normal", { weights: ["400", "500"], subsets: ["latin"] });

export const T = {
  paper: "#f4f2ec",
  surface: "#fbfaf7",
  surface2: "#efede6",
  ink: "#17170f",
  ink2: "#4a4a42",
  ink3: "#85857a",
  line: "#dedbd1",
  accent: "#1f3a93",
  ok: "#0f6e56",
  okBg: "#e3f1ec",
  warn: "#9a5b00",
  warnBg: "#f8ecd6",
  bad: "#b42318",
  badBg: "#f8e3e0",
  sans: sans.fontFamily,
  mono: mono.fontFamily,
};

export const FPS = 30;

/** opacity + translateY entrance starting at `start` (frames), lasting `dur`. */
export const rise = (frame: number, start: number, dur = 18, dy = 24) => {
  const t = interpolate(frame, [start, start + dur], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  return { opacity: t, transform: `translateY(${(1 - t) * dy}px)` };
};

export const pop = (frame: number, fps: number, start: number) => {
  const s = spring({ frame: frame - start, fps, config: { damping: 14, stiffness: 160, mass: 0.6 } });
  return { opacity: frame < start ? 0 : 1, transform: `scale(${0.85 + 0.15 * s})` };
};

/** fade out over the last `dur` frames of a sequence of length `len`. */
export const exit = (frame: number, len: number, dur = 12) =>
  interpolate(frame, [len - dur, len], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
