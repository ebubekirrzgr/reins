// Procedural ambient bed: slow chord pad, no samples, ~90 s stereo 44.1 kHz WAV.
import { writeFileSync } from "node:fs";
const SR = 44100, SECS = 92, N = SR * SECS;
const chords = [[220, 261.63, 329.63, 392], [174.61, 220, 261.63, 329.63], [130.81, 196, 246.94, 329.63], [196, 246.94, 293.66, 392]]; // Am7 F C G
const L = new Float32Array(N), R = new Float32Array(N);
const BAR = 6; // seconds per chord
for (let i = 0; i < N; i++) {
  const t = i / SR;
  const ci = Math.floor(t / BAR) % chords.length, tin = (t % BAR) / BAR;
  const env = Math.sin(Math.PI * tin) ** 0.6; // swell per chord
  let l = 0, r = 0;
  chords[ci].forEach((f0, k) => {
    const det = 1 + (k - 1.5) * 0.0012;
    const a = Math.sin(2 * Math.PI * f0 * det * t) * 0.6 + Math.sin(2 * Math.PI * f0 * 2 * det * t) * 0.12 + Math.sin(2 * Math.PI * f0 * 0.5 * t) * 0.25;
    const pan = (k - 1.5) / 3;
    l += a * (1 - pan * 0.5); r += a * (1 + pan * 0.5);
  });
  const lfo = 0.85 + 0.15 * Math.sin(2 * Math.PI * 0.11 * t);
  const g = 0.055 * env * lfo;
  L[i] = l * g; R[i] = r * g;
}
// simple one-pole low-pass for warmth
let pl = 0, pr = 0; const a = 0.08;
for (let i = 0; i < N; i++) { pl += a * (L[i] - pl); pr += a * (R[i] - pr); L[i] = pl; R[i] = pr; }
const buf = Buffer.alloc(44 + N * 4);
buf.write("RIFF", 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write("WAVE", 8); buf.write("fmt ", 12);
buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
buf.write("data", 36); buf.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) { buf.writeInt16LE(Math.max(-1, Math.min(1, L[i])) * 32767, 44 + i * 4); buf.writeInt16LE(Math.max(-1, Math.min(1, R[i])) * 32767, 46 + i * 4); }
writeFileSync("public/music.wav", buf);
console.log("public/music.wav", (buf.length / 1e6).toFixed(1), "MB");
