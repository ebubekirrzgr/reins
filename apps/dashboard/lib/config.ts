export const FIREWALL_URL = process.env.NEXT_PUBLIC_FIREWALL_URL ?? "http://localhost:4010";
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? "https://api.devnet.solana.com";
export const USDC_MINT = process.env.NEXT_PUBLIC_USDC_MINT ?? "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
export const ADMIN_KEY = process.env.NEXT_PUBLIC_ADMIN_API_KEY ?? "dev-admin-key";
export const DEVNET_CHAIN = "solana:devnet" as const;
export const USDC_DECIMALS = 6;

export const fmtUsdc = (atomic: number | bigint | string) => (Number(atomic) / 10 ** USDC_DECIMALS).toFixed(2) + " USDC";
export const short = (a?: string | null) => (a && a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a ?? "");
export const ago = (ts: number) => {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};
