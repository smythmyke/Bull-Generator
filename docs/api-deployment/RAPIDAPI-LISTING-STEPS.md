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

### Short description (tagline) — imports automatically from the spec
> US patent intelligence from USPTO data — dossiers, prosecution, claims & citations, plus a legal layer: PTAB validity challenges, district-court litigation history, and company-litigation reverse lookup.

### Long description (Markdown — paste into Hub Listing → General → Long Description)
```markdown
**US patent intelligence from USPTO public data.** Turn a patent number into a full dossier plus a legal-intelligence layer most patent APIs don't offer.

### Core patent data
- **Dossier** — bibliographic, full claims, citations, family, and CPC in one call
- **Claims, citations, family, examiner stats** as standalone calls
- **Office Action AI analysis**

### Legal intelligence
- **PTAB validity challenges** — who challenged a patent (IPR/PGR/CBM) and whether it survived
- **District-court litigation** — who sued whom over a patent, where, and over what
- **Company-litigation reverse lookup** — every patent suit involving a company

### Enrichment
In-force/legal status, chain of title, term/PTA, attorneys of record, entity status, and the as-filed pre-grant publication.

US patents only. Litigation coverage comprehensive 2003–2016, partial to 2020; PTAB and prosecution data current. All USPTO public-domain data. Metered via the `Credits` quota — bad input and failures aren't billed. *Not legal advice.*
```

---

## Current Studio navigation (confirmed live 2026-05-31)

Studio (now "Rapid", Nokia-owned) entry point = **"Add API Project"** (upper-right of Studio). After the project exists, everything is in the left sidebar under **Hub Listing**:
- **Hub Listing → General** → Base URL(s) [Step 2] + name/logo/category/visibility [Step 6]
- **Hub Listing → Definitions → Endpoints** → import/verify OpenAPI [Step 3]
- **Hub Listing → Monetize** → `Credits` quota + plans [Step 5]
- **Security** tab → proxy secret + proxy timeout [Step 4]

## Steps

