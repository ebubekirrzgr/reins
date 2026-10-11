import { Composition } from "remotion";
import { Pitch, PITCH_FRAMES } from "./Pitch";
import { FPS } from "./theme";

export const Root = () => (
  <Composition id="Pitch" component={Pitch} durationInFrames={PITCH_FRAMES} fps={FPS} width={1920} height={1080} />
);
