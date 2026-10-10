// Dev/e2e setup WITHOUT Phantom: creates a local owner + merchant wallet, funds the owner from the
// delegate (SOL for rent/fees + USDC to spend), and grants the firewall a recurring allowance.
// Usage: npx tsx scripts/dev-setup.ts [usdcToOwner=5] [capPerDay=5] [days=7]
import "dotenv/config";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  AccountRole, address, appendTransactionMessageInstructions, createKeyPairSignerFromBytes, createSolanaRpc, createTransactionMessage,
  getAddressEncoder, getBase64EncodedWireTransaction, getProgramDerivedAddress, getSignatureFromTransaction, pipe,
  setTransactionMessageFeePayerSigner, setTransactionMessageLifetimeUsingBlockhash, signTransactionMessageWithSigners,
  type Address, type Instruction, type KeyPairSigner,
} from "@solana/kit";
import {
  fetchMaybeSubscriptionAuthority, findSubscriptionAuthorityPda, getCreateRecurringDelegationOverlayInstructionAsync,
  getInitSubscriptionAuthorityOverlayInstructionAsync, UNKNOWN_INIT_ID,
} from "@solana/subscriptions";

const TOKEN = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA_PROG = address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const SYSTEM = address("11111111111111111111111111111111");
const MINT = address(process.env.USDC_MINT ?? "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const rpc = createSolanaRpc(process.env.RPC_URL ?? "https://api.devnet.solana.com");
const usdcToOwner = Number(process.argv[2] ?? 5);
const capPerDay = Number(process.argv[3] ?? 5);
const days = Number(process.argv[4] ?? 7);

async function loadOrCreate(path: string): Promise<KeyPairSigner> {
  if (!existsSync(path)) {
    const kp = (await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])) as CryptoKeyPair;
    const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", kp.privateKey));
    const pub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
    const bytes = new Uint8Array(64); bytes.set(pkcs8.slice(-32), 0); bytes.set(pub, 32);
    writeFileSync(path, JSON.stringify(Array.from(bytes)));
  }
  return createKeyPairSignerFromBytes(new Uint8Array(JSON.parse(readFileSync(path, "utf8"))));
}
const enc = getAddressEncoder();
const ata = async (o: Address) => (await getProgramDerivedAddress({ programAddress: ATA_PROG, seeds: [enc.encode(o), enc.encode(TOKEN), enc.encode(MINT)] }))[0];

async function send(payer: KeyPairSigner, ixs: Instruction[], label: string) {
  const { value: bh } = await rpc.getLatestBlockhash().send();
  const msg = pipe(createTransactionMessage({ version: 0 }), (m) => setTransactionMessageFeePayerSigner(payer, m), (m) => setTransactionMessageLifetimeUsingBlockhash(bh, m), (m) => appendTransactionMessageInstructions(ixs, m));
  const signed = await signTransactionMessageWithSigners(msg);
  const sig = getSignatureFromTransaction(signed);
  await rpc.sendTransaction(getBase64EncodedWireTransaction(signed), { encoding: "base64", preflightCommitment: "confirmed" }).send();
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const st = await rpc.getSignatureStatuses([sig]).send();
    if (st.value[0]?.err) throw new Error(`${label} failed: ${JSON.stringify(st.value[0].err)}`);
    if (st.value[0]?.confirmationStatus) break;
  }
  console.log(`${label}: https://explorer.solana.com/tx/${sig}?cluster=devnet`);
}

const delegate = await loadOrCreate(process.env.DELEGATE_KEYPAIR_PATH ?? "./keys/delegate.json");
const owner = await loadOrCreate("./keys/dev-owner.json");
const merchant = await loadOrCreate("./keys/dev-merchant.json");
console.log("delegate:", delegate.address);
console.log("dev owner:", owner.address);
console.log("dev merchant:", merchant.address);

