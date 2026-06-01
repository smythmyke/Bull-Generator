# Build Plan — EXT-ODP-1 (Legal layer in extension) + DD-1 (Due-Diligence workflow)

**Created:** 2026-05-31. **Status:** Plan only — no code written yet (per user).
**Companion docs:** `ROADMAP.md` (EXT-ODP-1, DD-1, W3-1/FTO-1), `planning/PLAN-API-DATA-MIGRATION.md`, `memory/research_v1_search_fulltext_source.md`.

---

## 0. Grounding facts (verified in code 2026-05-31)

- **The 10 legal/enrichment endpoints already exist, are deployed, and are open to the extension's Firebase auth** — `functions/src/index.ts` dispatches `/challenges`, `/legal-status`, `/assignments`, `/litigation`, `/company-litigation`, `/term`, `/prosecution-timeline`, `/attorney`, `/entity-status`, `/pregrant-pub` with **no `ctx.source` gate** (scope `dossier`). So EXT-ODP-1 is **frontend-only** — no backend change required to call them from the extension.
- **They currently charge ZERO credits on the Firebase/API-key path** (the dispatch returns `{data}` with no `useCredit` call — "free in v1"). RapidAPI bills via the header patch; the extension/API key paths do not. → **Monetization is a deliberate decision, not a default** (see §A0).
- **Additive / no regression risk:** none of this touches the Google Patents dossier path (`patentDossier.ts`/`claimChart.ts`). It's net-new data the extension never had.
- **Where the UI lives:**
  - Compact tab: `extension-src/src/components/tabs/PatentTab.tsx` (patent-number input → 3-credit dossier, 24h cache, "open full dossier" button).
  - Full report page: `patent.html` → `extension-src/src/patent/index.tsx` → `PatentDossierPage.tsx`, which composes numbered `<Section>` components with a sticky nav. Existing sections incl. `ClaimChartSection.tsx`, `IdsSection.tsx` (the pattern to mirror).

---

## A. EXT-ODP-1 — surface the legal layer in the extension

### A0. Decisions to lock BEFORE building (one is pivotal)

