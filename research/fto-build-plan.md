# Freedom-to-Operate (FTO) — Build Plan

> **Status:** Draft 2026-05-13.
> **Pricing:** intentionally deferred — set after Phase 5 beta produces real cost-per-run and quality data.
> **Canonical location:** this file.

---

## 1. Locked decisions (2026-05-13)

| Decision | Value |
|---|---|
| Output-quality reviewer | Michael (former USPTO examiner — internal review, no outside attorney needed for Phase 0) |
| Launch jurisdiction | **US first** (Phase 1–5) → **EU added in Phase 5.5** before general availability |
| Beta access model | Free for selected pilot users |
| Verification stage scope | Top-10 high-risk cells per run; remainder flagged "unverified — manual review" |
| Pricing | Deferred. Placeholder "~100 credits" in `WorkflowsTab.tsx:32` stays placeholder. Real number set post-Phase-5 from accumulated cost + accuracy data |
| Synthesis model (Stage 5) | **Gemini Flash** (not Pro) |
| Stage 2 search depth | Top-30 candidates per feature; tune in Phase 0 from recall measurements |
| Patent data cache | **None.** FTO does not read from or write to `dossierCache`. Reason: with billions of patents in existence, the probability of overlap between User A's working set and User B's is negligible; caching is gambling against the population. Each FTO run fetches fresh from Google Patents and discards its working set on completion. |
| Long-run UX | **Modal in extension**, not email. Expected runtime 4–10 min typical, up to 15 min worst case. Modal subscribes to Firestore job doc; closing it does not cancel the run; "Run in progress" badge on FTO tab restores it. |
| Cloud Function runtime | **1st-gen** for Phase 1 (9-min cap, requires aggressive parallelization + candidate caps). Migrate to 2nd-gen in Phase 4 only if real runs hit the ceiling. |

---

## 2. What FTO does

**Input:** Free-text product description.
**Output:** Per-feature × per-patent risk matrix scoring infringement risk against currently-enforceable patents in the chosen jurisdiction.

It answers: *"Can I sell this product without getting sued?"* — as a screening tool, not a legal opinion.

**Buyer:** Founders, PMs, R&D leads at companies about to launch a product. Same audience as patent pros, but the use case is pre-launch defense, not prosecution.

**Positioning:** Law firms charge $5K–50K for an FTO opinion. This tool is a pre-screen — tells the user whether they need to pay for the real engagement.

---

## 3. Methodology — five quality dimensions

| Dimension | Why it matters | How we defend it |
|---|---|---|
| **Recall** (did we find the relevant patents?) | False negatives = "we said you're safe, you got sued" — the lawsuit scenario | Multi-tier search per feature; CPC expansion; deliberate over-fetching |
| **Active-status accuracy** | An expired patent isn't a risk; reporting one as active = wasted lawyer time + lost trust | Cross-check Google Patents legal status + USPTO ODP (US) / EPO OPS (EU) + maintenance-fee status |
| **Claim-element grounding** | Risk score must be based on actual claim language, not topic similarity | Reuse Claim Chart §12 element decomposition; map product features to claim elements explicitly |
| **Verification** | LLMs hallucinate or paraphrase citations | Stage 6 string-matches every high-risk cell's cited element against the real patent claim text |
| **Jurisdiction integrity** | A US-active patent doesn't restrict EU sales (and vice versa) | Hard separation per jurisdiction; never blend results across jurisdictions in a single matrix |

---

## 4. End-to-end pipeline (6 stages)

```
Product description
   │
   ▼
[1] Feature Extraction       (Gemini Flash, 1 call)
   │   → 5–25 product features with search terms
   ▼
[2] Per-Feature Search        (Google Patents XHR, N searches per feature)
   │   → ~50–200 deduped candidate patents
   ▼
[3] Active-Status Filter      (Google Patents + USPTO ODP / EPO OPS)
   │   → typically ~30–60% survive
   ▼
[4] Per-Patent Risk Analysis  (Gemini Flash, 1 call per candidate)
   │   → risk score per (feature × patent) cell
   ▼
[5] Synthesis                 (Gemini Flash or Pro, 1 call)
   │   → ranked risk matrix + executive summary
   ▼
[6] Verification              (Cached patent text + literal/Gemini match)
       → confirmed citations or downgraded scores
```

Each stage writes progress + partial results to the Firestore job doc so the user sees live updates as cells stream in.

---

## 5. Stage-by-stage specification

