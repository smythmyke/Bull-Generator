# How to Add an App to RapidAPI — Portable Guide

**Status:** DRAFT (do not disseminate until the patent-search listing is finished and the console steps get a 2nd live confirmation).
**Validated on:** JackpotKeywords (first listing, 2026-05-30) + AI Patent Search Generator / Bull-Generator (backend shim verified live, 2026-05-31).
**Audience:** any project in the portfolio adding an existing JK-style REST API to the **RapidAPI ("Rapid") marketplace**.
**Supersedes / generalizes:** `JackpotKeywords/docs/api-deployment/RAPIDAPI-REPLICATION-RUNBOOK.md` (the original worked example).

---

## 0. Read this first — is RapidAPI even worth it?

- **Platform status (2026):** Nokia acquired RapidAPI (rebranded "Rapid") in Nov 2024 and is steering it toward telecom/Network-as-Code. The **public marketplace still works but has declined** — fewer active listings, less developer traffic, some providers have left.
- **Therefore: treat RapidAPI as a low-effort, additive *discovery* channel, NOT a primary revenue line.** List it because the integration is cheap to reuse (~30 min after the first one), not because it'll be a big earner.
- **Skip it** when a REST listing has thin developer demand (e.g. image/annotation tools). It fits data/research APIs that developers actually search a marketplace for.
- Keep your **MCP listings (npm / Smithery / Glama / MCP Registry) separate** — RapidAPI is a *REST* surface, a parallel channel, not a replacement.

---

## 1. The mental model (two doors, two payout rails)

Your API has **two independent front doors**, and a customer only ever uses one:

| | **Door 1 — RapidAPI marketplace** | **Door 2 — Your own API / app** |
|---|---|---|
| Who | A dev who finds you on RapidAPI | Your app users + devs who sign up directly |
| Pays | **RapidAPI** (card, on RapidAPI) | **You** (your Stripe) |
| You get paid | RapidAPI keeps 25%, pays you **75% via PayPal, monthly, ~5–6 wk lag** | Directly, your Stripe → bank |
| Your billing ledger | **Bypassed** — RapidAPI is the ledger | Your normal per-call credit deduction |

**RapidAPI is the ledger for Door 1.** Your backend just tells it how much to charge via a response header; it never touches your Stripe/credits. A developer on RapidAPI is **never** routed into your Stripe checkout.

---

## 2. Backend prerequisites — the four moves (the only real code)

All additive, gated behind the proxy-secret header, so existing direct/MCP/app traffic is untouched and the shim is **inert until the secret env is set**. Adapt to your stack (Express middleware in JK; a single dispatch function + `resolveAuth` in Bull-Generator — both work).

1. **House account.** ONE account flagged **`billingExempt`** (NOT admin, so its usage stays attributable). All RapidAPI traffic binds to it; your deduction function **skips the charge but still logs**. Store its id in env (`*_RAPIDAPI_HOUSE_*`). *(JK: an `apiCustomers` doc. Bull-Generator: a `credits/{uid}` doc — keep your own billing model; do NOT rebuild it to match another project.)*
2. **Proxy-secret auth path.** *Before* your normal key check: if `x-rapidapi-proxy-secret` is present, **timing-safe compare** it to `*_RAPIDAPI_PROXY_SECRET`. Match → bind the house account + set source `'rapidapi'`. Present-but-wrong / unconfigured → **401**. Absent → fall through to existing auth.
3. **Billing header.** Patch `res.json` (read status at send time): when source is `'rapidapi'`, set `X-RapidAPI-Billing: Credits=<n>` — the route's cost on **2xx**, `=0` on **non-2xx** (don't bill bad input; RapidAPI ignores ≥500 anyway = refund-on-failure).
4. **Rate-limit bypass.** Your per-customer limiter would throttle ALL RapidAPI users collectively (they share one house account). Skip it for source `'rapidapi'`; RapidAPI enforces per-plan limits itself.

Plus: widen your source enum to include `'rapidapi'`; add the two env vars to a **gitignored** `.env`; ensure hard failures return real 5xx.

