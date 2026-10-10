// Owner-side chain helpers: build + send the allowance transactions with the connected wallet.
import {
  address,
  appendTransactionMessageInstructions,
  createSolanaRpc,
  createTransactionMessage,
  getAddressEncoder,
  getBase64EncodedWireTransaction,
  getProgramDerivedAddress,
  getSignatureFromTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Address,
  type Instruction,
  type TransactionSigner,
} from "@solana/kit";
import {
  fetchDelegationsByDelegator,
  fetchMaybeSubscriptionAuthority,
  findSubscriptionAuthorityPda,
  getCreateRecurringDelegationOverlayInstructionAsync,
  getInitSubscriptionAuthorityOverlayInstructionAsync,
  getRevokeDelegationOverlayInstruction,
  UNKNOWN_INIT_ID,
} from "@solana/subscriptions";
import { RPC_URL, USDC_MINT } from "./config";

export const TOKEN_PROGRAM = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const ATA_PROGRAM = address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

export const rpc = createSolanaRpc(RPC_URL);

export async function ata(owner: Address, mint: Address = address(USDC_MINT)): Promise<Address> {
  const enc = getAddressEncoder();
  const [pda] = await getProgramDerivedAddress({ programAddress: ATA_PROGRAM, seeds: [enc.encode(owner), enc.encode(TOKEN_PROGRAM), enc.encode(mint)] });
  return pda;
}

export async function usdcBalance(owner: Address): Promise<number> {
  const acct = await rpc.getTokenAccountBalance(await ata(owner)).send().catch(() => null);
  return acct ? Number(acct.value.amount) / 1e6 : 0;
}

export async function sendTx(signer: TransactionSigner, ixs: Instruction[], onStatus?: (s: string) => void): Promise<string> {
  onStatus?.("fetching blockhash…");
  const { value: latestBlockhash } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
  const msg = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(signer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
    (m) => appendTransactionMessageInstructions(ixs, m),
  );
  onStatus?.("waiting for wallet signature…");
  const signed = await signTransactionMessageWithSigners(msg);
  const sig = getSignatureFromTransaction(signed);
  onStatus?.("sending…");
  await rpc.sendTransaction(getBase64EncodedWireTransaction(signed), { encoding: "base64", preflightCommitment: "confirmed" }).send();
  onStatus?.(`confirming ${sig}…`);
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const st = await rpc.getSignatureStatuses([sig]).send();
    const s = st.value[0];
    if (s?.err) throw new Error(`transaction failed: ${JSON.stringify(s.err)}`);
    if (s && (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized")) return sig;
  }
  throw new Error("confirmation timeout; check explorer: " + sig);
}

export type CreateAllowanceArgs = {
  owner: TransactionSigner;
  delegatee: Address;
  amountPerPeriodUsdc: number;
  periodSeconds: number;
  durationDays: number;
};

/** Builds [initSubscriptionAuthority?] + createRecurringDelegation and sends it. */
export async function createAllowance(a: CreateAllowanceArgs, onStatus?: (s: string) => void): Promise<string> {
  const mint = address(USDC_MINT);
  const ownerAddr = a.owner.address;
  const [saPda] = await findSubscriptionAuthorityPda({ user: ownerAddr, tokenMint: mint });
  onStatus?.("checking subscription authority…");
  const sa = await fetchMaybeSubscriptionAuthority(rpc, saPda);
  const ixs: Instruction[] = [];
  let initId: bigint = UNKNOWN_INIT_ID;
  if (!sa.exists) {
    ixs.push(
      await getInitSubscriptionAuthorityOverlayInstructionAsync({
        owner: a.owner,
        tokenMint: mint,
        tokenProgram: TOKEN_PROGRAM,
        userAta: await ata(ownerAddr, mint),
      }),
    );
  } else {
    initId = sa.data.initId;
  }
  const now = Math.floor(Date.now() / 1000);
  ixs.push(
    await getCreateRecurringDelegationOverlayInstructionAsync({
      amountPerPeriod: BigInt(Math.round(a.amountPerPeriodUsdc * 1e6)),
      delegatee: a.delegatee,
      delegator: a.owner,
      expectedSubscriptionAuthorityInitId: initId,
      expiryTs: BigInt(now + a.durationDays * 86400),
      nonce: BigInt(Date.now()),
      periodLengthS: BigInt(a.periodSeconds),
      startTs: 0n, // start when the tx lands
      tokenMint: mint,
    }),
  );
  return sendTx(a.owner, ixs, onStatus);
}

export async function revokeAllowance(owner: TransactionSigner, delegationAccount: Address, onStatus?: (s: string) => void): Promise<string> {
  const ix = getRevokeDelegationOverlayInstruction({ authority: owner, delegationAccount });
  return sendTx(owner, [ix], onStatus);
}

export type OwnerDelegation = { address: string; delegatee: string; amountPerPeriod: bigint; periodLengthS: bigint; expiryTs: bigint; pulled: bigint };

export async function listOwnerDelegations(owner: Address): Promise<OwnerDelegation[]> {
  const all = await fetchDelegationsByDelegator(rpc, owner);
  const mint = USDC_MINT;
  return all
    .filter((d) => d.kind === "recurring" && d.data.mint === mint)
    .map((d) => {
      const r = d.data as { header: { delegatee: string }; amountPerPeriod: bigint; periodLengthS: bigint; expiryTs: bigint; amountPulledInPeriod: bigint };
      return { address: d.address, delegatee: r.header.delegatee, amountPerPeriod: r.amountPerPeriod, periodLengthS: r.periodLengthS, expiryTs: r.expiryTs, pulled: r.amountPulledInPeriod };
    });
}
