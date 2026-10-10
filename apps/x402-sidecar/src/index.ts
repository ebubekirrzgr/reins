// REINS x402 sidecar.
// Two jobs, both driven by the Rust firewall:
//   POST /quote  -> perform the request WITHOUT paying; if 402, return the decoded payment requirements.
//   POST /pay    -> perform the request WITH the standard x402 flow (wrapFetchWithPayment), but only
//                   accept a requirement that matches what the firewall approved (amount/payTo/asset).
// The hot wallet is the firewall's delegate key. It is normally empty: the firewall JIT-funds it
// via TransferRecurring right before calling /pay.
import { config as loadEnv } from "dotenv";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
loadEnv({ path: resolve(ROOT, ".env") });
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { x402Client, x402HTTPClient, type SelectPaymentRequirements } from "@x402/core/client";
import { decodePaymentResponseHeader } from "@x402/core/http";
import type { PaymentRequirements, PaymentRequired } from "@x402/core/types";
import { wrapFetchWithPayment } from "@x402/fetch";
import { ExactSvmScheme } from "@x402/svm/exact/client";

const PORT = Number(process.env.SIDECAR_PORT ?? 4020);
const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const KEY_PATH = resolve(ROOT, process.env.DELEGATE_KEYPAIR_PATH ?? "keys/delegate.json");
const DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";

const signer = await createKeyPairSignerFromBytes(new Uint8Array(JSON.parse(readFileSync(KEY_PATH, "utf8"))));
console.log(`[sidecar] hot wallet (delegate) = ${signer.address}`);

type Quote = {
  scheme: string;
  network: string;
  asset: string;
  amount: string; // atomic units
  payTo: string;
  maxTimeoutSeconds: number;
  extra: Record<string, unknown>;
};

type ReqBody = {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string | null; // raw string body (JSON already serialized by caller)
  expected?: { amount: string; payTo: string; asset: string; network?: string };
};

function toQuote(r: PaymentRequirements): Quote {
  return {
    scheme: r.scheme,
    network: r.network,
    asset: r.asset,
    amount: r.amount,
    payTo: r.payTo,
    maxTimeoutSeconds: r.maxTimeoutSeconds,
    extra: r.extra ?? {},
  };
}

async function readBody(res: Response): Promise<{ contentType: string; body: string; json?: unknown }> {
  const contentType = res.headers.get("content-type") ?? "";
  const text = await res.text();
  let json: unknown;
  if (contentType.includes("application/json")) {
    try {
      json = JSON.parse(text);
    } catch {
      /* keep text */
    }
  }
  return { contentType, body: text, json };
}

function pickHeaders(res: Response): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ["content-type", "payment-response", "payment-required", "x-payment-response"]) {
    const v = res.headers.get(k);
    if (v) out[k] = v;
  }
  return out;
}

const app = new Hono();

app.get("/health", (c) => c.json({ ok: true, hotWallet: signer.address, network: DEVNET }));

// ---- /quote: never pays. Returns requirements if the upstream wants money. ----
app.post("/quote", async (c) => {
  const req = (await c.req.json()) as ReqBody;
  const method = (req.method ?? "GET").toUpperCase();
  let res: Response;
  try {
    res = await fetch(req.url, {
      method,
      headers: req.headers,
      body: method === "GET" || method === "HEAD" ? undefined : (req.body ?? undefined),
    });
  } catch (e) {
    return c.json({ error: `upstream unreachable: ${(e as Error).cause ?? (e as Error).message}` }, 502);
  }
  const { contentType, body, json } = await readBody(res);

  if (res.status !== 402) {
    return c.json({ paymentRequired: false, status: res.status, contentType, body, headers: pickHeaders(res) });
  }

  // Decode PaymentRequired (v2: PAYMENT-REQUIRED header or JSON body; v1: JSON body).
  const probe = new x402HTTPClient(new x402Client().register("solana:*", new ExactSvmScheme(signer, { rpcUrl: RPC_URL })));
  let pr: PaymentRequired;
  try {
    pr = probe.getPaymentRequiredResponse((n) => res.headers.get(n), json);
  } catch (e) {
    return c.json({ paymentRequired: true, status: 402, error: `cannot decode payment requirements: ${(e as Error).message}`, body }, 502);
  }
  const accepts = pr.accepts.map(toQuote);
  const solana = accepts.filter((a) => a.network.startsWith("solana:") && a.scheme === "exact");
  return c.json({
    paymentRequired: true,
    status: 402,
    x402Version: pr.x402Version,
    resource: pr.resource,
    accepts,
    selected: solana[0] ?? null,
  });
});

// ---- /pay: standard x402 payment, constrained to the firewall-approved requirement. ----
app.post("/pay", async (c) => {
  const req = (await c.req.json()) as ReqBody;
  const method = (req.method ?? "GET").toUpperCase();
  const expected = req.expected;
  if (!expected) return c.json({ error: "expected {amount,payTo,asset} is required" }, 400);

  const selector: SelectPaymentRequirements = (_version, accepts) => {
    const match = accepts.find(
      (a) =>
        a.scheme === "exact" &&
        a.network.startsWith("solana:") &&
        a.payTo === expected.payTo &&
        a.asset === expected.asset &&
        BigInt(a.amount) <= BigInt(expected.amount),
    );
    if (!match) {
      throw new Error(
        `upstream requirements changed: approved ${expected.amount} to ${expected.payTo} (${expected.asset}); got ${JSON.stringify(
          accepts.map((a) => ({ amount: a.amount, payTo: a.payTo, asset: a.asset, network: a.network })),
        )}`,
      );
    }
    return match;
  };
  // The firewall is the policy layer; the client's built-in $1/payment spend control would double-gate.
  const client = new x402Client(selector).setSpendControls(false).register("solana:*", new ExactSvmScheme(signer, { rpcUrl: RPC_URL }));
  const paidFetch = wrapFetchWithPayment(fetch, client);

  try {
    const res = await paidFetch(req.url, {
      method,
      headers: req.headers,
      body: method === "GET" || method === "HEAD" ? undefined : (req.body ?? undefined),
    });
    const { contentType, body } = await readBody(res);
    if (res.status === 402) {
      let reason = "payment rejected by upstream";
      const pr = res.headers.get("PAYMENT-REQUIRED");
      if (pr) {
        try {
          reason = `payment rejected: ${(JSON.parse(atob(pr)) as { error?: string }).error ?? reason}`;
        } catch {
          /* keep default */
        }
      }
      return c.json({ error: reason, status: 402, body }, 502);
    }
    const prHeader = res.headers.get("PAYMENT-RESPONSE") ?? res.headers.get("X-PAYMENT-RESPONSE");
    let settle: unknown = null;
    if (prHeader) {
      try {
        settle = decodePaymentResponseHeader(prHeader);
      } catch {
        settle = { raw: prHeader };
      }
    }
    return c.json({ status: res.status, contentType, body, headers: pickHeaders(res), settle });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});

app.onError((e, c) => c.json({ error: e.message }, 500));

serve({ fetch: app.fetch, port: PORT }, () => console.log(`[sidecar] listening on http://127.0.0.1:${PORT}`));
