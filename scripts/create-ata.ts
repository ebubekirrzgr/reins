// Creates the USDC associated token account for <owner>, paid by the delegate key (idempotent).
// Usage: npx tsx scripts/create-ata.ts <ownerAddress>
import "dotenv/config";
import { readFileSync } from "node:fs";
import {
  AccountRole, address, appendTransactionMessageInstructions, createKeyPairSignerFromBytes, createSolanaRpc, createTransactionMessage,
  getAddressEncoder, getBase64EncodedWireTransaction, getProgramDerivedAddress, getSignatureFromTransaction, pipe,
  setTransactionMessageFeePayerSigner, setTransactionMessageLifetimeUsingBlockhash, signTransactionMessageWithSigners, type Instruction,
} from "@solana/kit";
const TOKEN = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA_PROG = address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const SYSTEM = address("11111111111111111111111111111111");
const MINT = address(process.env.USDC_MINT ?? "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const rpc = createSolanaRpc(process.env.RPC_URL ?? "https://api.devnet.solana.com");
const owner = address(process.argv[2] ?? "");
const payer = await createKeyPairSignerFromBytes(new Uint8Array(JSON.parse(readFileSync(process.env.DELEGATE_KEYPAIR_PATH ?? "./keys/delegate.json", "utf8"))));
const enc = getAddressEncoder();
const [ata] = await getProgramDerivedAddress({ programAddress: ATA_PROG, seeds: [enc.encode(owner), enc.encode(TOKEN), enc.encode(MINT)] });
const ix: Instruction = { programAddress: ATA_PROG, accounts: [
  { address: payer.address, role: AccountRole.WRITABLE_SIGNER }, { address: ata, role: AccountRole.WRITABLE }, { address: owner, role: AccountRole.READONLY },
  { address: MINT, role: AccountRole.READONLY }, { address: SYSTEM, role: AccountRole.READONLY }, { address: TOKEN, role: AccountRole.READONLY }], data: new Uint8Array([1]) };
const { value: bh } = await rpc.getLatestBlockhash().send();
const msg = pipe(createTransactionMessage({ version: 0 }), (m) => setTransactionMessageFeePayerSigner(payer, m), (m) => setTransactionMessageLifetimeUsingBlockhash(bh, m), (m) => appendTransactionMessageInstructions([ix], m));
const signed = await signTransactionMessageWithSigners(msg);
const sig = getSignatureFromTransaction(signed);
await rpc.sendTransaction(getBase64EncodedWireTransaction(signed), { encoding: "base64", preflightCommitment: "confirmed" }).send();
for (let i = 0; i < 30; i++) { await new Promise((r) => setTimeout(r, 1500)); const st = await rpc.getSignatureStatuses([sig]).send(); if (st.value[0]?.err) throw new Error(JSON.stringify(st.value[0].err)); if (st.value[0]?.confirmationStatus) break; }
console.log(`ATA ${ata} for ${owner}: https://explorer.solana.com/tx/${sig}?cluster=devnet`);