### Step 1 — Create the API project
- **Add API Project** (upper-right of Studio).
- **Name:** `AI Patent Search Generator`
- **Description:** paste the tagline above.
- **Category:** `Tools`.
- **Import data from → OpenAPI** → upload `openapi-rapidapi.yaml`. **CONFIRMED 2026-05-31: this dialog import is the easiest path and pulls in all 17 endpoints + base URL + badges + docs at once** (with the spec's `x-category`/`x-badges`/`x-documentation` + per-endpoint examples). [Equivalent alt: leave "Do not import", create, then import later via Hub Listing → Definitions.]

### Step 2 — Base URL
- **Hub Listing → General** → scroll to **Base URL(s)** → paste the **direct Cloud Function URL** above (NOT a Firebase Hosting URL). Confirm it matches if it auto-filled from the import.

### Step 3 — Import / verify endpoints
- **Hub Listing → Definitions → Endpoints** → import `openapi-rapidapi.yaml` (if not done at project creation).
- Verify endpoints appear under **Patent / Legal Intelligence / Account**. Delete any stray empty group.

### Step 4 — Gateway / Security  ← *send the secret to Claude after this*  (confirmed layout 2026-05-31)
Tab name in the sidebar is **Gateway** (under the API project, not the top "Security"). Fields:
- **Firewall Settings → `X-RapidAPI-Proxy-Secret`** — shown masked; click the reveal/copy icon to get the real value.
- **Threat Protection → OFF**, **Request Schema Validation → OFF** (both cause false-positive blocks; backend validates).
- **Request Configurations → Proxy Timeout** — defaults to **0**; **set to 180** (max; AI endpoints can take 10–30s).
- **Request Size Limit** — leave 0. **Authorization / Secret Headers / Transformations** — leave empty.
- **→ Send the proxy secret to Claude** (paste here, OR set it in `functions/.env` yourself and say "done"). Claude swaps the temp test secret, redeploys, and re-verifies §5a. (Until then, live gateway calls 401.)

### Step 5 — Monetize (Hub Listing → Monetize → Public Plans) — confirmed + priced 2026-05-31
Page ships with default objects (Requests, Rapid-free-plans-hard-limit, Bandwidth Platform Fee) + 4 plan templates (BASIC/PRO/ULTRA/MEGA, off). Each plan has **TWO dialogs**: the **object quota** ("PLAN / Credits") and the **plan-level settings** ("PLAN").

**5a — Add the Credits object:** **+ Add Object → name EXACTLY `Credits`**, **Associated Endpoints = All endpoints** (backend emits a Credits header on every endpoint, 0 for free — don't narrow it). Must match the `X-RapidAPI-Billing: Credits=` header or metering silently does nothing.

**5b — Per-plan Credits quota** (click the `+` in a plan's Credits row → "PLAN / Credits" dialog): Quota Type = **Monthly**, then:

| Plan | Quota Limit | Limit Type | Overage |
|---|---|---|---|
| **BASIC** (free) | **250** | **Hard** | $0 |
| **PRO** | **5,000** | **Soft** | **$0.008** / Credit |
| **ULTRA** | **30,000** | **Soft** | **$0.005** / Credit |

(Free MUST be **Hard** so free users can't incur overage. 250 ≈ ~5 dossiers / ~7 legal lookups.)

**5c — Plan-level settings** (Edit a plan header → "PLAN" dialog): Plan Type = **Monthly Subscription**, then:

| Plan | Subscription Price | Recommended? |
|---|---|---|
| BASIC | **$0** | no |
| **PRO** | **$25/mo** | **YES** (sets the Hub badge) |
| ULTRA | **$99/mo** | no |
| MEGA | toggle **OFF** | — |

Leave Rate Limit / Require approval unchecked. **RapidAPI keeps 25% → you net ≈ $18.75 (PRO) / $74.25 (ULTRA)** per subscriber/mo.

**5d —** Leave Requests / free-hard-limit / Bandwidth defaults alone.

⚠️ **"Error in plan configuration"** toast = an object on the plan has an empty/0 quota. Ensure every object row under each enabled plan has a value (Credits + Requests set), then re-save.

**Spec cost map (what the backend emits):** `/dossier` 50, `/oa-analyze` 25, `/challenges` `/litigation` `/company-litigation` 35, `/claims` `/legal-status` `/assignments` `/term` `/prosecution-timeline` `/attorney` 10, `/pregrant-pub` 15, `/entity-status` 5, free utilities 0.

**Pricing rationale (RapidAPI vs the extension):** different currencies — a RapidAPI Credit ≈ $0.005–0.01, an extension credit ≈ $0.13–0.45. Per-call dollars land in the same range, RapidAPI slightly cheaper *by design*: it's a self-serve developer channel (raw data integration), loses 25% to the marketplace, and is a discovery play — vs the extension's polished UI for (price-insensitive) patent pros. Legal/litigation endpoints are API-only today, so no extension conflict until `EXT-ODP-1` ships.

### Step 5.5 — README (Docs / About tab)
When prompted to "Add a README", paste the full content of **`rapidapi-readme.md`** (this folder) — it's the public-facing listing front page: highlights, the 17-endpoint catalog with Credit costs, request/response examples, coverage, and billing notes.

### Step 6 — Listing details (Hub Listing → General) — confirmed fields 2026-05-31
Most of this imports from the spec; fill / verify on the General page:
- **Category** = `Tools` (set if the dropdown is empty).
- **Short Description** — imported automatically ✓.
- **Long Description** — paste the Markdown block above (the import only duplicates the short one here).
- **Logo** — ≤ 500×500 px (512 rejected).
- **Website / Terms of Use** — optional.
- **Visibility = Private**, and **tick "I confirm I own or have rights to publish this API"** (required before going public).
- **Base URL** — auto-filled to `.../ai` ✓. Don't append anything.
- ⚠️ **Health Check URL** — defaults to `.../ai/ping`, but there is **no `/ping` endpoint** (it would 404 → API shows unhealthy). **CLEAR the field (leave blank).** Optional: ask Claude to add a no-auth `/ping` for a green health badge (small backend change + redeploy).

### Step 7 — Payment
- **Payment Settings → connect PayPal** (required for payout — your 75%).

### Step 8 — Gateway meter test (§5b), then publish  ← *Claude can run this via curl*
The most reliable test is a direct gateway curl (skip the confusing Hub playground UI). Subscribe to your own BASIC plan first (View in Hub → it auto-subscribes / Change Plan). Then, using the consumer **X-RapidAPI-Key** + **host** (`<api>.p.rapidapi.com`, both shown on the Hub's playground/MCP page):
```bash
curl -s -D - -o /dev/null -X POST 'https://<api>.p.rapidapi.com/v1/challenges' \
  -H 'X-RapidAPI-Key: <CONSUMER_KEY>' -H 'X-RapidAPI-Host: <api>.p.rapidapi.com' \
  -H 'Content-Type: application/json' -d '{"patentNumber":"US8724622B2"}'
```
**Read the response headers — this is the real diagnostic:**
- `Server: RapidAPI-...` → confirms it went through the gateway (not direct).
- ✅ PASS: an **`X-RateLimit-Credits-Remaining`** header that dropped by the endpoint cost (e.g. 250 → 215 for a 35-Credit call).
- ❌ FAIL: headers show `X-RateLimit-Requests-*` and `...rapid-free-plans-hard-limit-*` but **NO `X-RateLimit-Credits-*`** → the `Credits` object isn't active on the subscribed plan. **Fix:** Monetize → the plan's **Credits** row must have a saved Quota Limit (clear any "Error in plan configuration" toast — every object row needs a value). Re-test.

*(Patent-search 2026-05-31: first §5b run returned 200 + data but NO Credits header — BASIC's Credits quota hadn't saved past the error toast. Caught before going public.)*

- When `X-RateLimit-Credits-Remaining` moves correctly → **Visibility → Public.**

---

## What Claude does (after you send the secret in Step 4)
1. Replace the test secret in `functions/.env` with your real `X-RapidAPI-Proxy-Secret`.
2. `firebase deploy --only functions`.
3. Re-run §5a curls to confirm 401-without / 200+`Credits=N`-with.
4. Walk Step 8 (§5b gateway meter test) with you.

## TODO (draft → final)
- [ ] Confirm Steps 1–7 against the live UI while doing them (note any UI differences here).
- [ ] Record the §5b result + first traffic.
