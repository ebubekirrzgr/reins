import "dotenv/config";
import { createSolanaRpc, address } from "@solana/kit";
import { fetchDelegationsByDelegatee } from "@solana/subscriptions";
const rpc = createSolanaRpc(process.env.RPC_URL ?? "https://api.devnet.solana.com");
const ds = await fetchDelegationsByDelegatee(rpc, address(process.argv[2] ?? "AComWiwWgpk1bJgWFRqfGiseAJBbB2FUGJ3mme2aECbH"));
for (const d of ds) {
  const r = d.data as { header: { delegator: string }; amountPerPeriod?: bigint; periodLengthS?: bigint; expiryTs?: bigint };
  console.log(d.kind, d.address, "from", r.header.delegator, "cap", Number(r.amountPerPeriod ?? 0) / 1e6, "period", Number(r.periodLengthS ?? 0), "expiry", new Date(Number(r.expiryTs ?? 0) * 1000).toISOString());
}
