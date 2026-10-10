// Generates the firewall's delegate keypair as a Solana CLI compatible JSON file (64 bytes: seed || pubkey).
// Usage: pnpm keygen [path]   (default ./keys/delegate.json)
import { getAddressFromPublicKey } from "@solana/kit";
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const out = process.argv[2] ?? "./keys/delegate.json";
if (existsSync(out)) {
  console.error(`refusing to overwrite existing keypair at ${out}`);
  process.exit(1);
}
const kp = (await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])) as CryptoKeyPair;
const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", kp.privateKey));
const seed = pkcs8.slice(pkcs8.length - 32);
const pub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
const bytes = new Uint8Array(64);
bytes.set(seed, 0);
bytes.set(pub, 32);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(Array.from(bytes)));
const address = await getAddressFromPublicKey(kp.publicKey);
console.log(`delegate keypair written to ${out}`);
console.log(`delegate address: ${address}`);
console.log(`fund it with devnet SOL for tx fees: https://faucet.solana.com`);
