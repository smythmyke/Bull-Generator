# RapidAPI Listing — Patent-Search Console Steps

**For:** AI Patent Search Generator (Bull-Generator). Do these in the RapidAPI ("Rapid") Studio in order.
**Backend status:** shim built + deployed + §5a-verified (2026-05-31). Only the console work + the secret swap remain.
**Portable how-to (background/gotchas):** `HOW-TO-ADD-A-RAPIDAPI-APP.md` in this folder.

> Realistic expectation: RapidAPI (now Nokia-owned "Rapid") is a quieting marketplace — treat this as a low-effort discovery listing, not a revenue line. Don't over-engineer the pricing tiers.

---

## Copy-paste values
- **Base URL:** `https://us-central1-solicitation-matcher-extension.cloudfunctions.net/ai`
- **OpenAPI file to import:** `docs/api-deployment/openapi-rapidapi.yaml`
- **Quota object name (EXACT):** `Credits`
- **Proxy timeout:** `180`
- **Logo:** ≤ 500×500 px (512 is rejected)

### Listing name
`AI Patent Search Generator`

### Short description (tagline)
> US patent intelligence from USPTO data — dossiers, prosecution, claims & citations, plus a legal layer: PTAB validity challenges, district-court litigation history, and company-litigation reverse lookup.

### Long description (Docs tab / overview)
> The AI Patent Search Generator API turns a US patent number into actionable intelligence. Core: full dossiers (bibliographic, claims, citations, family, CPC), prosecution history, and examiner stats. Legal intelligence: PTAB validity challenges (who attacked the patent and whether it survived), US district-court infringement litigation (who sued whom, over what), and a company-litigation reverse lookup (every patent suit involving a company). All from USPTO public-domain data. Metered via the `Credits` quota; failed requests and bad input are not billed.

---

## Steps

### Step 1 — Create the API
- **Add New API.**
- **Name:** `AI Patent Search Generator`
- **Category:** Data (or Tools / Business)
- **Short description:** paste the tagline above.

### Step 2 — Base URL
- Set Base URL to the **direct Cloud Function URL** above (NOT a Firebase Hosting URL). Confirm it matches after import.

### Step 3 — Import endpoints
- **Definitions → CI/CD → Import OpenAPI → Upload File** (newer UI: **API Specs → Endpoints**) → upload `openapi-rapidapi.yaml`.
- Verify endpoints appear under **Patent / Legal Intelligence / Account**. Delete any stray empty group.

### Step 4 — Security  ← *send the secret to Claude after this*
- **Security tab → Firewall Settings:** copy the generated **`X-RapidAPI-Proxy-Secret`**.
- Set **Proxy Timeout = 180**.
- Turn **OFF** Threat Protection + Schema Validation.
- **→ Paste that proxy secret to Claude.** It swaps the temp test secret in `functions/.env`, redeploys, and re-verifies §5a. (Until then, live gateway calls 401.)

### Step 5 — Monetize (your pricing)
- **Add custom quota Object named EXACTLY `Credits`.** Attach the billable endpoints.
- Plans (you set the dollars; 1 Credit ≈ $0.01 of value):
  - **Free/BASIC:** small **hard** monthly cap (e.g. 100 Credits).
  - **Paid:** larger monthly Credits + per-Credit overage.
- Reference costs already in the spec: `/dossier` 50, `/challenges` `/litigation` `/company-litigation` 35, enrichment 10, free utilities 0.

### Step 6 — Listing details
- Logo (≤500px), long description (above), website, terms, tags. **Visibility = Private** for now.

### Step 7 — Payment
- **Payment Settings → connect PayPal** (required for payout — your 75%).

### Step 8 — Test, then publish  ← *do together with Claude*
- Subscribe to your own free plan (View in Hub → Subscribe) → **Endpoints → Test Endpoint** (try `/v1/challenges`).
- **Apps → Subscriptions & Usage:** Credits used must match the endpoint cost. (No movement on a 200 → quota object name ≠ `Credits`; fix Step 5.)
- When it passes → **Visibility → Public.**

---

## What Claude does (after you send the secret in Step 4)
1. Replace the test secret in `functions/.env` with your real `X-RapidAPI-Proxy-Secret`.
2. `firebase deploy --only functions`.
3. Re-run §5a curls to confirm 401-without / 200+`Credits=N`-with.
4. Walk Step 8 (§5b gateway meter test) with you.

## TODO (draft → final)
- [ ] Confirm Steps 1–7 against the live UI while doing them (note any UI differences here).
- [ ] Record the §5b result + first traffic.
