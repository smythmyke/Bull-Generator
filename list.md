# Bull-Generator Project Review - Action Items

## CRITICAL - Security

- [x] ~~**Live API keys exposed in `functions/.env`**~~ — NOT AN ISSUE. File is in `.gitignore` and was never committed. Keys are local-only.
- [x] **Credits never consumed by AI endpoints** — FIXED. Added server-side balance guard in `functions/src/index.ts` (returns 402 when no credits). Added client-side credit gate to `UnifiedSearchTab.tsx` (main search now deducts 1 credit per generation).

## CRITICAL - Landing Page (`index.html`)

- [x] **Pricing was completely wrong** — FIXED. Replaced $3.99/month subscription with actual credit pack pricing ($2–$15 packs).
- [x] **"Premium Access" / "Unlimited searches" messaging** — FIXED. Replaced with "Search Credit Packs" grid showing all 4 tiers.
- [x] **Feature descriptions referenced old tabs** — FIXED. Replaced with current features: Unified Search, Concept Mapper, Prior Art Analysis, Synonyms & Definitions.
- [x] **Copyright year 2024** — FIXED. Updated to 2026.
- [x] **Missing SEO meta tags** — FIXED. Added meta description and Open Graph tags.
- [x] **Unused Stripe.js** — FIXED. Removed from landing page.
- [x] **Broken footer links** — FIXED. Removed non-functional Terms/Contact links (only Privacy Policy remains).

## HIGH

- [ ] **Privacy policy outdated** — Last updated Nov 2024; references "subscription"; placeholder `[Your Email]`; references "RapidAPI Words API".
- [ ] **Orphaned dead code** — `BroadTab.tsx`, `ModerateTab.tsx`, `NarrowTab.tsx`, `AIragraphTab.tsx`, `useBooleanSearchState` hook never imported.
- [ ] **Stripe checkout URLs point to wrong domain** — Hardcoded to `solicitation-matcher-extension.web.app` in `functions/src/stripe.ts` instead of `smythmyke.github.io/Bull-Generator`.

## MEDIUM

- [ ] **Version mismatch** — `manifest.json` = `2.1.0`, `package.json` = `1.0.0`.
- [ ] **Duplicate constants** — `PACKS` in 2 files, `FREE_DAILY_LIMIT` in 2 files, field prefixes in 3 files. Centralize.
- [ ] **Firebase config duplicated** — Same config in `firebaseConfig.ts` and `background/index.ts`.
- [ ] **CORS allows all origins** — `{origin: true}` on Cloud Functions.
- [ ] **In-memory rate limiting** — Resets on cold start, easily bypassed.
- [ ] **Stripe API version outdated** — Pinned to `2023-10-16`.
- [ ] **Search system default mismatch** — `BooleanSearchGenerator` defaults to `google-patents`, `UnifiedSearchTab` defaults to `orbit`.

## LOW / Nice-to-Have

- [ ] **Console logging uncontrolled** — Debug logs ship to production.
- [ ] **No input validation on Cloud Function endpoints** — No length/type checks before Gemini calls.
- [ ] **No timeout on external API calls** — Semantic Scholar/CrossRef could hang.
- [ ] **Gemini JSON parsing can crash functions** — No fallback on `JSON.parse()`.
- [ ] **`window.open()` for Stripe checkout** — May fail in extension; use `chrome.tabs.create`.
- [ ] **Icon definitions duplicated in manifest.json**.
- [ ] **No refund handling** — Stripe refunds not reflected in balance.
