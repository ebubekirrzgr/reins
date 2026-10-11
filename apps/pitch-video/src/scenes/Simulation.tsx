import { AbsoluteFill, useCurrentFrame, interpolate } from "remotion";
import { T, exit, rise } from "../theme";
import { Dashboard } from "../sim/Dashboard";
import { Terminal } from "../sim/Terminal";
import { Phone } from "../sim/Phone";
import { TL } from "../sim/timeline";

const captions: { from: number; to: number; text: string }[] = [
  { from: 20, to: TL.grantClick, text: "The owner connects Phantom. Funds stay in this wallet the whole time." },
  { from: TL.phantomOpen, to: TL.allowanceLive + 25, text: "One signature grants the firewall a recurring allowance: 20 USDC per day, 30 days, enforced on-chain." },
  { from: TL.s1cmd, to: TL.s1done + 40, text: "Scenario 1 — a five-cent API call. Policy allows it, the firewall pulls from the allowance, x402 settles. No human." },
  { from: TL.s2cmd, to: TL.phoneCard + 60, text: "Scenario 2 — a five-dollar report. Policy asks. The owner's phone gets the card." },
  { from: TL.tap, to: TL.s2done + 40, text: "One tap. The firewall executes TransferRecurring and pays the merchant." },
  { from: TL.s3cmd, to: TL.s3done + 50, text: "Scenario 3 — a prompt-injected transfer. Denied at risk 100. Never reaches the phone, never reaches the chain." },
  { from: TL.pauseClick - 20, to: TL.resumed + 20, text: "Kill switch: pause, and every request is denied instantly. Resume when you're back." },
  { from: TL.outro, to: TL.len, text: "The agent never held a key. The owner never left custody. The chain held the ceiling." },
];

export const Simulation = ({ len }: { len: number }) => {
  const f = useCurrentFrame();
  const cap = captions.find((c) => f >= c.from && f < c.to);
  const capOp = cap ? interpolate(f, [cap.from, cap.from + 10, cap.to - 10, cap.to], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 0;
  return (
    <AbsoluteFill style={{ background: "#e9e6de", opacity: exit(f, len, 18) }}>
      <div style={{ position: "absolute", left: 0, top: 0 }}><Dashboard /></div>
      <div style={{ position: "absolute", left: 1264, top: 24, width: 632, ...rise(f, 6, 20, 16) }}>
        <Terminal height={452} />
      </div>
      <div style={{ position: "absolute", left: 1264, top: 500, width: 632, ...rise(f, 14, 20, 16) }}>
        <Phone height={556} />
      </div>
      {cap && (
        <div style={{ position: "absolute", left: 24, bottom: 22, maxWidth: 1190, opacity: capOp, background: "rgba(23,23,15,.92)", color: T.paper, padding: "12px 18px", borderRadius: 10, fontSize: 22, lineHeight: 1.35, fontFamily: T.sans }}>{cap.text}</div>
      )}
    </AbsoluteFill>
  );
};
