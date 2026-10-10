# Demo video — shot list (target ≤ 3 min)

Before recording
- `.env`: `MERCHANT_PRICE_EXPENSIVE=$5.00`, `OWNER_PUBKEY` = your Phantom address.
- Fresh DB (`rm reins.db`) so the table starts empty. Telegram chat id is pinned in `.env`.
- Four terminals: `pnpm firewall` · `pnpm sidecar` · `pnpm merchant` · `pnpm dashboard` (port 3100).
- Phantom on devnet with ≥ 10 USDC. Phone next to you, Telegram open on @x_reins_bot.
- Browser: dashboard tab + Solana Explorer tab (devnet). Terminal for the agent, large font.

Shots
1. (0:00) Dashboard, wallet connected. Read the top strip: on-chain cap 20 USDC/day, spent 0, hot wallet 0.
   Say: funds stay in my wallet; the firewall only holds a delegate key with an on-chain allowance.
   If you want to show the grant itself: revoke the 20/day allowance first, then click Grant → Phantom popup → 1 signature.
2. (0:35) Terminal: `pnpm agent 1`. Watch the row appear: Allowed → Settled, $0.05, risk 0. Click the tx link → Explorer shows TransferRecurring + the facilitator settlement. No human involved.
3. (1:05) Terminal: `pnpm agent 2`. Row goes "Awaiting you", amber banner appears. Phone: show the Telegram card (amount, merchant, risk, remaining cap). Tap Approve. Back to dashboard: Settled "by owner", $5.00. Agent prints the paid report.
4. (1:50) Terminal: `pnpm agent 3`. Row: Denied, risk 100, reasons list the injected phrases. Never reached the phone, never reached the chain.
5. (2:15) Click Pause. Run `pnpm agent 1` again → Denied "firewall is paused". Resume.
6. (2:35) Allowance panel → Revoke → Phantom signature → top strip shows "no allowance". The delegate is powerless on-chain.
7. (2:50) Close on the three layers: policy → human → chain cap. Roadmap in one breath.

Fallbacks
- Facilitator slow/down: scenario 1 settles the funding tx anyway; narrate "x402 settlement" over the audit log.
- Telegram late: dashboard banner has Approve/Reject too.
- Reset between takes: `scripts/sweep-usdc.ts <phantom address>` if the hot wallet holds USDC; `rm reins.db` + restart firewall for a clean table.