// 1. fund owner: 0.05 SOL + USDC from the delegate
const ownerSol = Number((await rpc.getBalance(owner.address).send()).value) / 1e9;
const ownerAta = await ata(owner.address);
const ownerUsdc = await rpc.getTokenAccountBalance(ownerAta).send().then((b) => Number(b.value.uiAmountString)).catch(() => 0);
console.log(`owner has ${ownerSol} SOL, ${ownerUsdc} USDC`);
const ixs: Instruction[] = [];
if (ownerSol < 0.03) {
  const d = new Uint8Array(12); new DataView(d.buffer).setUint32(0, 2, true); new DataView(d.buffer).setBigUint64(4, 50_000_000n, true);
  ixs.push({ programAddress: SYSTEM, accounts: [{ address: delegate.address, role: AccountRole.WRITABLE_SIGNER }, { address: owner.address, role: AccountRole.WRITABLE }], data: d });
}
if (ownerUsdc < usdcToOwner) {
  ixs.push({ programAddress: ATA_PROG, accounts: [
    { address: delegate.address, role: AccountRole.WRITABLE_SIGNER }, { address: ownerAta, role: AccountRole.WRITABLE }, { address: owner.address, role: AccountRole.READONLY },
    { address: MINT, role: AccountRole.READONLY }, { address: SYSTEM, role: AccountRole.READONLY }, { address: TOKEN, role: AccountRole.READONLY }], data: new Uint8Array([1]) });
  const d = new Uint8Array(10); d[0] = 12; new DataView(d.buffer).setBigUint64(1, BigInt(Math.round((usdcToOwner - ownerUsdc) * 1e6)), true); d[9] = 6;
  ixs.push({ programAddress: TOKEN, accounts: [
    { address: await ata(delegate.address), role: AccountRole.WRITABLE }, { address: MINT, role: AccountRole.READONLY }, { address: ownerAta, role: AccountRole.WRITABLE },
    { address: delegate.address, role: AccountRole.READONLY_SIGNER }], data: d });
}
// merchant needs a USDC ATA to receive x402 payments (the x402 client does not create it)
const merchantAta = await ata(merchant.address);
if (!(await rpc.getAccountInfo(merchantAta, { encoding: "base64" }).send()).value) {
  ixs.push({ programAddress: ATA_PROG, accounts: [
    { address: delegate.address, role: AccountRole.WRITABLE_SIGNER }, { address: merchantAta, role: AccountRole.WRITABLE }, { address: merchant.address, role: AccountRole.READONLY },
    { address: MINT, role: AccountRole.READONLY }, { address: SYSTEM, role: AccountRole.READONLY }, { address: TOKEN, role: AccountRole.READONLY }], data: new Uint8Array([1]) });
}
if (ixs.length) await send(delegate, ixs, "fund owner / create merchant ATA");

// 2. owner grants the firewall a recurring allowance
const [saPda] = await findSubscriptionAuthorityPda({ user: owner.address, tokenMint: MINT });
const sa = await fetchMaybeSubscriptionAuthority(rpc, saPda);
const grant: Instruction[] = [];
let initId: bigint = UNKNOWN_INIT_ID;
if (!sa.exists) grant.push(await getInitSubscriptionAuthorityOverlayInstructionAsync({ owner, tokenMint: MINT, tokenProgram: TOKEN, userAta: ownerAta }));
else initId = sa.data.initId;
const now = Math.floor(Date.now() / 1000);
grant.push(await getCreateRecurringDelegationOverlayInstructionAsync({
  amountPerPeriod: BigInt(Math.round(capPerDay * 1e6)), delegatee: delegate.address, delegator: owner, expectedSubscriptionAuthorityInitId: initId,
  expiryTs: BigInt(now + days * 86400), nonce: BigInt(Date.now()), periodLengthS: 86400n, startTs: 0n, tokenMint: MINT,
}));
await send(owner, grant, `grant ${capPerDay} USDC/day for ${days} days`);
console.log("\nnext: set MERCHANT_ADDRESS=" + merchant.address + " in .env, then run firewall/sidecar/merchant and `pnpm agent`");