| # | Decision | Options | Recommendation |
|---|---|---|---|
| **A0-1** | **Monetization (pivotal)** | (a) keep free; (b) per-section credits; (c) one "Legal Intelligence" bundle price; (d) Pro-subscription gate | **(c or d).** Legal data is the money-maker. Cleanest UX: a single **"Load legal intelligence" action (~8–12 credits, 24h-cached free re-fetch)** that fetches the whole legal bundle for the patent — matches the existing dossier mental model. A Pro-tier gate is the alternative if you'd rather sell a subscription than per-use credits. |
| **A0-2** | **Placement** | (a) new sections in the full dossier page; (b) a dedicated "Legal" tab; (c) both | **(a) + a compact snapshot.** Deep data → new `<Section>`s (§14–§22) in `PatentDossierPage.tsx`; a one-line **"Legal snapshot"** card in `PatentTab` (in-force? #challenges? #suits?) with a "View legal intelligence →" CTA. Avoids a 6th top-level tab. |
| **A0-3** | **Loading** | (a) fetch all on dossier load; (b) lazy per section; (c) one bundle button | **(c).** A single bundle fetch (one credit charge, parallel server calls) keeps it simple and bills once. Render sections from the bundle. |
| **A0-4** | **Company reverse-lookup** placement | (a) Tools tab; (b) small panel on dossier; (c) its own mini-view | **(a) Tools tab** — it's keyed by company name, not a patent, so it doesn't belong in the per-patent dossier. |

> If A0-1 = "bundle" or "Pro gate", a small backend change is needed (add credit gating to these endpoints for the API-key/Firebase path, or a `/v1/legal-bundle` aggregator — see §A2). If A0-1 = "keep free", zero backend change.

### A1. Data contracts (endpoint → response shape the UI renders)

Each is `POST { patentNumber }` → `{ data: <below> }`. (Shapes from the shipped `functions/src/odp/*` + `litigation.ts`.)

- **`/legal-status`** → `{ patentNumber, inForce, statusLabel, lastEventDate, maintenanceEvents:[{code,date,description}] }` — badge (In force / Lapsed / Expired) + maintenance timeline.
- **`/term`** → `{ patentNumber, grantDate, patentTermAdjustmentDays, adjustedExpirationDate, terminalDisclaimer? }` — expiration date + PTA.
- **`/challenges`** → `{ patentNumber, challengeCount, challenges:[{trialNumber, type(IPR/PGR/CBM), petitioner, owner, filingDate, trialStatusCategory, outcome}] }` — "survived/instituted/settled" summary + table.
- **`/litigation`** → `{ patentNumber, caseCount, cases:[{caseNumber, court, dateFiled, cause, plaintiffs, defendants}] }` — who-sued-whom table.
- **`/assignments`** → `{ patentNumber, currentAssignee, assignmentCount, assignments:[{reelFrame, conveyanceText, recordedDate, assignors, assignees}] }` — chain-of-title timeline.
- **`/prosecution-timeline`** → `{ patentNumber, events:[{date, code, description}] }` — vertical event log.
- **`/attorney`** → `{ patentNumber, customerNumber, docketNumber, attorneyCount, attorneys:[{name, registrationNumber, active}] }`.
- **`/entity-status`** → `{ patentNumber, smallEntity, category }` — small/micro/large chip.
- **`/pregrant-pub`** → `{ patentNumber, publicationNumber, publicationDate, ... }` — as-filed link.
- **`/company-litigation`** → `{ query, matchedName, caseCount, asPlaintiffCount, asDefendantCount, cases:[...], related:[], suggestions:[] }` — company footprint (Tools tab).

### A2. Backend work (minimal, conditional on A0-1)

- **If A0-1 = keep free:** none.
- **If A0-1 = bundle / gated (recommended):** add **`/v1/legal-bundle`** (one call, server fans out the per-patent endpoints in parallel, returns a combined object, charges once). Benefits: one round-trip + one credit charge for the extension; **also becomes a new API/MCP tool + RapidAPI endpoint** (monetizes on every surface). ~1 new handler reusing existing functions.

### A3. Frontend work (the bulk)

New components under `extension-src/src/patent/` (mirror `ClaimChartSection.tsx` — presentational, data/loading/error props):
- `LegalStatusSection.tsx`, `TermSection.tsx`, `ChallengesSection.tsx`, `LitigationSection.tsx`, `AssignmentsSection.tsx`, `ProsecutionTimelineSection.tsx`, `AttorneySection.tsx`, `EntityStatusSection.tsx`, `PregrantSection.tsx`.
- Group them in `PatentDossierPage.tsx` under a **"Legal Intelligence"** nav cluster (§14–§22), with the existing `<Section num title intro>` wrapper.
- Page-level fetch: one `loadLegalBundle(patentNumber)` (calls `/v1/legal-bundle` or fans out), wired through the existing `withCreditCheck` hook + `InsufficientCreditsModal`.
- `PatentTab.tsx`: a compact **Legal snapshot** card (in-force chip, challenge count, suit count) + "View legal intelligence →".
- `ToolsTab.tsx`: a **Company litigation lookup** panel (text input → `/company-litigation` → footprint table).
- **Legal disclaimer** ("Factual public-record reporting — not legal advice") on the litigation/challenges sections (consistent with the marketing pages).

### A4. Build sequence & estimate (EXT-ODP-1)

1. **Phase 1 — prove the path (½ day):** `legal-status` + `term` as two sections end-to-end (fetch → render → credit gate). Validates the bundle/credit pattern.
2. **Phase 2 — remaining per-patent sections (1–1.5 days):** the other 7 sections + the "Legal Intelligence" nav cluster.
3. **Phase 3 — snapshot + company lookup (½ day):** PatentTab snapshot card + ToolsTab company-litigation panel.
4. Build extension (`cd extension-src && npm run build`), manual QA on a battle-tested patent (US 8,724,622).

**Estimate: ~2.5–3 days.** Backend adder (`/v1/legal-bundle`): +½ day if A0-1 = bundle/gated.

---

## B. DD-1 — Patent Due-Diligence / Risk Profile workflow

### B1. What it is
One-shot: **patent number → risk profile report** answering "battle-tested? litigious owner? in force? expires when?" — the `due-diligence.html` worked example as a product. **Light AI** (an optional one-paragraph AI verdict), mostly **composition of endpoints that already exist**.

### B2. Why it's cheap once EXT-ODP-1 ships
DD-1 **reuses the EXT-ODP-1 section components + the `/v1/legal-bundle` aggregator.** It's the same data assembled into a one-shot, full-tab report (like the other Workflows cards) with a **verdict header** (risk score/label) on top. So DD-1 ≈ EXT-ODP-1 data layer + a report shell + a verdict.

### B3. Backend
- **Recommended: `/v1/risk-profile`** = `/v1/legal-bundle` + dossier header + an AI verdict (Gemini: 1 short call summarizing the assembled facts into a risk label + 2–3 sentence rationale). One endpoint → reusable as a **new MCP tool + RapidAPI endpoint** (monetizes DD on every surface, not just the extension).
- Flat cost **~40 credits** (bundles all internal calls + the AI verdict).

### B4. Frontend
- A new **"Patent Risk Profile (~40cr)"** card in `WorkflowsTab.tsx` (replace one "Coming soon" or add a 5th) → opens a full-tab report (`risk-profile.html` or reuse the dossier page shell with the legal cluster + verdict header).

### B5. Build sequence & estimate (DD-1)
1. `/v1/risk-profile` aggregator + AI verdict (½–1 day) — after `/v1/legal-bundle` exists.
2. Report page (reuse EXT-ODP-1 sections + verdict header) (½ day).
3. WorkflowsTab card + launch wiring (¼ day).

**Estimate: ~1.5–2 days, mostly reusing EXT-ODP-1.**

---

## C. Cross-cutting

- **Pricing coherence (the deconfliction):** standalone legal lookups (EXT-ODP-1) are cheap/bundled; when the same data is pulled *inside* a workflow (DD-1, FTO/W3), it's covered by the workflow's flat price — never double-charged. One `/v1/legal-bundle` + `/v1/risk-profile` aggregator makes this clean across extension + API + MCP + RapidAPI.
- **No regression risk:** GP dossier path untouched throughout.
- **Disclaimers:** "not legal advice" on all litigation/challenge/FTO output.
- **Sequencing recommendation:** EXT-ODP-1 → DD-1 → (later) FTO/W3 reuse the same `/v1/legal-bundle` data layer.

## D. Open decisions for the user (lock before coding)
1. **A0-1 monetization:** keep free / per-section / **bundle (~8–12cr)** / Pro-gate. ← shapes everything.
2. **`/v1/legal-bundle` aggregator:** yes (recommended — one charge, reusable on all surfaces) / no (client fans out, free).
3. **DD-1 backend:** `/v1/risk-profile` aggregator (recommended, becomes an MCP/RapidAPI product too) / client-orchestrated.
4. **Build EXT-ODP-1 and DD-1 together** (share the aggregator) or **EXT-ODP-1 first, DD-1 next**.
