# Bull-Generator — API/MCP Data-Source Migration Plan

**Date:** 2026-05-31
**Status:** Not started. Test-first — Phases 0–2 are investigation with a hard Go/No-Go gate before any production code.
**Scope:** Migrate **only the public API + MCP server** data path off Google Patents XHR scraping and onto USPTO ODP (US-first), so the RapidAPI-listable surface is legally clean. **The Chrome extension is explicitly left on its current Google Patents path and is not touched by this work.**
**Related:** [REVENUE-BENCHMARKS.md](../REVENUE-BENCHMARKS.md) · [PLAN-PUBLIC-API.md](./PLAN-PUBLIC-API.md) · [PLAN-MCP-SERVER.md](./PLAN-MCP-SERVER.md) · [ROADMAP.md](../ROADMAP.md)

---

## Why this exists

`REVENUE-BENCHMARKS.md` flags Google Patents XHR scraping (`patents.google.com/xhr/result`) as **RED #1 — existential** (Google v. SerpAPI, N.D. Cal. Dec 2025; MTD pending). Reselling scraped Google Patents data on a public marketplace (RapidAPI) is exactly that exposure profile. The locked decision (2026-05-19) is to migrate the public data path to USPTO ODP + EPO OPS + WIPO Patentscope **before any public API launch.**

This plan narrows that to the minimum viable, legally-clean step: **US-only via USPTO ODP for the API/MCP surface**, leaving the extension untouched and deferring EPO/WIPO until a Go/No-Go gate proves they're needed.

## Non-negotiable constraint: do not touch the extension

The extension and the public API currently call the **same handlers** through the same `ai` Cloud Function. The only difference is the resolved auth path:

- Extension → Firebase ID-token (`verifyAuth`), hits `/patent-dossier`
- API / MCP → `X-API-Key: psg_live_*` (`verifyApiKey`), hits `/v1/dossier`

Both are unified today by `index.ts:90` `V1_ALIASES`, which maps `/v1/dossier` → `/patent-dossier` so "both surfaces hit the same dispatch switch" (the existing `handlePatentDossierRequest` → `buildDossierFromHtml`, the Google Patents scraper).

**Design decision (2026-05-31): build a PARALLEL ODP module and re-point the API alias to it. Do NOT edit the Google Patents scraper (`patentDossier.ts`) at all.** Rather than branch a data source *inside* the shared handler (which still touches the file the extension depends on), the API alias points at a new `/odp-dossier` handler. The extension keeps calling `/patent-dossier` → `handlePatentDossierRequest` → `buildDossierFromHtml`, **byte-for-byte unchanged** — it cannot regress, slow down, or pick up new bugs because nothing in its code path changes. The ODP path is purely additive. This is the explicit rationale: protect the known-good extension data-gathering, migrate only the API/MCP surface.

## What the API has to replace

`buildDossierFromHtml` (`functions/src/patentDossier.ts:526`) extracts eight data classes from one Google Patents XHR call. The API endpoints that depend on each:

| Data class | API endpoints consuming it | US replacement (this plan) | Non-US (deferred) |
|---|---|---|---|
| Bibliographic (title, abstract, inventors, assignees, dates, status) | `/v1/dossier` | USPTO ODP | EPO OPS |
| Claims tree | `/v1/dossier` | USPTO ODP full-text | EPO OPS |
| Citations (fwd/back) | `/v1/dossier`, `/v1/citations` | USPTO ODP references | EPO OPS |
| CPC classification | `/v1/dossier`, `/v1/cpc` | USPTO ODP (`/v1/cpc` is already local JSON) | — |
| Patent family | `/v1/dossier`, `/v1/family` | ⚠️ EPO OPS is canonical — ODP continuity is US-only | EPO OPS |
| Similar documents | `/v1/dossier`, `/v1/similar` | ⚠️ Google ML feature — **no clean 1:1 replacement** | — |
| Legal status | `/v1/dossier` | USPTO ODP | EPO OPS |
| Search execution | `/v1/search` | USPTO ODP search API | EPO OPS |

