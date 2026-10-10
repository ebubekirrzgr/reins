// Checks devnet readiness: delegate key, SOL balance, facilitator support for solana devnet exact scheme.
import "dotenv/config";
import { readFileSync } from "node:fs";
import { createSolanaRpc, createKeyPairSignerFromBytes, address, lamports } from "@solana/kit";

const rpcUrl = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const keyPath = process.env.DELEGATE_KEYPAIR_PATH ?? "./keys/delegate.json";
const facilitator = process.env.FACILITATOR_URL ?? "https://x402.org/facilitator";
const usdc = process.env.USDC_MINT ?? "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

const rpc = createSolanaRpc(rpcUrl);
const signer = await createKeyPairSignerFromBytes(new Uint8Array(JSON.parse(readFileSync(keyPath, "utf8"))));
console.log("delegate:", signer.address);
const bal = await rpc.getBalance(signer.address).send();
console.log("delegate SOL:", Number(bal.value) / 1e9);
if (bal.value < lamports(10_000_000n)) console.log("  !! fund delegate with devnet SOL (>= 0.01) for tx fees");

const owner = process.env.OWNER_PUBKEY;
if (owner) {
  const atas = await rpc.getTokenAccountsByOwner(address(owner), { mint: address(usdc) }, { encoding: "jsonParsed" }).send();
  const amt = atas.value[0]?.account.data.parsed?.info?.tokenAmount?.uiAmountString ?? "0 (no ATA)";
  console.log("owner USDC:", amt);
}

try {
  const res = await fetch(`${facilitator}/supported`);
  const json = (await res.json()) as { kinds?: { scheme: string; network: string; x402Version: number }[] };
  const ok = json.kinds?.some((k) => k.network === "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1" && k.scheme === "exact");
  console.log(`facilitator ${facilitator} supports solana devnet exact:`, ok ? "yes" : "NO");
} catch (e) {
  console.log("facilitator check failed:", (e as Error).message);
}
