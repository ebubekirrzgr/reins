import { TL } from "./sim/timeline";
/** narration clips per scene: [file, start frame within the scene] */
export const VO: Record<string, [string, number][]> = {
  title: [["vo/title.wav", 10]],
  problem: [["vo/problem.wav", 10]],
  thesis: [["vo/thesis.wav", 8]],
  simulation: [
    ["vo/connect.wav", 15],
    ["vo/grant.wav", TL.grantClick - 10],
    ["vo/s1.wav", TL.s1cmd - 5],
    ["vo/s2.wav", TL.s2cmd - 5],
    ["vo/tap.wav", TL.tap - 5],
    ["vo/s3.wav", TL.s3cmd - 5],
    ["vo/pause.wav", TL.pauseClick - 10],
    ["vo/outro.wav", TL.outro + 5],
  ],
  why: [["vo/why.wav", 10]],
  close: [["vo/close.wav", 20]],
};
