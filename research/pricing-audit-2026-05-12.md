# Pricing & Free-Tier Audit — 2026-05-12

Context: portfolio-wide audit comparing each Chrome extension's current pricing/free-tier state against the "trial-credits for new users" strategy for B2B tools where the audience isn't price-sensitive and the growth bottleneck is distribution, not pricing. AI Patent Search Generator (codename Bull-Generator): 36 users, ★5, live since Nov 2024.

## Recommendation
Trial credits (3–5 free queries per new user) — not a fully free product. Patent attorneys are not price-sensitive, so a paywall doesn't deter the right audience. A handful of free credits is enough to let them prove the tool finds prior art they care about.

## Current State
**Already shipped — perfect alignment with recommendation.**

**Trial credits.** Exactly 5 starter credits granted on first sign-in.
- `functions/src/credits.ts:31` — `STARTER_CREDITS` constant.
- `functions/src/credits.ts:141` — `initCredits()` grants starter credits, sets `freeCreditsGranted: true` flag in Firestore `credits/{uid}`.
- `extension-src/src/contexts/CreditContext.tsx:89-91` — `CreditProvider` detects missing doc and calls `initCredits()` automatically.

**Free actions (no credit cost):** synonyms, definitions, concept extraction, query optimization, ranking. Only premium AI actions cost credits.
- `functions/src/credits.ts:34` — quick-search actions are credit-free.

**Credit costs:**
- Patent Dossier fetch: 3 credits (fresh data only; cache hits free) — `functions/src/index.ts:15`
- Office Action analysis: 1 credit (fresh only; 5 free analyses per application bundled) — `functions/src/index.ts:16` + `officeActionAnalyzer.ts:345`
- Claim Chart: free (bundled with dossier) — `functions/src/index.ts:130`

**Paywall enforcement:** server-side via `useCredit()` deduction *before* returning results. Client-side pre-flight at `extension-src/src/hooks/useCreditGate.ts:20` blocks zero-credit users.

## Paid Tiers (Production-Live)

| Tier | Monthly | Credits | Rollover Cap | $/credit |
|------|---------|---------|--------------|----------|
| Searcher | $9 | 20 | 0 | $0.45 |
| Pro | $19 | 60 | 30 | $0.32 |
| Firm | $39 | 150 | 75 | $0.26 |

`functions/src/credits.ts:12-16` + `CreditPurchase.tsx:10-12`. Stripe webhooks in `functions/src/stripe.ts` handle renewal (with rollover) and one-time packs. Billing Portal integrated.

**One-time packs:** 10/$2 · 30/$5 · 75/$10.

## Distance from Recommendation
Zero. The trial-credit strategy is the current live state.

## Only Gap: Stale Marketing Copy
`index.html:14, :45` advertises **"5 free searches daily"** — but the live behavior is 5 free searches *total* on signup, then pay-as-you-go. This will frustrate new users who expect a daily reset and find one-time credits instead. Recommended copy change: "5 free searches to get started" or "5 free trial searches, then choose a plan."

## Verdict
No code strategy change. Fix landing-page copy and focus growth efforts on **outbound distribution** into IP communities (patent bar listservs, AIPLA, r/patentlaw, IP-focused LinkedIn groups). The product is doing its job; discovery is the bottleneck.