Already on USPTO ODP today (clean, unaffected by this plan): `/v1/prosecution-history`, `/v1/oa-analyze`, `/v1/examiner-stats`, `/v1/cpc`. See `functions/src/usptoOdp.ts`.

**Two known risk areas the spike must resolve:**
1. **Patent family** — the canonical source is EPO OPS (INPADOC). ODP only gives US continuity (parent/child/divisional). For a US-only v1, family is US-continuity-only or dropped.
2. **Similar documents** — Google's proprietary ML ranking. No drop-in. Options: drop from API v1, or substitute a CPC-co-classification / citation-overlap heuristic.

---

## Phases

## Build sequence (revised 2026-05-31 — legal-intelligence-first)

The legal/litigation layer is the headline value: higher-margin, harder to replicate, and — critically — **lower legal risk** than the planned W3 FTO agent. Serving factual legal data (who challenged, who sued, is it alive, who owns it) is **public-record reporting = 🟢 green-tier** in `REVENUE-BENCHMARKS.md`; it is NOT a legal opinion, so it avoids the 🔴 UPL exposure that gates the FTO agent. Revised order:

1. ✅ Phase 3 — core ODP dossier (done)
2. ✅ **Legal Intelligence bundle — BUILT + VERIFIED 2026-05-31.** `/v1/challenges` (PTAB), `/v1/legal-status` (in-force + maintenance history), `/v1/assignments` (chain of title). New files `functions/src/odp/{util,ptab,legalStatus,assignments}.ts`; `odpClient` generalized for POST (PTAB) + `eventDataBag`; `odpDossier` refactored onto shared `util`. Free in v1, available to BOTH auth paths (net-new ODP data, additive — no GP involved). Verified: US8724622 → 15 challenges (8 survived/3 settled/4 FWD, Microsoft & Apple v Uniloc); legal-status in-force + maintenance dates; assignments chain of title w/ reel-frame. `tsc` clean. Scopes mapped to `dossier`. **Pricing deferred to Phase 6** (currently free; per-claim PTAB-decision AI-parse is the future premium tier).
3. Phase 5 — verify extension byte-identical
4. Phase 4 — un-gate summary / claim-chart / search migration
5. ✅ Phase 7 — enrichment endpoints (term, timeline, attorney, entity, pregrant) — BUILT + VERIFIED 2026-05-31
6. Phase 8b/8c — district-court litigation (USPTO dataset ingest, then CourtListener)
7. Phase 6 — RapidAPI listing + premium pricing anchored on the legal bundle

**Positioning:** screening-grade public-record intelligence for the downmarket (solo / pro se / small firms / investors), NOT litigation-grade analytics (Lex Machina / Docket Navigator own that). Always under the existing "not legal advice" disclaimer.

### Phase 0 — Data-source reconnaissance *(investigation only, no code)*
Hard facts on USPTO ODP before writing anything. EPO/WIPO scoped here only as desk research (no registration required yet).

- [x] USPTO ODP — rate limits + endpoint inventory. **Done 2026-05-31, see findings below.**
- [x] USPTO ODP ToS — redistribution/resale check. **Done — clean (US gov work / public domain).**
- [ ] EPO OPS — **desk research only**: capture free-tier weekly quota, OAuth model, and the exact volume threshold where the €2,800/yr commercial license triggers. No app registration yet (deferred to the parallel track if Phase 2 calls for it). *(Deferred — US-only v1 per 2026-05-31 decision.)*
- [ ] WIPO Patentscope — desk research only: confirm whether a real API exists vs. bulk/UI-only, plus attribution/derivative-license terms. *(Deferred — US-only v1.)*
- **Deliverable:** one-page matrix — *source × {auth, rate limit, cost, redistribution-allowed?, coverage}*. **USPTO ODP row complete below.**

