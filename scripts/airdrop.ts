// Devnet SOL airdrop without the Solana CLI. Usage: npx tsx scripts/airdrop.ts [address] [sol]
import "dotenv/config";
import { readFileSync } from "node:fs";
import { createSolanaRpc, address, lamports, createKeyPairSignerFromBytes } from "@solana/kit";

const rpc = createSolanaRpc(process.env.RPC_URL ?? "https://api.devnet.solana.com");
const target = process.argv[2]
  ? address(process.argv[2])
  : (await createKeyPairSignerFromBytes(new Uint8Array(JSON.parse(readFileSync(process.env.DELEGATE_KEYPAIR_PATH ?? "./keys/delegate.json", "utf8"))))).address;
const sol = Number(process.argv[3] ?? "1");
console.log(`airdrop ${sol} SOL -> ${target}`);
try {
  const sig = await rpc.requestAirdrop(target, lamports(BigInt(Math.round(sol * 1e9)))).send();
  console.log("signature:", sig);
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const st = await rpc.getSignatureStatuses([sig]).send();
    if (st.value[0]?.confirmationStatus) break;
  }
} catch (e) {
  console.log("airdrop failed:", (e as Error).message);
  console.log("devnet faucet is rate-limited; use https://faucet.solana.com or send from Phantom instead");
}
const bal = await rpc.getBalance(target).send();
console.log("balance:", Number(bal.value) / 1e9, "SOL");
