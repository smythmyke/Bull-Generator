# Pricing Research — Legal-Intelligence Lookups (2026-06-07)

Deep-research run (105 agents, 23 sources, 25 top claims adversarially verified: 19
confirmed / 6 killed) to ground per-call pricing for the patent legal-intelligence
lookups across all surfaces (extension, v1 API, MCP/Claude connector, RapidAPI).
Credits system: 1 credit ≈ $0.10.

## Decision (Michael, 2026-06-07)

**Adopted now (middle path):**
- `litigation` + `company-litigation` + `examiner-stats`: **2cr per call** on API/MCP
  surfaces; **extension stays free** (preserves the 2026-05-31 §14 Legal Intelligence
  decision).
- `risk_profile` (40cr fresh / 24h cache free) added to the Claude connector as the
  premium rung (10th tool).
- RapidAPI: `/examiner-stats` aligned to 20 RapidAPI-credits ($0.20); litigation
  already 35 ($0.35).
- The four ODP-passthrough lookups (`challenges`, `legal_status`, `assignments`,
  `prosecution`) **stay free** internally as the acquisition hook.

**Revisit trigger:** if/when the connector gets popular (real `source:'mcp'` volume),
revisit charging 1cr on the four free lookups and 1–2cr on prosecution per the
recommended table below.

## Recommended per-call price table (research synthesis)

| Lookup | Recommended | Basis |
|---|---|---|
| PTAB challenges | 1cr / $0.10 | Raw data free at ODP; Docket Navigator's 27% multi-user PTAB premium supports parity-with-lookups, not litigation-level premium |
| Legal status | 1cr / $0.10 | Free at source; convenience margin |
| Assignments | 1cr / $0.10 | Free at source; convenience margin |
| Prosecution/file-wrapper | 1–2cr | ODP's 4 req/min PDF cap is the monetizable throughput gap (vs 60/min for JSON) |
| Litigation (per-patent & per-company) | 2–3cr / $0.20–0.30 | **Only type with no complete free source** — RECAP free on cache hits only, PACER $0.10/page pass-through otherwise; Docket Navigator implies $0.15–$1.45/lookup |
| Examiner analytics | 2–3cr / $0.20–0.30 | Computed cross-corpus aggregation; **priced by analogy** — no Juristat/PatentAdvisor comps survived verification (all quote-only) |
| Claims | 1cr (keep) | Validated by PatSnap basic-lookup band |
| Dossier | 3cr (keep) | PatSnap "AI-enhanced" band; ⅓ of RapidAPI's $1 soft ceiling |

## Verified benchmarks (all 3-0 or 2-1 confirmations, live-fetched 2026-06-07)

- **USPTO ODP**: $0.00/call with free key; 60 req/min JSON, **4 req/min PDF/ZIP**;
  ID.me signup friction; sign-in required from 2026-06-18. The ONLY free path —
  legacy developer.uspto.gov APIs (PTAB v2, Assignment Search v1.4, PEDS) were
  decommissioned Jan 2026 (the "millions of calls/week" free quotas were REFUTED).
  https://data.uspto.gov/apis/api-rate-limits
- **PatSnap Open API** (closest comp; credit model, 1cr = $0.01, $100 min top-up,
  10k-credit free tier): "a few credits" (~$0.02–$0.10) basic lookup; more for
  AI-agent analysis. https://open.patsnap.com/pricing
- **Docket Navigator**: $145/mo flat single-user (litigation + PTAB), zero per-search
  fees → $0.145–$1.45 effective per lookup at 1,000–100 lookups/mo. PTAB/Appeals
  add-on carries ~27% premium at multi-user tiers ($760 vs $600 at 4–9 users).
  https://brochure.docketnavigator.com/pricing/
- **RapidAPI norms** (official docs): $25/$75/$150 tier ladder; overage ≤$1.00/call
  guidance; commodity USPTO-data resale floor ~$0.005/call (pentium10 trademark API:
  $27/mo / 5,000 req). https://docs.rapidapi.com/docs/monetizing-your-api-on-rapidapicom
- **CourtListener/RECAP**: free API but spends caller's PACER credentials on cache
  misses ($0.10/page, $3/doc cap); archive hits free. Complete per-patent litigation
  history is NOT assemblable free (refuted 1-2) — coverage incomplete.
  https://www.courtlistener.com/help/api/rest/recap/
- **Clarivate Derwent / enterprise tier** (Lex Machina, LexisNexis, Questel): all
  quote-only, zero published pricing → no published-price competition for a
  self-serve per-call product.
- **Licensing**: PatentsView CC BY 4.0 + ODP public domain — commercial repackaging
  explicitly permitted (attribution for PatentsView). PatentsView migrated into ODP
  2026-03-20.

## Honest caveats

- Examiner-analytics pricing rests on analogy: no PatentAdvisor/Juristat/Lex Machina
  numbers survived verification.
- MCP-connector per-tool-call norms barely exist in 2025–2026; PatSnap's credit model
  is the only real comp. No established "connector pricing band" to violate.
- Docket Navigator per-lookup figures are derived from subscriptions, not posted rates.
- PatSnap's "$0.02–$0.10 basic" is an interpretation of "a few credits", not a
  published per-endpoint price list.
- RapidAPI docs ~12 months old; post-Nokia-acquisition policy could shift.

## Open questions (for the revisit)

1. Actual PatentAdvisor / Juristat seat prices (type-6 comp).
2. Emerging per-tool-call pricing norms on paid MCP servers / connector marketplaces.
3. Lex Machina effective per-lookup cost (canonical litigation-analytics vendor).
4. EPO OPS free-tier quota + paid tier (relevant if legal-status goes beyond US).

## Cost side (ours)

Marginal cost of the lookups ≈ $0 (ODP free, no Gemini; Firestore pennies). Dossier ≈
~1¢ compute, cached 24h. Real COGS only on `oa_analyze`, `search`, `cpc_suggest`,
`risk_profile` (Gemini). Pricing is value-based, not cost-recovery.