#### Phase 0 findings — USPTO ODP (2026-05-31, desk research)

**Auth / cost:** USPTO-issued API key required (we already hold one in prod env as `USPTO_ODP_API_KEY`). Free.

**Rate limits (published):**
- **60 requests / API key / minute** (general endpoints)
- **4 requests / API key / minute** for PDF and ZIP downloads (and multi-case PDF/ZIP)
- Enforced per key. ⚠️ Implication: one dossier rebuild = several ODP calls (biblio + continuity + citations + documents), so the realistic ceiling is **~12–20 dossiers/min/key**, and dossier latency will be higher than today's single Google Patents XHR call. Phase 1 must measure this and likely parallelize ODP fetches + lean on cache.

**Redistribution / resale ToS: 🟢 CLEAN.** USPTO open data is US-government work / public domain — "can be freely used, reused and redistributed by anyone." No clause blocking paid-API resale. Matches `REVENUE-BENCHMARKS.md` Green verdict. **This is the key unblock: ODP-sourced data is safe to list on RapidAPI.**

**Endpoint inventory (data.uspto.gov, Patent File Wrapper API):**
| Need | ODP endpoint | Status |
|---|---|---|
| Bibliographic (title, inventors, assignee, dates, status) | `/patent/applications/{appNum}` `.biblio` + `/search` | ✅ Available |
| Continuity / family (US only) | `/apis/patent-file-wrapper/continuity` | ✅ Available — **US continuity only** (parent/child/divisional), not INPADOC |
| File-wrapper documents | `/patent/applications/{appNum}/documents` | ✅ Already wired (`usptoOdp.ts`) |
| Search | `/apis/patent-file-wrapper/search` | ✅ Available (OpenSearch-style query syntax) |
| Assignments | `.assignments` | ✅ Available |

**⚠️ Coverage gaps (these drive the Phase 2 gate):**
1. **Application-centric + post-2001 only.** File-wrapper API is keyed on *applications* filed **≥ 2001-01-01**. Granted-patent lookups must resolve patent# → app#. Pre-2001 patents are out of coverage.
2. ~~**Claims full-text: NOT in the REST file-wrapper API.**~~ **RESOLVED in Phase 1 (2026-05-31):** the biblio response embeds `grantDocumentMetaData.fileLocationURI` → a per-patent **grant full-text XML** containing claims, abstract, description, and backward citations. Reachable via one authenticated GET (follow the 302 redirect with `-L`). Not bulk-only. See Phase 1 findings.
3. **Citation graph differs from Google Patents.** No direct forward/backward citation REST endpoint matching GP's graph. The **Enriched Citation API** gives examiner-cited prior art extracted from office actions (backward-ish, different semantics); **forward citations are weak/absent.** `/v1/citations` will not be a 1:1 replacement.
4. **Patent family is US-continuity-only.** True international (INPADOC) family needs EPO OPS — confirms `/v1/family` is degraded under US-only v1.
5. **"Similar documents": no ODP equivalent** (confirmed, as expected — it's Google's ML feature).

**Honest Phase 0 verdict:** ODP cleanly and legally covers **bibliographic + prosecution + US continuity + assignments**. It is **weak or awkward** on claims full-text (bulk-only), citation graph (different semantics), international family (needs EPO), and similar docs (none). A US-only ODP `/v1/dossier` is strong on biblio/prosecution but **materially degraded vs. the Google Patents dossier on claims/citations/family/similar.** Feasibility is therefore **partial-yes** — the Phase 2 gate is real, not a formality.

### Phase 1 — Feasibility spike *(throwaway script, real ODP calls)*
Prove a dossier can be reconstructed from USPTO ODP for real US patents.

- [x] Live ODP probes against real US patents with the production key. **Done 2026-05-31 — see findings below.**
- [ ] Broaden the sample (pre-2001 edge case, recently-granted, NPL-heavy) — partially done; extend before Phase 2 sign-off.
- [ ] Resolve forward-citation derivation (the one real residual gap) — Phase 2 decision input.

