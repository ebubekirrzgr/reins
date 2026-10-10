// Drop-in replacement for `useWallets` from @wallet-standard/react.
// The upstream hook subscribes to every wallet's `standard:events` and later calls each returned
// disposer; some browser extensions return `undefined` there, which throws "d is not a function"
// on unsubscribe (React Strict Mode triggers it immediately). We only track register/unregister
// and guard every disposer.
import { getWallets } from "@wallet-standard/app";
import { getOrCreateUiWalletForStandardWallet } from "@wallet-standard/ui-registry";
import type { UiWallet } from "@wallet-standard/ui";
import { useEffect, useMemo, useState } from "react";

export function useWallets(): readonly UiWallet[] {
  const [wallets, setWallets] = useState(() => [...getWallets().get()]);
  useEffect(() => {
    const { get, on } = getWallets();
    const refresh = () => setWallets([...get()]);
    const disposers = [on("register", refresh), on("unregister", refresh)];
    refresh();
    return () => {
      for (const d of disposers) if (typeof d === "function") d();
    };
  }, []);
  return useMemo(() => wallets.map(getOrCreateUiWalletForStandardWallet), [wallets]);
}
