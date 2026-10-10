// Demo merchant: two x402-protected endpoints on Solana devnet (USDC).
//   GET /api/weather   -> cheap  ($0.05)  : should auto-ALLOW in the firewall
//   GET /api/report    -> pricey ($5.00)  : should trigger Telegram ASK
//   GET /free          -> no payment
import { config as loadEnv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
loadEnv({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactSvmScheme } from "@x402/svm/exact/server";

const PORT = Number(process.env.MERCHANT_PORT ?? 4030);
const PAY_TO = process.env.MERCHANT_ADDRESS;
const FACILITATOR_URL = process.env.FACILITATOR_URL ?? "https://x402.org/facilitator";
const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const PRICE_CHEAP = process.env.MERCHANT_PRICE_CHEAP ?? "$0.05";
const PRICE_EXPENSIVE = process.env.MERCHANT_PRICE_EXPENSIVE ?? "$5.00";

if (!PAY_TO) {
  console.error("MERCHANT_ADDRESS is required (any devnet wallet address that will receive USDC)");
  process.exit(1);
}

const app = express();
app.use(express.json());

const facilitator = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
const server = new x402ResourceServer(facilitator).register(DEVNET, new ExactSvmScheme({ rpcUrl: RPC_URL }));

app.use(
  paymentMiddleware(
    {
      "GET /api/weather": {
        accepts: [{ scheme: "exact", price: PRICE_CHEAP, network: DEVNET, payTo: PAY_TO, maxTimeoutSeconds: 120 }],
        description: "Weather for a city (cheap)",
      },
      "GET /api/report": {
        accepts: [{ scheme: "exact", price: PRICE_EXPENSIVE, network: DEVNET, payTo: PAY_TO, maxTimeoutSeconds: 120 }],
        description: "Full market research report (expensive)",
      },
    },
    server,
  ),
);

app.get("/free", (_req, res) => res.json({ ok: true, message: "free endpoint, no payment" }));
app.get("/api/weather", (req, res) => {
  const city = String(req.query.city ?? "Istanbul");
  res.json({ city, tempC: 21, condition: "partly cloudy", paid: PRICE_CHEAP });
});
app.get("/api/report", (_req, res) => {
  res.json({
    title: "Solana AI-agent payments: Q4 outlook",
    pages: 42,
    summary: `Agents will transact autonomously; owners need caps + human-in-the-loop. (You paid ${PRICE_EXPENSIVE} for this.)`,
  });
});

app.listen(PORT, () => {
  console.log(`[merchant] listening on http://localhost:${PORT}  payTo=${PAY_TO}  facilitator=${FACILITATOR_URL}`);
  console.log(`[merchant] GET /api/weather (${PRICE_CHEAP})  GET /api/report (${PRICE_EXPENSIVE})  GET /free`);
});
