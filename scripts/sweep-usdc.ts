// Sends the delegate's whole USDC balance back to an owner wallet (creates the owner ATA if needed).
// Usage: npx tsx scripts/sweep-usdc.ts <ownerAddress>
import "dotenv/config";
import { readFileSync } from "node:fs";
import {
  address, appendTransactionMessageInstructions, createKeyPairSignerFromBytes, createSolanaRpc, createTransactionMessage,
  getAddressEncoder, getBase64EncodedWireTransaction, getProgramDerivedAddress, getSignatureFromTransaction, pipe,
  setTransactionMessageFeePayerSigner, setTransactionMessageLifetimeUsingBlockhash, signTransactionMessageWithSigners,
  AccountRole, type Address, type Instruction,
} from "@solana/kit";

const TOKEN = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA_PROG = address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const SYSTEM = address("11111111111111111111111111111111");
const MINT = address(process.env.USDC_MINT ?? "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const rpc = createSolanaRpc(process.env.RPC_URL ?? "https://api.devnet.solana.com");

const owner = address(process.argv[2] ?? "");
const signer = await createKeyPairSignerFromBytes(new Uint8Array(JSON.parse(readFileSync(process.env.DELEGATE_KEYPAIR_PATH ?? "./keys/delegate.json", "utf8"))));
const enc = getAddressEncoder();
const ata = async (o: Address) => (await getProgramDerivedAddress({ programAddress: ATA_PROG, seeds: [enc.encode(o), enc.encode(TOKEN), enc.encode(MINT)] }))[0];
const src = await ata(signer.address);
const dst = await ata(owner);
const bal = await rpc.getTokenAccountBalance(src).send();
const amount = BigInt(bal.value.amount);
console.log(`delegate ${signer.address} has ${bal.value.uiAmountString} USDC -> sending to ${owner}`);
if (amount === 0n) process.exit(0);

const createAta: Instruction = {
  programAddress: ATA_PROG,
  accounts: [
    { address: signer.address, role: AccountRole.WRITABLE_SIGNER },
    { address: dst, role: AccountRole.WRITABLE },
    { address: owner, role: AccountRole.READONLY },
    { address: MINT, role: AccountRole.READONLY },
    { address: SYSTEM, role: AccountRole.READONLY },
    { address: TOKEN, role: AccountRole.READONLY },
  ],
  data: new Uint8Array([1]),
};
const data = new Uint8Array(10);
data[0] = 12; // TransferChecked
new DataView(data.buffer).setBigUint64(1, amount, true);
data[9] = 6;
const transfer: Instruction = {
  programAddress: TOKEN,
  accounts: [
    { address: src, role: AccountRole.WRITABLE },
    { address: MINT, role: AccountRole.READONLY },
    { address: dst, role: AccountRole.WRITABLE },
    { address: signer.address, role: AccountRole.READONLY_SIGNER },
  ],
  data,
};
const { value: bh } = await rpc.getLatestBlockhash().send();
const msg = pipe(
  createTransactionMessage({ version: 0 }),
  (m) => setTransactionMessageFeePayerSigner(signer, m),
  (m) => setTransactionMessageLifetimeUsingBlockhash(bh, m),
  (m) => appendTransactionMessageInstructions([createAta, transfer], m),
);
const signed = await signTransactionMessageWithSigners(msg);
const sig = getSignatureFromTransaction(signed);
await rpc.sendTransaction(getBase64EncodedWireTransaction(signed), { encoding: "base64", preflightCommitment: "confirmed" }).send();
for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  const st = await rpc.getSignatureStatuses([sig]).send();
  if (st.value[0]?.err) throw new Error(JSON.stringify(st.value[0].err));
  if (st.value[0]?.confirmationStatus) break;
}
console.log(`done: https://explorer.solana.com/tx/${sig}?cluster=devnet`);