**The "Credits" convention:** use **1 RapidAPI Credit = 1 US cent** of list value (JK's convention) so the cost map and plan pricing line up. The per-endpoint Credit weights live in **code**; the actual $/Credit and plan tiers live in the **RapidAPI console**. Premium-price your differentiated endpoints even if they're cheap/free on your direct API.

---

## 3. Pre-flight checklist (before the console)

- [ ] Four-move shim built, **deployed**, and server-side verified (see §5a) with a self-chosen test secret.
- [ ] **OpenAPI spec** ready (`servers.url` = your **direct Cloud Function URL**, NOT the Hosting URL — Hosting has a 60s edge timeout; the CF URL allows up to 180s). Endpoints grouped by `tags`. Each summary states its Credit cost.
- [ ] **Logo ≤ 500×500 px** (512 is rejected). Resize with PowerShell `System.Drawing`, not Windows `convert.exe`.
- [ ] Short + long description, category, website, terms text.
- [ ] A **0-cost probe endpoint** (e.g. `/me` or any free route) for §5a/§5b testing.

---

## 4. Console steps — add the app (current Studio UI)

> The official docs lag the live UI. The UI is mid-migration, so you may see an **older** or **newer** tab layout — both map to the same things.

| You need to… | Older layout | Newer layout |
|---|---|---|
| Name, logo, category, website, terms, visibility | **General** | **Global Settings / Settings** |
| Base URL | General → Base URL | **API Specs → Settings → Base URL** |
| Endpoints + **OpenAPI import** | **Definitions** | **API Specs → Endpoints**; import via **Definitions → CI/CD → Import OpenAPI → Upload File** |
| Proxy secret + timeout | **Gateway** | **Security** → *Firewall Settings* (secret) + *Request Configurations* → Proxy Timeout |
| Plans + custom quota | **Monetize** | **Hub Listing → Monetize → Public Plans** |
| Consumer usage / quota | — | **Apps** / Developer Dashboard → **Subscriptions & Usage** |

**Order of operations:**
1. **Studio (`provider.rapidapi.com` or top-nav Studio) → Add New API.** Set **Base URL** = your direct CF URL.
2. **Import OpenAPI** (Definitions → CI/CD). Verify endpoints imported; **delete any stray empty group** (import sometimes auto-creates one).
3. **Security:** copy the generated **`X-RapidAPI-Proxy-Secret`** → set it as your `*_RAPIDAPI_PROXY_SECRET` env → **redeploy** (replacing the test secret). Set **Proxy Timeout = 180**. Leave Threat Protection + Schema Validation **OFF** (your backend validates; they cause false-positive blocks).
4. **Docs tab:** paste your markdown API docs.
5. **Monetize:** **Add a custom quota Object named EXACTLY `Credits`** (must match your header — see gotcha #1) → attach billable endpoints. Configure plans: a **free tier with a HARD limit + tight monthly allotment**; paid tiers with **soft limits + per-Credit overage**. Turn off unused tiers.
6. **Settings:** logo (≤500px), category, descriptions, website, terms, tags. **Visibility = Private** during setup.
7. **Payment Settings:** connect **PayPal** (or you can't get paid).
8. **Test** (§5b), then flip **Visibility → Public**.

---

## 5. Verification (do BOTH)

### 5a. Server-side pre-check (catches bugs before the dashboard)
Hit your **direct CF URL** with curl. `<SECRET>` = your (test, then real) proxy secret.
```bash
# No secret → expect 401 (normal auth)
curl -s -o /dev/null -w "%{http_code}\n" -X POST "<URL>/v1/<free>" -d '{...}'
# Wrong secret → 401
curl -s -o /dev/null -w "%{http_code}\n" -H "x-rapidapi-proxy-secret: WRONG" -X POST "<URL>/v1/<free>" -d '{...}'
# Correct secret → 200 + header "x-rapidapi-billing: Credits=<cost>"
curl -s -D - -o /dev/null -H "x-rapidapi-proxy-secret: <SECRET>" -X POST "<URL>/v1/<billable>" -d '{...}'
# Correct secret, bad input → 4xx + "Credits=0"
curl -s -D - -o /dev/null -H "x-rapidapi-proxy-secret: <SECRET>" -X POST "<URL>/v1/<billable>" -d '{}'
# Correct secret, an endpoint that normally charges internal credits → 200 (NOT 402)
#   and confirm the house account balance is UNCHANGED in your DB.
```
**Patent-search result (2026-05-31):** all five passed — 401/401, `Credits=10` on success, `Credits=0` on bad input, `/dossier` 200-not-402 with the house balance untouched.

### 5b. Gateway test (only RapidAPI can prove this)
The one thing 5a can't: RapidAPI reading your `Credits` header and decrementing the quota.
1. Studio → **View in Hub** → **Subscribe** to your free plan.
2. **Endpoints** tab → pick an endpoint → set JSON body → **Test Endpoint** (allow 60–180s for slow ones).
3. **Apps → Subscriptions & Usage:** the **Credits used** must equal that endpoint's cost. If a gateway 200 does **not** move the counter → the quota Object name ≠ your header name (gotcha #1). Fix that first.

⚠️ Only **gateway** (Hub/playground) calls count on RapidAPI's meter. Your §5a curls hit the backend directly — they show in *your* logs but not RapidAPI's usage.

---

## 6. Gotchas (the time-savers)

1. **Quota Object name must EXACTLY match the `X-RapidAPI-Billing` header name (`Credits`).** Mismatch = 200s but **silent zero metering**. Test it.
2. **Logo ≤ 500×500** (512 rejected).
3. **Base URL = direct CF URL**, not Hosting (60s edge timeout). A path like `.../<fn>/<fn>/v1/...` can be correct if your function name doubles into the route.
4. **180s gateway ceiling** — endpoints over it return 504; the dev isn't billed (≥500 rule) but you burn compute.
5. **≥500 responses are NOT metered** (free-on-failure) — so return real 5xx on hard failures.
6. **Free tier recurs monthly** — keep it tighter than any one-time direct credit.
7. **PayPal-only payout**, ~5–6 wk lag. Set revenue-tracking expectations.
8. A house-account balance field may **leak into responses** — cosmetic; strip per-source only if it bothers you.
9. **Keep the proxy secret in a gitignored `.env`.** Replace any test secret with the real one and redeploy; never commit it.

---

## 7. Per-project adaptation notes
- **Keep your own billing model.** Don't rebuild a mature product's credit/Stripe system to match another project's — only the *RapidAPI layer* (proxy secret + billing-exempt house account + Credits header + PayPal) needs to be consistent. (Bull-Generator kept its shared-credit system; JK uses separate cents accounts. Both work behind the same RapidAPI shim.)
- **GovToolsPro:** list value-add / AI endpoints ONLY — never raw SAM.gov/FPDS passthrough (ToS-sensitive + redundant).
- **MarkItUp:** skip — thin REST demand; MCP fits better.

## 8. Reference files (worked examples)
- `JackpotKeywords/docs/api-deployment/{RAPIDAPI-REPLICATION-RUNBOOK.md, openapi-rapidapi.yaml}`; `packages/functions/src/{middleware/apiKeyAuth.ts, services/apiCredits.ts, api/v1.ts}`.
- `Bull-Generator/functions/src/rapidapi.ts` (+ `credits.ts` billingExempt, `index.ts` branch); `Bull-Generator/docs/api-deployment/openapi-rapidapi.yaml`; `scripts/provision-rapidapi-house.js`.
- Cross-portfolio tracker: `C:/Projects/MarkItUp/planning/MCP-DISTRIBUTION-SURFACES.md`.

## TODO before disseminating
- [ ] Confirm the §4 console steps against the live UI while creating the patent-search listing (2nd confirmation).
- [ ] Record the patent-search §5b gateway-test result here.
- [ ] Re-evaluate the §0 "is it worth it" verdict after seeing patent-search's actual RapidAPI traffic.