#### Phase 1 findings — live ODP probe (2026-05-31)

Probed with the production key against real US patents (app 15637810 / patent 10,509,666; app 14643719 / patent 10,000,000). **Base URL `https://api.uspto.gov/api/v1/patent/applications`, header `X-API-KEY`.**

**Verified working endpoints + coverage:**
| Dossier piece | ODP source (verified) | Verdict |
|---|---|---|
| Entry point: patent# → app# | `GET /search?q=applicationMetaData.patentNumber:<num>` | ✅ |
| Bibliographic: title, inventors (+addresses), applicant, filing/grant/pub dates, status, examiner, art unit, entity status | `GET /{appNum}` → `applicationMetaData` | ✅ Rich |
| CPC classification | `applicationMetaData.cpcClassificationBag` (also in grant XML) | ✅ |
| Abstract | grant full-text XML | ✅ |
| **Claims (full text)** | grant XML — **32 `<claim>` tags** for the test patent | ✅ |
| **Backward citations** (patent + NPL) | grant XML — 10 `<patcit>` / `<us-citation>` / `<us-references-cited>` | ✅ |
| Current assignee + chain of title | `GET /{appNum}` → `assignmentBag[].assigneeBag` (reel/frame, conveyance, dates) | ✅ Richer than GP |
| US family / continuity | `GET /{appNum}/continuity` → `childContinuityBag` / `parentContinuityBag` (CON/DIV/CIP codes) | ✅ US-only |

**Grant full-text XML** is the key unlock: `applicationMetaData → grantDocumentMetaData.fileLocationURI` returns a per-patent `us-patent-grant` XML (~106 KB for the test patent) via one GET — **must follow the 302 redirect (`curl -L`)**. Contains claims, abstract, description, CPC, and backward citations.

**Latency (measured):** biblio ~0.4s · grant XML ~1.3s · continuity ~0.2s · search ~0.2s. Full dossier ≈ **3 calls ≈ ~1.3s parallel / ~2s sequential** — comparable to today's single GP XHR (which itself retries). Acceptable.

**Rate-limit math:** 60 calls/min/key ÷ ~3 calls/dossier ≈ **~20 fresh dossiers/min/key**. Fine for a cached API; revisit only at scale.

**Residual gaps (Phase 2 decisions):**
1. **Forward citations** — grant XML carries only *backward* refs. No direct ODP forward-citation endpoint found; would require a reverse search ("who cites X") or accepting the gap. `/v1/citations` forward direction is the open item.
2. **Similar documents** — confirmed no ODP equivalent (Google ML). Drop or substitute (CPC/citation-overlap).
3. **International family** — `continuity` is US-only; INPADOC needs EPO OPS (deferred).
4. **Coverage floor** — file-wrapper is apps filed ≥ 2001; pre-2001 patents need a fallback or an out-of-coverage error.

**Phase 1 verdict: FEASIBLE — high fidelity.** A US `/v1/dossier` rebuilt from ODP reconstructs an estimated **~85–90%** of the Google Patents dossier (everything except forward citations + similar docs), on legally-clean public-domain data. The migration is a go pending the Phase 2 decisions on the residual gaps.

### Phase 2 — Go/No-Go decision gate — ✅ RESOLVED 2026-05-31

Decided with Phase 1 spike data in hand. **Verdict: GO, US-only, ODP-sourced.**

- [x] **US-only v1 confirmed** (ODP, free, clean redistribution). EPO in parallel only "if we see promise" — not on critical path.
- [x] **"Similar documents" → DROPPED from v1.** `/v1/similar` removed from the API surface; corresponding MCP tool dropped. Revisit only if a consumer asks.
- [x] **Forward citations → DROPPED from v1.** `/v1/citations` ships **backward-only** (from grant XML, verified). Forward direction returns a clear "not available in US v1" response.
- [x] **"Family" → US-continuity-only.** `/v1/family` ships from the `/continuity` endpoint (parent/child), labeled US-only. International INPADOC deferred with EPO.
- [x] **Pre-2001 patents → out-of-coverage error** (file-wrapper coverage floor), consistent with existing `usptoOdp.ts` behavior.