### Stage 1 — Feature Extraction

**Input:** Product description (50–2000 words; UI enforces minimum length + clarity).

**Prompt shape:**
- Role: patent paralegal.
- Task: decompose product into 5–25 features a patent claim might cover.
- Per feature: `name`, `description`, `category` (physical/process/material/configuration/software), `searchTerms` (3–6 terms + synonyms), `claimRelevant` (filter out obvious public-domain).
- Refuses if description too vague → returns `needsClarification: true` with prompted follow-ups.

**Output:** Structured JSON list of features.

### Stage 2 — Per-Feature Search

**For each feature:**
- Generate broad Boolean query (reuses existing `/generate-strategy-searches`)
- Optionally generate moderate + narrow tiers as fallback breadth
- Search Google Patents XHR (reuses existing pipeline)
- Take top ~30 candidates per feature

**Dedupe:** Patents matching multiple features are kept; track `foundForFeatures: string[]`.

**Cost-control valve:** Cap total candidates at 150. Beyond that, keep highest-frequency hits.

### Stage 3 — Active-Status Filter

**For each candidate patent:**
- Pull legal status from Google Patents (existing `googlePatentsEnrich.ts`)
- Drop: expired, abandoned, lapsed for non-payment, withdrawn
- Cross-check US patents via USPTO ODP (existing `usptoOdp.ts`) — Google's status data is sometimes stale
- (Phase 5.5+) EU cross-check via EPO OPS, per-country validation lookup
- Flag uncertain (e.g., foreign equivalents we can't verify) as `requiresManualReview`

**Output:** Filtered candidate set + status metadata per patent.

**Quality gate:** Uncertain patents listed in the report by name. Never silently included.

### Stage 4 — Per-Patent Risk Analysis

**For each surviving candidate:**
- Pull independent claims (existing dossier infra)
- Pull claim element decomposition (reuse Claim Chart §12 logic — `/claim-chart` endpoint)
- For each feature the patent surfaced for, send to Gemini:
  - Product feature description
  - Claim element list
  - Q: "Does this claim's elements potentially read on the product feature? Score `high` / `medium` / `low` / `none`. Cite specific elements verbatim."
- Returns: risk score per `(patent × feature)` cell with cited elements + rationale

**Output:** Sparse risk matrix.

### Stage 5 — Synthesis

**Inputs:** Risk matrix + feature list + patent metadata.

**Gemini call produces:**
- Executive summary (3–5 paragraphs, plain English)
- Ranked top 5–10 "patents most likely to be a problem"
- Feature-by-feature commentary
- Recommended next steps ("consider design-around on Feature 3"; "obtain formal opinion on US10867416 before launch")

**Possibly Gemini Pro here** — synthesis quality is what makes the report feel premium vs. cheap. Test both Flash and Pro in Phase 1.

### Stage 6 — Verification (trust gate)

Only runs on cells scored `high`. **Cap: top 10 high-risk cells.**

For each high-risk cell:
1. Get actual claim text (cached dossier > fresh Google Patents fetch for misses)
2. String-match Gemini's `citedElement` against real claim text (whitespace/punctuation/case normalized; ~95% similarity threshold)
3. If literal match fails, second Gemini pass with the real claim text: "Does this claim literally contain the element you cited? Quote verbatim or report 'not present'." Catches defensible paraphrases.
4. Outcomes:
   - **Verified** → keep `high`, attach `verifiedQuote` to the cell
   - **Paraphrase-confirmed** → keep `high`, replace `citedElement` with verbatim quote
   - **Not present** → downgrade to `medium`, flag `verificationFailed: true`, surface in UI

Policy surfaced plainly in the report: *"Risk scores marked ✓ have been claim-text-verified. Medium/low scores have not been verified."*

Cells beyond the top-10 high cap: keep `high` rating but flag `unverified: true` with the message *"Manual review recommended — automated verification cap reached."*

---

## 6. UX flow

### Entry point
Workflows tab → "Freedom-to-Operate" card (already scaffolded in `WorkflowsTab.tsx:28-34`) → click "Start" → opens `fto.html` full tab.

### Full-tab UI states

**State 1 — Input form**
- Large textarea for product description (placeholder examples)
- Jurisdiction dropdown: US / EU (EU disabled until Phase 5.5)
- Optional: "Known competitors" field (seeds Stage 2 with assignee filters)
- Optional: "Patents already known about" exclusion list
- Required: disclaimer acknowledgment checkbox
- Submit → creates Firestore job doc, advances to State 2

**State 2 — Live progress**
- 6-stage progress bar matching the pipeline
- Per-stage timing
- Streaming partial results: features appear as extracted; candidate count ticks up; risk cells fill in
- Cancel button
- "Continue in background" — page can close, results survive in Firestore

**State 3 — Results dashboard**
- Header: overall risk rating + run metadata
- **Risk matrix** — patents × features grid, color-coded cells, verification badges
- **Sortable patent list** — sorted by aggregate risk
- Per-patent drill-in: full claim text, cited element with verification status, rationale, link to Google Patents
- Executive summary at top
- Recommendations at bottom
- Always-visible disclaimer banner
- Export buttons: PDF, CSV
- "Re-run" / "New analysis" actions

**State 4 — Failure modes**
- Description too vague → return to form with "ambiguity points" extracted
- Zero candidates → "no risk identified — likely means description didn't generate good queries. Try again with more technical detail."
- Mid-run failure → partial results preserved, retry from failed stage
- Throttling → friendly retry UI

---

## 7. Architecture

### New files

| Path | Purpose |
|---|---|
| `functions/src/fto.ts` | Main orchestrator: `/fto-start`, `/fto-cancel`, runs the 6-stage pipeline |
| `functions/src/ftoPrompts.ts` | All Gemini prompts (separated for iteration / A/B testing) |
| `functions/src/ftoTypes.ts` | Shared type definitions |
| `functions/src/epoOps.ts` | (Phase 5.5) EPO OPS API client for EU active-status |
| `extension-src/public/fto.html` | Full-tab route entry point |
| `extension-src/src/fto/FtoApp.tsx` | Root component |
| `extension-src/src/fto/FtoInputForm.tsx` | State 1 |
| `extension-src/src/fto/FtoProgress.tsx` | State 2 (Firestore subscription) |
| `extension-src/src/fto/FtoResults.tsx` | State 3 |
| `extension-src/src/fto/RiskMatrix.tsx` | Matrix visualization |
| `extension-src/src/fto/PatentDrillIn.tsx` | Per-patent detail panel |
| `extension-src/src/fto/ftoPdfExport.ts` | PDF generator with disclaimer watermarking |

### Reused / extended

| Existing | What we reuse |
|---|---|
| `functions/src/patentDossier.ts` | `fetchPatentHtml`, `buildDossierFromHtml`, rate-limit retry |
| `functions/src/googlePatentsEnrich.ts` | Claim parsing, legal status |
| `functions/src/usptoOdp.ts` | US active-status cross-check |
| `functions/src/ai.ts` (search endpoints) | Boolean query generation |
| `functions/src/httpHeaders.ts` | Browser-realistic headers (just shipped) |
| Existing patent search pipeline | Stage 2 search execution |

### Endpoints

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/fto-start` | POST | Bearer + credit check (no-op during beta) | Create job, kick off pipeline asynchronously |
| `/fto-cancel` | POST | Bearer | Mark job cancelled |
| `/fto-retry-stage` | POST | Bearer | Resume failed job from last successful stage |

### Async pattern

**Firestore document subscription**, not HTTP polling.

- Client subscribes to `ftoJobs/{jobId}` via `onSnapshot`
- Cloud Function writes progress updates throughout the run
- Client renders state directly from the doc — no polling endpoints needed
- Job survives if client closes tab; reopens to same job by ID

**Cloud Function execution model:**
- 1st-gen `functions.runWith({ timeoutSeconds: 540, memory: "1GB" })` — 9-min max, sufficient for most runs
- For large jobs (200+ candidates) we may break Stage 4 into batches that re-invoke the function — defer until we see real timing data from Phase 1

---

## 8. Firestore schema

```ts
// ftoJobs/{jobId}
{
  userId: string,
  status: 'queued' | 'extracting_features' | 'searching' | 'filtering_status'
        | 'analyzing' | 'synthesizing' | 'verifying' | 'complete' | 'failed' | 'cancelled',
  progress: {
    stage: string,
    completedItems: number,
    totalItems: number,
    message: string,
    updatedAt: Timestamp,
  },
  input: {
    productDescription: string,
    jurisdiction: 'US' | 'EU',
    knownCompetitors?: string[],
    excludePatents?: string[],
    disclaimerAcknowledged: true,
    disclaimerVersion: string,  // for audit
  },
  features?: Feature[],
  candidates?: Candidate[],          // after Stage 2
  filteredCandidates?: Candidate[],  // after Stage 3
  riskMatrix?: RiskCell[],           // after Stage 4
  synthesis?: { executiveSummary, topRisks, recommendations },  // Stage 5
  verifiedCells?: VerifiedCell[],    // after Stage 6
  costTracking: {
    geminiCalls: number,
    inputTokens: number,
    outputTokens: number,
    googlePatentsFetches: number,
    odpFetches: number,
    epoOpsFetches: number,           // Phase 5.5
    estimatedCostUsd: number,
    stageTimingsMs: Record<string, number>,
  },
  error?: { stage, message, recoverable: boolean },
  createdAt: Timestamp,
  completedAt?: Timestamp,
}
```

---

## 9. EU expansion (Phase 5.5)

EU is *not* a checkbox — it adds real infrastructure.

### What changes

| Component | US | EU addition |
|---|---|---|
| Active-status source | USPTO ODP (already wired) | **EPO OPS API** — free tier, requires registration + API key, XML response format |
| Validation/lapse model | Single national status | Per-country: a granted EP patent may only be active in N of 38 EPC states |
| Maintenance fees | Single timeline | Paid per-country, different schedules per state |
| Search source | Google Patents covers EP — no change | Same — no change |
| Claim text source | Google Patents XHR works for EP — no change | Same — no change |

### EPO OPS specifics
- Endpoint: `https://ops.epo.org/3.2/rest-services/`
- Auth: OAuth2 client credentials flow
- Free tier: 4 GB/week quota — generous for our use case
- XML response — need a parser dependency or build a small one
- Rate limits per second + per minute; need throttling

### Phase 5.5 work breakdown
1. EPO OPS account + key provisioning (manual one-time)
2. `epoOps.ts` client module with OAuth + XML parsing
3. Stage 3 extension: jurisdiction-aware status checks
4. Per-country validation lookup (which EPC states is this patent active in?)
5. UI changes: per-country breakdown in patent drill-in view
6. Disclaimer updates: "EU coverage limited to EPC states with active validation"

### Decision: ship US to GA first, then EU
- Validates methodology + UI with a single jurisdiction before doubling integration surface
- Phase 5.5 sits between closed beta (Phase 5) and general availability (Phase 6)
- Override: if business reasons demand EU at launch, we fold this into Phase 1 — adds ~30% backend scope and pushes Phase 0 timing back

---

## 10. Quality + cost instrumentation

Every job records:
- **Per-stage token counts** (Gemini SDK provides these natively)
- **Per-stage wall-clock time**
- **Total cost estimate** (computed from current Gemini Flash/Pro prices, stored as snapshot — prices change)
- **Verification outcomes** (high-risk cells: % verified, % paraphrase-confirmed, % failed → downgraded)
- **Job completion telemetry** — start, complete, cancelled, error stage

Firebase Analytics events:
- `fto_run_started`, `fto_run_completed`, `fto_run_cancelled`
- `fto_pdf_exported`
- `fto_patent_drilled_in`
- `fto_feedback_submitted` (we add a "this risk hit is wrong/right" button on each cell)

**Why this matters for pricing:** Pricing is set in Phase 6 from accumulated Phase 5 data:
- Median + 90th-percentile cost-per-run
- User-reported accuracy (negative feedback ratio per cell)
- Time-to-completion distribution
- Examiner-validated quality rating

The in-extension `WorkflowsTab.tsx:32` "~100 credits" placeholder is just a placeholder. Real number TBD.

---

## 11. Legal / liability surface

**Non-negotiable mandates for day-one launch:**

1. **Disclaimer banner on every screen and every export.** Working draft:
   > *"This report is automated screening output, not legal advice. Active-patent status and infringement risk assessments are best-effort and may be incomplete or incorrect. Obtain a formal Freedom-to-Operate opinion from a registered patent attorney before commercializing."*
   Pre-launch: have an attorney review the exact wording.
2. **Acknowledgment checkbox** before Stage 1 starts. Logs `disclaimerVersion` per job for audit.
3. **"Uncertain" patents flagged by name** in the report — never silently included.
4. **Verification stage outcomes shown transparently** — downgrade reasons surfaced in UI, not hidden.
5. **Jurisdiction stated prominently** on every screen, every page of PDF.
6. **PDF watermarked** with disclaimer on every page.
7. **EU per-country caveat** (Phase 5.5+): "EU coverage limited to states with active validation — single-country gaps possible."

---

## 12. Build phases

### Phase 0 — Methodology validation (CLI, no UI)
Build a CLI script that runs the full 6-stage pipeline on 3–5 real products. Michael reviews each output against his examiner training. Iterate prompts until output passes a "would I trust this as a pre-screen?" bar.

**Acceptance:** All 3–5 test reports pass Michael's quality bar. Methodology fixed before any UI work begins.

### Phase 1 — Backend pipeline
- All 6 stages working end-to-end behind `/fto-start`
- Firestore job-doc writes throughout
- Cost instrumentation captured per stage
- Tested via direct API calls + Firestore console inspection
- No UI

**Acceptance:** Three test products produce structured reports identical in shape to what UI will eventually render. Cost-per-run logged and within expected range.

### Phase 2 — Full-tab UI shell
- `fto.html` route + routing wired
- Input form (State 1)
- Progress view (State 2) with Firestore subscription
- Results dashboard skeleton (State 3) — basic table, no fancy matrix yet
- Disclaimer surfaces on every screen

**Acceptance:** Non-developer can submit a product description, watch live progress, see structured results.

### Phase 3 — Results polish + drill-in
- Risk matrix visualization with color coding + verification badges
- Per-patent drill-in panel with claim text + cited element + verification status
- Sorting, filtering, search within results
- "Feedback on this cell" buttons (telemetry source)

### Phase 4 — Export + verification hardening
- PDF export with disclaimer watermarking on every page
- CSV export
- Stage 6 verification stage hardened (literal match → Gemini fallback → downgrade)
- Failure recovery (resume from failed stage)

### Phase 5 — Closed beta (US only)
- Soft-enable for 5–10 hand-picked users
- **Free during beta** — no credit charge yet
- Feedback button on every report cell
- Weekly methodology iteration based on accuracy reports
- Bug bounty for false-active hits (lawsuit scenario)

**Exit criteria:** Beta users complete ≥3 runs each. Average accuracy rating ≥4/5. Per-run cost stable within expected band. Methodology no longer changing weekly.

### Phase 5.5 — EU expansion
- EPO OPS integration (`epoOps.ts` + OAuth + XML parser)
- Jurisdiction-aware Stage 3 (US + EU branches)
- Per-country validation lookup
- UI updates: jurisdiction selector enabled, per-country breakdown in drill-in
- Re-run Phase 5 acceptance criteria for EU runs

### Phase 6 — Pricing decision + general availability
- Pricing set from Phase 5 + 5.5 accumulated data
- In-extension card enabled, credit cost wired into card UI
- Billing logic added (credit decrement on Stage 5 completion, not Stage 1 — only charge for successful runs)
- Marketing copy + landing-page section drafted
- Public launch

---

## 13. Open questions

All four resolved 2026-05-13 — see locked decisions in §1.

~~1. Synthesis model — Flash or Pro?~~ → **Flash**
~~2. Stage 2 search depth~~ → **Top-30/feature, tune in Phase 0**
~~3. Cache reuse across users~~ → **Shared with existing `dossierCache` (24h TTL, bidirectional with dossier feature)**
~~4. Background email notifications~~ → **No email; modal subscribes to Firestore job doc, survives close-and-reopen**

Newly surfaced (Phase 4+ consideration):
- **Cloud Function runtime ceiling.** 1st-gen cap is 9 minutes. Worst-case FTO run estimate is ~15 minutes. Phase 1 mitigation: aggressive parallelization in Stage 2 + Stage 4, plus the 150-candidate cap in Stage 2. If Phase 1 measurements show runs sustainably under 9 min → stay on 1st-gen. If runs frequently exceed → migrate FTO endpoints to 2nd-gen (60-min timeout, separate deploy unit). Don't pre-emptively migrate.

---

## 14. Cross-references

- `ROADMAP.md` Phase 2.7 — FTO is item 2 in the post-2026-05-12 priority order
- `AGENT_SDK.md §3` — original FTO concept + pricing math (now superseded by Phase 6 deferred-pricing approach)
- `research/patent-firm-features.md` Part 5, W3 — agent inventory
- `memory/progress_patent_dossier.md` — current build state + dependencies on dossier infra
- `functions/src/patentDossier.ts` — `fetchPatentHtml`, claim parsing, retry pattern (all reused)
- `functions/src/usptoOdp.ts` — US active-status (reused for Stage 3 US branch)
- `extension-src/src/components/tabs/WorkflowsTab.tsx:28-34` — entry-point card (already scaffolded)
