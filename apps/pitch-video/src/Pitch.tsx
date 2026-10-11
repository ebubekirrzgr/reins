import { AbsoluteFill, Audio, Sequence, interpolate, staticFile } from "remotion";
import { VO } from "./voiceover";
import { T } from "./theme";
import { Title } from "./scenes/Title";
import { Problem } from "./scenes/Problem";
import { Thesis } from "./scenes/Thesis";
import { Simulation } from "./scenes/Simulation";
import { TL } from "./sim/timeline";
import { WhySolana } from "./scenes/WhySolana";
import { Close } from "./scenes/Close";

// scene lengths in frames (30 fps)
export const SCENES = [
  { id: "title", len: 160, C: Title },
  { id: "problem", len: 390, C: Problem },
  { id: "thesis", len: 260, C: Thesis },
  { id: "simulation", len: TL.len, C: Simulation },
  { id: "why", len: 410, C: WhySolana },
  { id: "close", len: 170, C: Close },
] as const;
export const PITCH_FRAMES = SCENES.reduce((a, s) => a + s.len, 0);

export const Pitch = () => {
  let from = 0;
  return (
    <AbsoluteFill style={{ background: T.paper, fontFamily: T.sans, color: T.ink }}>
      <Audio
        src={staticFile("music.wav")}
        volume={(fr) => interpolate(fr, [0, 40, PITCH_FRAMES - 90, PITCH_FRAMES - 5], [0, 0.16, 0.16, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}
      />
      {SCENES.map((s) => {
        const el = (
          <Sequence key={s.id} from={from} durationInFrames={s.len} name={s.id}>
            <s.C len={s.len} />
            {(VO[s.id] ?? []).map(([file, at]) => (
              <Sequence key={file} from={at} name={file}>
                <Audio src={staticFile(file)} volume={1} />
              </Sequence>
            ))}
          </Sequence>
        );
        from += s.len;
        return el;
      })}
    </AbsoluteFill>
  );
};