#### Final per-endpoint disposition for the migrated API path

| Endpoint | v1 disposition (US ODP path) |
|---|---|
| `/v1/dossier` | ✅ Migrated — biblio + grant-XML (claims/abstract/CPC/backward-cites) + continuity + assignments. No forward cites, no similar. |
| `/v1/search` | ✅ Migrated — ODP `/search` query syntax. |
| `/v1/citations` | ◐ Reduced — **backward only**. |
| `/v1/family` | ◐ Reduced — **US continuity only**. |
| `/v1/similar` | ✗ **Cut from v1.** |
| `/v1/cpc`, `/v1/prosecution-history`, `/v1/examiner-stats`, `/v1/oa-analyze` | ✅ Already ODP/local — unchanged. |

**Gate cleared — Phase 3 (production code) is unblocked.**

### Phase 3 — Parallel ODP module *(first production code — additive only)* — ◐ CORE DONE 2026-05-31

**Principle: zero edits to `patentDossier.ts` (the Google Patents scraper) or `claimChart.ts`. The extension path is untouched. New code only, plus auth-source routing in the dispatcher.**

**Status (2026-05-31):** Built and verified end-to-end against real patents. New files `functions/src/odp/{grantXmlParser,odpClient,odpDossier}.ts`. `index.ts` selects ODP handlers when `ctx.source === "apikey"` (extension's Firebase-token path unchanged). `tsc` clean. Verified: US10000000, US10509666, US7654321, US7000000, US8000000 all reconstruct correctly (biblio, abstract, claims tree w/ independents, backward citations, CPC, US family); EP rejected by US-only guard; pre-2001/no-grant returns clean `not_found`. Harness: `functions/scripts/test-odp-dossier.js`.

**Routing chosen:** rather than re-point the V1 alias, the dispatcher branches on `ctx.source` (`apikey` → ODP, `firebase` → Google Patents). This gives the same guarantee (API keys never reach Google Patents) and is provably contained to `index.ts`. Endpoints wired to ODP for API keys: `/v1/dossier`, `/v1/similar`, `/v1/citations`, `/v1/family`, `/v1/claims`.

**Deferred to Phase 4 (gated, not leaking):** `/v1/dossier-summary` and `/v1/claim-chart` fetch their dossier via Google Patents internally; for API-key callers they now return a clean `501 not_implemented` ("use /v1/dossier") so no scraped data is served on the marketplace surface. ODP-backing these (summary reimplements its own inline GP fetch; claim-chart calls `handlePatentDossierRequest`) is the next sub-task. `/v1/search` execution (separate Google XHR query + AI-Boolean pipeline in `searchExecute.ts`) also remains.

**Minor known gap:** pre-2013 patents with no `cpcClassificationBag` in biblio yield `cpc=0` (CPC postdates them). Could fall back to grant-XML `classification-cpc` if needed.

---

Original design notes (for reference):

**Principle: zero edits to `patentDossier.ts` (the Google Patents scraper). The extension path is untouched. New code only, plus a one-line API alias re-point.**

New files:
- [ ] `functions/src/odp/odpDossier.ts` — `handleOdpDossierRequest` + `buildDossierFromOdp(biblio, grantXml, continuity)` emitting the **same `PatentDossier` shape** (import the types from `patentDossier.ts`).
- [ ] `functions/src/odp/grantXmlParser.ts` — parse `us-patent-grant` XML → claims tree, abstract, backward citations, CPC.
- [ ] ODP fetch orchestration (extend `usptoOdp.ts` or new `odp/odpFetch.ts`): biblio (`/{appNum}`), grant XML (`grantDocumentMetaData.fileLocationURI`, **follow 302**), continuity (`/{appNum}/continuity`), search (`/search?q=...patentNumber:N`) — fetched in parallel.

Reuse (import / copy, don't duplicate):
- [ ] Import all `Dossier*` types + `PatentDossier` + `normalizePatentNumber` + `anticipatedExpiration` + entity-decode/retry/sleep helpers from `patentDossier.ts`. Reusing the output contract means claim chart / OA analyzer / IDS / dossier summary consume ODP output with **zero changes**.
- [ ] Copy the cache-layer pattern with a **separate collection** (`odpDossierCache`) so API and extension caches never collide.
- [ ] Reuse `usptoOdp.ts` fetch scaffolding (`X-API-KEY` header, error classes, timeout).

Single edit to existing code (API-surface only):
- [ ] `index.ts`: re-point `V1_ALIASES["/dossier"]` → `/odp-dossier` (+ `/search`), add the `/odp-dossier` dispatch case calling `handleOdpDossierRequest`. The extension's `/patent-dossier` route is left exactly as-is.
- [ ] US-jurisdiction + coverage guard on the ODP path: non-US patent numbers, or pre-2001 apps, return a clear "US-only / out-of-coverage in v1" error (never falls back to Google).

### Phase 4 — Wire the API endpoints
- [ ] Point `/v1/dossier`, `/v1/search`, `/v1/citations`, `/v1/family`, `/v1/similar` at `odpSource` per the Phase 2 verdict.
- [ ] Separate cache namespace/schema-version for the API path so API and extension dossier caches don't collide (`dossierCache` is currently shared by patent number).

### Phase 5 — Verify the migrated API
- [ ] Re-run the Phase 1 diff against the live `/v1/*` endpoints via `X-API-Key`.
- [ ] **Regression-check the extension** (Firebase path) returns byte-identical dossiers to pre-change — this is the proof the extension is untouched.
- [ ] Confirm `PLAN-PUBLIC-API.md` reliability target (≥99% on `/v1/dossier` over 7 rolling days).

### Phase 6 — RapidAPI listing prep *(only after 0–5 pass)*
- [ ] Apply `X-RapidAPI-Billing: Credits=<n>` + `X-RapidAPI-Proxy-Secret` validation per `PLAN-PUBLIC-API.md:202`, reusing the JackpotKeywords pilot.
- [ ] Set API-tier pricing (`REVENUE-BENCHMARKS.md §2` flags the current 3-credit dossier as 3–5× too cheap for external developers).
- [ ] List only the clean ODP-backed surface.

---

## Phase 7 — ODP-unlocked enrichment endpoints (net-new vs Google Patents) — ✅ BUILT 2026-05-31

**Shipped (commit pending):** `/v1/{term, prosecution-timeline, attorney, entity-status, pregrant-pub}` in `functions/src/odp/enrichment.ts` (shared `resolveWrapper` front door; reads the same wrapper as the dossier). `/v1/legal-status` + `/v1/assignments` shipped earlier with the legal bundle. Free in v1, both auth paths, scopes→`dossier`. Verified vs real patents: term (US8000000 = +206 PTA days → 2028-05-11), 67-event timeline, 24 attorneys w/ reg#, entity status, 20 as-filed pregrant claims. Remaining Phase-7 item from the table below: nothing — all seven enrichment endpoints now live (`legal-status` + `assignments` in the legal bundle; the other five here).

Verified 2026-05-31: the ODP file wrapper carries a prosecution / legal / administrative
layer the Google Patents scrape never exposed. These become **new differentiated
endpoints + MCP tools a Google-scraping competitor structurally cannot offer.** US-only;
each degrades to empty gracefully when a field is absent. All ride the SAME ODP fetch
already performed for `/v1/dossier` (the search call returns most of these fields inline),
so they are cheap to add once `odpClient` is in place.

| Candidate endpoint | MCP tool | ODP source (verified field) | Value |
|---|---|---|---|
| `/v1/legal-status` | `patent_legal_status` | `eventDataBag` maintenance-fee events | in-force vs lapsed + fee history (cleaner than Google's label) |
| `/v1/assignments` | `patent_assignments` | `assignmentBag` (reel/frame, `conveyanceText`, assignor/assignee, dates) | chain of title; M&A / litigation due diligence (🟢 green in REVENUE-BENCHMARKS) |
| `/v1/term` | `patent_term` | `patentTermAdjustmentData` (A/B/C delay) | PTA-adjusted expiration math |
| `/v1/prosecution-timeline` | `patent_timeline` | `eventDataBag` (full event log, e.g. 67 events) | event history — distinct from `/prosecution-history` (which lists *documents*) |
| `/v1/attorney` | `patent_attorney` | `recordAttorney` (`attorneyBag`, `powerOfAttorneyBag`, `customerNumber`) + `docketNumber` | who prosecutes for whom — competitive intel |
| `/v1/entity-status` | (bundled in dossier) | `applicationMetaData.entityStatusData` | small/micro/large — company-size signal |
| `/v1/pregrant-pub` | `patent_pregrant` | `pgpubDocumentMetaData.fileLocationURI` | as-filed vs as-granted claim diff |

Notes:
- **Overlap:** `/examiner-stats` + `/prosecution-history` already tap ODP. The timeline / PTA / assignments / attorney / entity-status / pgpub pieces are net-new and currently unexposed anywhere.
- Propagate to ROADMAP backlog + `PLAN-MCP-SERVER.md` tool list when scheduled.
- Build only after the Phase 3–5 core dossier ships and proves reliable.
- **Litigation history** (who-sued-who) is a separate track — see "Litigation-history sources (research)" below; it needs sources beyond ODP (PTAB API for validity challenges, CourtListener/RECAP for district-court suits).

## Phase 8 — Litigation history (who-sued-who-over-what)

Three free sources, sequenced by effort-vs-payoff. PTAB + the USPTO litigation dataset are
public-domain (RapidAPI-safe); CourtListener ToS needs review before resale. Build after the
core dossier (Phase 3–5) proves reliable.

### Stage 8a — PTAB validity challenges — ✅ VERIFIED 2026-05-31

**Uses our EXISTING ODP key — zero new auth.** Answers "who challenged this patent's validity, when, with what outcome."

- `POST https://api.uspto.gov/api/v1/patent/trials/proceedings/search`, body `{"q":"patentOwnerData.patentNumber:<digits>"}`, header `X-API-KEY`.
- Also: `GET /patent/trials/proceedings/{trialNumber}`, `GET /patent/trials/{trialNumber}/documents`, `POST /patent/trials/decisions/search`.
- Per record: `trialNumber` (e.g. IPR2019-01559), `patentOwnerData` (realPartyInInterestName + counsel + art unit), `regularPetitionerData` (challenger realPartyInInterestName + counsel), `trialMetaData` (`trialTypeCode` IPR/PGR/CBM, `petitionFilingDate`, `accordedFilingDate`, `institutionDecisionDate`, `trialStatusCategory`).
- **Verified:** patent 8724622 (Uniloc) → 15 IPRs; e.g. **Microsoft Corporation** challenged **Uniloc 2017 LLC**, IPR2019-01559, filed 2019-09-13, instituted 2020-03-12. HTTP 200, 0.22s.
- **Outcome is free + structured:** `trialMetaData.trialStatusCategory` ∈ {`Institution Denied` (patent survived the challenge), `Final Written Decision` (claims usually cancelled), `Terminated-Other` (settled), …}. For 8724622: 8 denied / 4 FWD / 3 terminated; petitioners include Apple and Microsoft.
- **Decision documents (verified):** `GET /patent/trials/{trialNumber}/documents` → 78 docs for IPR2017-01798; each `documentData` has `documentTitleText`, `documentTypeDescriptionText`, `documentFilingDate`, and `fileDownloadURI` (FWD / institution-decision PDFs downloadable). The decisions-*search* endpoint field name is still TBD (404'd on `patentNumber` and `proceedingNumber`) — the documents endpoint covers the need.
- **Per-claim outcome** ("claims 1–8 held unpatentable") lives in the FWD PDF *text*, NOT a structured field → fetch + AI-parse (reuse the `/oa-analyze` Gemini-multimodal pattern), **credit-priced like OA analysis**. Trial-level outcome = free/structured; per-claim = premium parse.
- → New endpoint `/v1/challenges` (MCP `patent_challenges`). Precise, current, public-domain. **Ships first (part of the priority Legal Intelligence bundle).**

### Stage 8b — District-court infringement (historical)

- **USPTO OCE Patent Litigation Dataset (PTLITIG):** ~97k district-court cases 1963–2020, with **hand-coded patent-in-suit** + parties + attorneys + cause of action + court + dates. Bulk download (Stata/CSV) → ingest to Firestore for free per-patent lookups.
- → New endpoint `/v1/litigation` (MCP `patent_litigation`). Public-domain. **Caveat: coverage ends 2020** (historical only).

### Stage 8c — District-court infringement (current)

- **CourtListener / RECAP API (Free Law Project):** live federal dockets; filter Nature-of-Suit 830 (Patent) + party name. Separate API + key + attribution/ToS.
- → Enrichment layer for active suits. **Caveat:** patent#→case linkage is party-level, not always precise (PACER dockets rarely list patent numbers in structured form). **Review resale ToS before listing.** Build last.

**Coverage summary:** 8a = validity challenges (precise + current); 8b = infringement suits (precise + historical ≤2020); 8c = infringement suits (live but party-level). Together they give a real "litigation history" view, mostly on public-domain data.

## Parallel track (stakeholder-driven, optional)

Per the 2026-05-31 decision: stakeholder *may* register an EPO OPS key in parallel "if we see promise" during Phases 0–1. If that key materializes, EPO OPS desk research (Phase 0) upgrades to a live probe (Phase 1-style) and feeds the Phase 2 gate — potentially expanding v1 scope to US+EU. **Not on the critical path.** US-only ships regardless.

## Open questions (resolved at the Phase 2 gate)

1. Does ODP latency (multiple endpoint calls to rebuild one dossier) blow the dossier response budget vs. the single GP XHR call? → Phase 1 measures it; may need parallel ODP fetches + caching.
2. Is "similar documents" worth a heuristic substitute, or do API consumers not need it? → Phase 2 decision.
3. Does the shared `dossierCache` need splitting now, or can API entries coexist by schema version? → Phase 4.

## Success criteria

- `/v1/dossier` via `X-API-Key` returns a US patent dossier sourced entirely from USPTO ODP (zero Google Patents calls on the API path).
- Extension dossiers (Firebase path) are byte-identical to pre-migration — zero regression.
- No Google Patents data is served through any RapidAPI-listed endpoint.
- Phase 0–1 deliverables prove feasibility + real costs/limits before any production code was written.

## Related

- `functions/src/patentDossier.ts` — `buildDossierFromHtml` (the GP scrape to replace on the API path)
- `functions/src/usptoOdp.ts` — existing ODP integration (file-wrapper only today; extend for bibliographic/claims/family/citations/search)
- `functions/src/searchExecute.ts` — `/v1/search` execution path
- `functions/src/auth.ts` — `resolveAuth()` (the auth context the data-source switch keys off)
- `REVENUE-BENCHMARKS.md §1, §2` — RED #1 risk + per-endpoint ToS verdicts
- `PLAN-PUBLIC-API.md` — endpoint contract + RapidAPI glue spec
