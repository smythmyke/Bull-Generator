# Bull-Generator — Public API Plan

**Date:** 2026-05-25
**Status:** Not started. Adopted from MarkItUp's solo-dev playbook (Tier-3 selective clone per `feedback_mcp_cloning_strategy.md`).
**Goal:** Promote the existing `ai` Cloud Function into a stable, externally consumable HTTP API so the MCP server (and any future third-party plugin) can call Bull-Generator's patent pipeline.

**Why first:** The MCP server in [PLAN-MCP-SERVER.md](./PLAN-MCP-SERVER.md) is the only planned consumer for v1. The backend already works; what's missing is non-Firebase auth, versioned paths, key-scoped billing visibility, and the `/v1/*` URL contract.

## Current state — what already works

`functions/src/index.ts` provides:
- Single `ai` HTTP Cloud Function dispatching by `req.path` (same architectural shape as MarkItUp's `apiv2`)
- Firebase ID-token Bearer auth (`verifyAuth()`)
- Per-user **in-memory** rate limiting (100 req/hour) — sufficient for browser-extension traffic, will be inadequate for multi-instance MCP traffic
- CORS allowlist
- Credit deduction via Firestore transactions
- Stripe webhook for credit provisioning (separate `stripeWebhook` function — unaffected by this plan)
- Sibling `eou` function for the PatentEvidenceSearch product — unaffected by this plan

Existing endpoint paths handled by `ai`:
- `/patent-dossier` (3 credits)
- `/dossier-summary` (free, bundled with dossier)
- `/claim-chart` (free, bundled with dossier)
- `/prosecution-history` (free)
- `/oa-analyze` (5 free per application then 1 credit each)
- `/examiner-stats` (free)
- `/odp-document` (free, returns PDF stream)
- `/credits/*` (balance, packs, history, checkout)
- `/admin/*` (admin-only)
- AI endpoints via `handleAIRequest`: `/generate`, `/synonyms`, `/definitions`, `/analyze`, `/generate-strategy-searches`

## What's missing for public consumption

| Gap | Solution |
|---|---|
| No API-key auth path | Port MarkItUp's `auth.ts` (`resolveAuth()` that tries `X-API-Key` then Firebase ID token), v1-syntax-adjusted |
| No `apiKeys` Firestore collection | Add per MarkItUp's schema, plus key CRUD endpoints |
| No durable rate limiting | Add Firestore-backed rate limiter for the API-key path; leave existing in-memory limiter alone for the Firebase-token path |
| No `/v1/*` URL prefix | Add Firebase Hosting rewrites in `firebase.json` → existing `ai` function (which already dispatches by path) |
| No key management UI | Add to extension's existing Admin tab (locked decision — see project memory) |
| No per-key usage logging | Add `apiUsage/{uid}/keys/{keyId}/days/{date}` writes inside the auth path |
| No public docs | Static `/api` page on the existing landing site, or extension-side help link to npm README |

## Scope — what counts as "v1 public API"

**In scope:**
- API-key authentication path (alongside existing Firebase ID-token auth)
- Versioned URL prefix `/v1/...` via Hosting rewrite
- Stable JSON contracts for ~8 endpoints (see API contract below)
- Per-key durable rate limiting (Firestore-backed)
- Shared user credit pool (key uses owning user's balance — same as MarkItUp v1)
- API key CRUD: create / list / revoke endpoints, Firebase-token-gated
- Extension Admin-tab UI for key management

**Out of scope (post-v1):**
- OAuth wrapper (deferred until a consumer needs it — Notion, Canva-equivalent, etc.)
- Webhook / async delivery (current endpoints are all <60s and sync is fine)
- Organization/team accounts
- Multi-region
- `@patent-search/sdk` npm package (defer until ≥2 non-MCP consumers exist)
- Per-key credit caps (add when a partner asks)

## Architecture

```
MCP server (patent-search-mcp-server)
  │  HTTPS, header: X-API-Key: psg_live_...
  ▼
Firebase Hosting (rewrites /api/v1/* → ai Cloud Function)
  ▼
ai Cloud Function (existing, modified)
  ├─ resolveAuth() — NEW: tries X-API-Key, falls back to verifyAuth()
  │    ├─ verifyApiKey() — NEW: SHA-256 hash lookup in apiKeys collection
  │    └─ verifyAuth() — EXISTING: Firebase ID token (unchanged)
  ├─ apiKeyRateLimit() — NEW: Firestore-backed, per-key (apikey path only)
  ├─ existing in-memory rateLimits — UNCHANGED (Firebase-token path only)
  ├─ existing path-dispatch switch — UNCHANGED (handlers don't change)
  └─ useCredit() — EXISTING: deducts from uid resolved by auth
```

**Key principle:** API key resolves to the same `uid` that owns it. Credit accounting, Stripe billing, and all downstream Firestore schema stay identical. We are adding an auth method, not a parallel billing system.

## Firestore schema additions

```
apiKeys/{keyId}
  ├─ uid: string                # owning user
  ├─ name: string               # user-visible label ("MCP server prod")
  ├─ keyHash: string            # SHA-256 of the raw key
  ├─ prefix: string             # first 16 chars for UI display (psg_live_abc123...)
  ├─ environment: "live" | "test"
  ├─ createdAt: Timestamp
  ├─ lastUsedAt: Timestamp | null
  ├─ revokedAt: Timestamp | null
  └─ scopes: string[]           # e.g. ["dossier", "search", "credits:read"]

rateLimits/{keyId}
  ├─ windowStart: Timestamp
  ├─ count: number
  └─ (TTL-deleted after window expires)

apiUsage/{uid}/keys/{keyId}/days/{YYYY-MM-DD}
  ├─ requests: number
  ├─ creditsUsed: number
  └─ errors: number
```

Raw keys are shown **once** at creation and never stored. Lookups happen by SHA-256 hash. Format: `psg_live_<32-byte-base64url>` and `psg_test_<32-byte-base64url>` (matches MarkItUp's pattern).

## API contract — v1

All endpoints under `https://us-central1-solicitation-matcher-extension.cloudfunctions.net/ai/v1/...` — direct Cloud Function URL. The `/api/v1/**` Hosting rewrite is committed in `firebase.json` but **inert in production** (the 2026-05-25 deploy's hosting release was aborted at finalization due to a Firestore rules 409 conflict, and we intentionally do NOT re-deploy hosting until the cross-project tangle is fixed — see `feedback_cross_project_hosting_tangle.md` for why). Two additional reasons to prefer the direct CF URL anyway: (1) avoids the Firebase Hosting 60s edge timeout that bit JackpotKeywords; (2) avoids any risk of disrupting GovToolsPro production while the hosting tangle is unresolved.

### Auth

```
X-API-Key: psg_live_<random>
```
or (backward compatible, internal):
```
Authorization: Bearer <firebase-id-token>
```

### Endpoints

Day-1 endpoints (already shipped, wrapping existing handlers):

| Method | Path | Cost | Existing handler |
|---|---|---|---|
| POST | `/v1/dossier` | 3 credits (cache hits free) | `handlePatentDossierRequest` |
| POST | `/v1/dossier-summary` | free (bundled) | `handleDossierSummaryRequest` |
| POST | `/v1/claim-chart` | free (bundled — used inside dossier, no MCP tool in v1.0) | `handleClaimChartRequest` |
| POST | `/v1/prosecution-history` | free | `handleProsecutionHistoryRequest` |
| POST | `/v1/oa-analyze` | 5 free per app, then 1 credit | `handleOfficeActionAnalysisRequest` |
| POST | `/v1/examiner-stats` | free | `handleExaminerStatsRequest` |
| GET | `/v1/credits/balance` | free | `handleCreditRequest` `/credits/balance` |
| POST | `/v1/keys` | free (Firebase-token only) | `handleKeysRequest` create |
| GET | `/v1/keys` | free (Firebase-token only) | `handleKeysRequest` list |
| DELETE | `/v1/keys/:keyId` | free (Firebase-token only) | `handleKeysRequest` revoke |

Day-2A new endpoints (required for MCP v1.0):

| Method | Path | Args | Cost | New backend handler |
|---|---|---|---|---|
| POST | `/v1/search` | `{description, mode: "optimize"\|"execute", strategy?, limit?}` | 1 credit | NEW: wraps `/optimize-query` for mode=optimize; for mode=execute, wraps Google Patents server-side scrape + `/rank` |
| POST | `/v1/similar` | `{patentNumber, limit?}` | free | NEW: extracts similar-documents from Google Patents XHR response (already fetched by dossier code) |
| POST | `/v1/citations` | `{patentNumber, direction: "backward"\|"forward"\|"both"}` | free | NEW: extracts citations standalone (no full dossier payload) |
| POST | `/v1/family` | `{patentNumber}` | free | NEW: extracts patent family from Google Patents XHR response |
| POST | `/v1/cpc` | `{code}` | free | NEW: lookup against USPTO CPC scheme JSON cached locally in `functions/data/cpc.json` |

**Excluded from v1:** `/odp-document` (binary PDF stream, awkward over JSON-only API; defer until a consumer asks). `/synonyms` `/definitions` `/analyze` (lower-value primitives, not exposed as MCP tools per 2026-05-26 lock). `/admin/*` (Firebase-token-only, not API-key surfaceable).

### Rate limits

- All keys: 60 req/min, 1000 req/day per key (matches JK pricing model — Bull-Generator has no paid tier distinction in v1)
- `429` includes `Retry-After` header
- Firebase-token path keeps existing 100 req/hour in-memory limit

### Error mapping

Standard HTTP codes. `401` bad/missing key, `402` insufficient credits, `403` revoked key or scope denied, `429` rate limit, `400` malformed input, `502` upstream failure (Google Patents, USPTO ODP).

### Versioning

- `v1` is stable: no breaking changes within `v1`
- Breaking changes ship under `v2`; both run side-by-side ≥6 months

## Work plan — 1 day

### Day 1: API foundation

- [ ] Port MarkItUp's `functions/src/auth.ts` → Bull-Generator, swap imports to v1 syntax (`functions.https.HttpsError`), swap key prefix to `psg_live_` / `psg_test_`
- [ ] Port MarkItUp's `functions/src/keys.ts` → Bull-Generator, adapt DEFAULT_SCOPES to Bull-Generator endpoints (`dossier`, `search`, `oa-analyze`, `credits:read`)
- [ ] Add Firestore-backed rate limiter (`functions/src/apiRateLimit.ts`) — Firestore counter doc per key, 60/min + 1000/day windows
- [ ] Modify `functions/src/index.ts` `ai` handler:
  - Replace `verifyAuth()` with `resolveAuth()`
  - Branch rate limiter: API-key path uses Firestore-backed; Firebase-token path keeps existing in-memory
  - Map both auth contexts to existing `useCredit(db, uid, ...)` call (uid resolves identically)
- [ ] Add `/keys/*` path branch to the dispatcher (Firebase-token-only, calls `handleKeysRequest`)
- [ ] Add Hosting rewrites to `firebase.json`: `/api/v1/**` → `function: ai`. Verify existing static-landing routes unaffected
- [ ] Add Firestore security rules for `apiKeys`, `rateLimits`, `apiUsage` (admin-only writes; users read their own `apiKeys` list)
- [ ] Deploy + smoke test: `curl` with `X-API-Key` against `/v1/credits/balance`, `/v1/dossier`

### Day 2 (overlaps with PLAN-MCP-SERVER)

- [ ] Add API Keys section to extension Admin tab (`extension-src/src/components/...`):
  - List existing keys (name, prefix, createdAt, lastUsedAt, revoke button)
  - Create-key form (name input, scope checkboxes, environment radio)
  - Modal showing raw key once with "copy" + "I saved it" confirmation
  - Calls existing `ai` function's `/keys/create`, `/keys/list`, `/keys/revoke` endpoints (Firebase-token auth)
- [ ] Local-test the full path: create key via Admin tab → curl against `/v1/dossier` with that key → confirm credit deducts → confirm `apiUsage` log writes

## Open questions

1. **Per-key credit pool vs shared user pool?** **Start shared** (key uses owning user's balance — same as MarkItUp v1). Add per-key spend caps if a partner asks.
2. **Pricing for high-volume API users?** Defer. Existing credit packs and any future subscription cover v1.
3. **PII / retention?** API requests include patent numbers (not PII). Output dossiers are already cached 24h. No new policy needed for v1.
4. **Custom domain for the API?** Defer. Direct Cloud Function URL works for the MCP server and is faster (no Firebase Hosting 60s edge timeout — JK got bit by this).

## Success criteria

- API key minted from extension Admin tab works against `/v1/dossier` via `X-API-Key` header within ≤24h of starting Day 1
- MCP server (see [PLAN-MCP-SERVER.md](./PLAN-MCP-SERVER.md)) successfully calls all 6 v1 endpoints from Claude Code within 48h of starting Day 1
- ≥99% successful response rate on `/v1/dossier` over 7 rolling days post-launch (matches existing browser-extension reliability)
- Zero regressions on existing browser-extension flows (Firebase-token path untouched)

## Related

- [PLAN-MCP-SERVER.md](./PLAN-MCP-SERVER.md) — sole v1 consumer, drives the API contract
- `feedback_mcp_cloning_strategy.md` — three-tier cloning rule justifying selective port from MarkItUp
- `C:\Projects\MarkItUp\planning\PLAN-PUBLIC-API.md` — source playbook
- `C:\Projects\MarkItUp\functions\src\{auth,keys}.ts` — Tier-3 clone sources
- `functions/src/index.ts` — current `ai` Cloud Function (target of modifications)
- `firebase.json` — needs Hosting rewrites added
