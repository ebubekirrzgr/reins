# REINS architecture

```
                 ┌──────────────────────────────┐
                 │  Owner (human)               │
                 │  Phantom (devnet) · Telegram │
                 └───────┬──────────────┬───────┘
      1. grant allowance │              │ 4. Approve / Reject
      (recurring, cap)   │              │    (inline buttons)
                         ▼              ▼
┌───────────────┐   ┌──────────────────────────────────────────┐
│ Dashboard     │──▶│ REINS Firewall (Rust: axum)               │
│ Next.js       │   │  • policy engine  → ALLOW / ASK / DENY    │
│ @solana/kit   │   │  • approvals (Telegram, 10 min timeout)   │
│ @solana/      │   │  • executor: TransferRecurring (delegate  │
│  subscriptions│   │    key, from the owner's ATA)             │
└───────────────┘   │  • audit log (SQLite)                     │
                    │  • delegate keypair (THE ONLY KEY)        │
                    └───────▲───────────────┬──────────────────┘
      2. intent             │               │ 5. payment
  POST /v1/intents          │               ▼
  POST /v1/x402/fetch       │   ┌────────────────────────────┐
                            │   │ x402 sidecar (Node, @x402/  │
┌───────────────┐           │   │ fetch + @x402/svm)          │──▶ Demo merchant
│ Agent (demo)  │───────────┘   │ hot ATA = delegate ATA      │    (express + @x402/express)
│ no keys       │               └────────────────────────────┘            │
└───────────────┘                                                         ▼
                                                               Facilitator (x402.org)
                                                                          │
                      Solana devnet ◀─────────────────────────────────────┘
                      • Subscriptions & Allowances program
                        De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44
                      • USDC devnet 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU
```

## Trust model

- **Agent compromised (prompt injection):** it can only *ask*. It has no key, no RPC access to funds.
- **Firewall compromised:** the delegate key can pull at most `amount_per_period − pulled` in the current period. The owner revokes with one `RevokeDelegation` (dashboard) and the delegate is powerless.
- **Owner's phone lost:** nothing above the auto-allow threshold is paid without a Telegram tap; the owner revokes from the dashboard with their wallet.
- The firewall **never** holds the owner's key. Funds stay in the owner's wallet until the exact moment of payment.

## Transfer flow

1. Agent `POST /v1/intents {kind:"transfer", to, amount, memo}` → `202` with the policy verdict.
2. Policy engine writes the intent (`allowed | awaiting_approval | denied`) and the audit event.
3. `ASK`: Telegram message with amount, recipient, memo, risk score + reasons, spent today, remaining on-chain cap. Buttons: Approve · Reject · Approve + trust recipient. Timeout → `expired`.
4. Approval → executor builds `[CreateIdempotentATA(receiver), TransferRecurring(delegator=owner, delegatee=firewall, mint, receiver_ata)]`, signs with the delegate key, confirms, stores the signature.
5. Agent long-polls `GET /v1/intents/:id?wait=25`.

## x402 flow

1. Agent `POST /v1/x402/fetch {url, method, max_amount}` (synchronous, up to the approval timeout).
2. Firewall asks the sidecar for a **quote**: the sidecar performs the request, gets `402 + PAYMENT-REQUIRED`, decodes it, and returns `{amount, payTo, asset, network}` — it does **not** pay.
3. Policy decides on the real amount; `ASK` → Telegram.
4. Approval → `TransferRecurring` from the owner's ATA **to the delegate's own ATA** (just-in-time funding).
5. Sidecar runs `wrapFetchWithPayment` with a selector that only accepts the approved `amount/payTo/asset`; the facilitator settles the `TransferChecked`; the upstream response and `PAYMENT-RESPONSE` go back to the agent and into the audit log.

Why two steps? The standard facilitator (`exact` scheme) expects a `TransferChecked` from the payer's own ATA and does not validate CPI transfers through the Allowances program. JIT funding keeps standard x402 compatibility while the hot wallet never carries idle balance.

## Policy engine

Inputs: amount, recipient, memo/url, agent velocity, spent today, recipient history, paused flag, remaining on-chain allowance.

Hard stops (DENY): paused · blocked recipient · amount > hard max · amount > remaining on-chain allowance · no active allowance.

Risk score: size (0–40, proportional to hard max) + new recipient (+20) + suspicious phrases in memo/url (+50 each) + velocity (+30) + over daily soft cap (+15).

Decision: `risk ≥ 80 → DENY`; `amount ≤ auto_allow_max && risk < 40 && !over_daily → ALLOW` (trusted recipients get a higher auto-allow limit); otherwise `ASK`.

## Data

SQLite via sqlx: `intents` (full lifecycle, verdict, signature, x402 payload), `audit` (append-only events), `settings` (policy JSON, paused flag, bound Telegram chat).

## Stack

Rust: axum, tokio, sqlx (SQLite), reqwest (Telegram Bot API), `subscriptions` (Foundation's Codama Rust client), solana-rpc-client 3.x.
Node: Next.js + @solana/kit + @solana/react + @wallet-standard/react + @solana/subscriptions (dashboard); hono + @x402/fetch + @x402/svm (sidecar); express + @x402/express (merchant).
