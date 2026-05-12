# Patent Firm Feature Research

> Beyond patent search: features patent firms / IP professionals need day-to-day, filtered by what Google Patents already provides vs. what requires other data sources, ranked by frequency of use.
>
> **This document is the canonical feature inventory.** Per-patent features are in Parts 1–4. Workflow-agent deliverables (Prior Art Hunter, Claim Analyzer, FTO, Landscape, etc.) are in Part 5. Strategy, pricing math, and validation gating live in [AGENT_SDK.md](../AGENT_SDK.md) and [ROADMAP.md](../ROADMAP.md).

Date compiled: 2026-05-09 · last consolidated: 2026-05-11

---

## Part 1 — Full feature universe (raw brainstorm)

### Prosecution & drafting
- Patent family lookup (INPADOC + simple families, kind codes, priority chains)
- File wrapper / prosecution history retrieval (Office Actions, responses, IDS, amendments)
- Office Action analysis (auto-summarize 102/103 rejections, extract cited art, suggest arguments)
- IDS generation (format cited references into proper IDS forms)
- Claim drafting assistant (dependency check, antecedent basis, 112 clarity, scope laddering)
- Specification ↔ claim consistency (flag terms not supported, missing antecedents)

### Litigation / enforcement
- EOU / claim charting (already PatentEvidenceSearch sibling project)
- Invalidity search (claim-focused, often combined references for 103)
- Claim construction / Markman support (term usage across spec + prosecution + dictionaries)
- Damages support (sales data, royalty comparables, Georgia-Pacific factors)
- IPR / PGR prep (claim charts, secondary considerations evidence)

### Freedom-to-operate & landscape
- FTO analysis (live patents only, jurisdiction-bound)
- Patent landscape / white space (clustering, CPC/IPC mapping, competitor overlay)
- Citation network analysis (forward/backward graphs, key node ID)
- Competitor monitoring / alerts (new filings by assignee, examiner, classification)

### Portfolio management
- Annuity / maintenance fee tracking (deadlines per jurisdiction, surcharge windows)
- Assignment chain verification (recorded assignments, gaps, encumbrances)
- Patent valuation signals (citations, claim breadth, family size, litigation history)
- Inventor tracking (moves between assignees, prolific filers in a space)

### Due diligence / M&A
- Patent DD checklist (encumbrances, security interests, license obligations, standing)
- Title chain verification
- Lien / security interest check (UCC + USPTO assignment recordation)

### USPTO examiner intelligence
- Examiner stats (allowance rate, pendency, RCE rate, interview success)
- Art unit analysis
- Examiner interview prep

### International / PCT
- PCT national phase deadline tracker (30/31 month windows per country)
- Foreign filing license check
- Patent translation (especially CN/JP/KR/DE)
- Priority date calculator (Paris Convention, PCT, provisional cascades)

### Document extraction
- Figure extraction with reference numerals labeled
- Reference numeral table builder
- Claim tree visualization (independent → dependent hierarchy)

---

## Part 2 — Filtered by data availability

### ✅ Fully available in Google Patents (extension can leverage directly)
Google Patents exposes this data on the patent page itself or via its standard URLs.

| Feature | Where it lives on Google Patents |
|---|---|
| Patent family lookup | "Worldwide applications" section (simple family) |
| Citation network (forward/backward) | "Cited By" + "Citations" sections |
| Claim text extraction | Claims section, structured |
| Bibliographic data (inventors, assignees, dates) | Top of page |
| CPC / IPC classifications | Classification section |
| Concept tags | Auto-extracted by Google |
| Similar documents | "Similar Documents" sidebar |
| Description / spec text | Description section |
| Prior art finder seed | Built-in feature |
| Inventor / assignee browsing | Linked entity pages |

### ⚠️ Partially available (Google Patents has some, supplementation recommended)

| Feature | What Google Patents has | What's missing |
|---|---|---|
| Legal status | Granted/expired/pending status shown | No granular events (annuity paid, litigation, reexam) |
| Family legal status | Simple family list | No per-member status tracking |
| File wrapper access | Links out to USPTO Public PAIR | Doesn't render or parse the documents |
| Assignment info | Current assignee shown | No chain history or recordation dates |
| Claim construction support | Spec text searchable | No prosecution history correlation |

### ❌ Not in Google Patents — requires other APIs

| Feature | Required source |
|---|---|
| File wrapper documents | USPTO ODP API (free, JSON) / EPO Register |
| Office Action contents | USPTO ODP API |
| IDS submissions | USPTO ODP API |
| Examiner statistics | USPTO PatentsView, third-party (Juristat, PatentBots) |
| Art unit allowance rates | USPTO PatentsView |
| Maintenance fee deadlines | USPTO Maintenance Fee Storefront |
| Detailed assignment chain | USPTO Assignment Search API |
| Security interests / liens | USPTO Assignment Search + UCC databases |
| Litigation records | PACER, RPX, Docket Navigator, Lex Machina |
| IPR / PGR records | USPTO PTAB |
| Damages / royalty comparables | Proprietary (Lexis, RoyaltyStat, ktMINE) |
| Patent translation (high quality) | EPO Patent Translate, WIPO Translate |
| PCT national phase deadlines | WIPO + per-jurisdiction rules |
| Foreign filing license status | USPTO ODP (filing receipt) |
| Reference numeral extraction | OCR pipeline + custom parsing (figures are images) |
| Inventor employment tracking | LinkedIn / external |
| Examiner interview history | USPTO ODP (interview summaries) |

---

## Part 3 — Ranked by frequency of use

Patent firms = mix of prosecution shops, litigation boutiques, and full-service IP. Ranking reflects average across all firm types. **GP** = available in Google Patents (data tier).

### Tier 1 — Daily / weekly use across virtually every firm
| Rank | Feature | Data tier | Notes |
|---|---|---|---|
| 1 | **Patent family lookup** | ✅ GP | Foundational; checked on nearly every patent reviewed |
| 2 | **Citation network analysis** | ✅ GP | Used in prior art, invalidity, landscape, FTO |
| 3 | **File wrapper retrieval** | ❌ USPTO ODP | Daily during prosecution; high pain point today |
| 4 | **Office Action analysis** | ❌ USPTO ODP | Every prosecution case; heavy AI value |
| 5 | **Claim tree / dependency visualization** | ✅ GP | Constant reference during drafting + review |
| 6 | **Legal status check (live vs. expired)** | ⚠️ partial GP | Required before any FTO/licensing conversation |

### Tier 2 — Frequent (multiple times per week per active matter)
| Rank | Feature | Data tier | Notes |
|---|---|---|---|
| 7 | **FTO analysis** | ⚠️ GP + status | Common at product launch + DD |
| 8 | **Examiner statistics** | ❌ USPTO PatentsView | Strategy decisions; growing demand |
| 9 | **Claim charting (EOU / invalidity)** | ✅ GP (claim text) | Already covered by sibling product |
| 10 | **Patent landscape / competitor monitoring** | ✅ GP | Strategy, R&D, BD use cases |
| 11 | **Assignment / title verification** | ❌ USPTO Assignment | DD, transactions, standing |
| 12 | **IDS generation** | ❌ USPTO ODP | Every prosecution case; tedious manual work |

### Tier 3 — Regular but specialized
| Rank | Feature | Data tier | Notes |
|---|---|---|---|
| 13 | **Annuity / maintenance fee tracking** | ❌ USPTO MFS | Every active portfolio; mostly handled by docketing software today |
| 14 | **PCT national phase deadline tracking** | ❌ WIPO+ | International prosecution |
| 15 | **Specification ↔ claim consistency** | ✅ GP | Drafting + 112 defense |
| 16 | **Claim drafting assistant** | n/a (AI only) | Drafting workflow |
| 17 | **Reference numeral extraction** | ❌ OCR | Figure-heavy mech/EE cases |
| 18 | **Patent valuation signals** | ✅ GP (mostly) | Licensing, DD, M&A |

### Tier 4 — Periodic / situational
| Rank | Feature | Data tier | Notes |
|---|---|---|---|
| 19 | **IPR / PGR prep** | ❌ PTAB | Litigation only |
| 20 | **Markman / claim construction** | ⚠️ GP + ODP | Litigation only |
| 21 | **Patent translation** | ❌ EPO/WIPO | International |
| 22 | **Damages support** | ❌ proprietary | Litigation only |
| 23 | **Inventor tracking** | ❌ LinkedIn+ | BD, competitive intel |
| 24 | **Lien / security interest check** | ❌ Assignment+UCC | DD only |

---

## Part 4 — Strategic takeaways

### Highest-leverage features that Google Patents fully supports
*(lowest build cost, can ship fastest)*
1. Patent family lookup
2. Citation network / forward-backward analysis
3. Claim tree visualization
4. Patent landscape (CPC clustering, similar docs)

### Highest-value features that require USPTO ODP integration
*(USPTO ODP is free + JSON — already noted as a planned data source)*
1. File wrapper retrieval
2. Office Action analysis
3. IDS generation
4. Examiner interview history

### Features outside the natural extension scope
*(would require separate product, paid APIs, or proprietary data)*
- Damages / royalty comparables
- Litigation records (PACER)
- Annuity tracking (better served by docketing software)
- Maintenance fee deadlines (operational, not analytical)

### Recommended near-term build order
Given the existing stack (Gemini proxy + Google Patents scrape + Firebase + side panel):

1. **Patent family lookup** — pure GP, highest frequency, screenshot-worthy
2. **Citation network viewer** — pure GP, visualization win
3. **Claim tree visualizer** — pure GP, on-page utility
4. **Office Action analyzer** — USPTO ODP + Gemini, highest AI value
5. **File wrapper viewer** — USPTO ODP, foundational utility
6. **Examiner stats lookup** — USPTO PatentsView, strategy use case

The top 3 require zero new data integration. Items 4–6 unlock the USPTO ODP layer, which then enables most of Tier 2 and the prosecution-heavy Tier 3 features as marginal additions.

---

## Part 5 — Workflow agents (one-shot deliverables)

> *Different mental model from Parts 1–4.* Parts 1–4 enumerate **per-patent features** that live inside a session (open the Patent tab, look stuff up). Part 5 enumerates **one-shot deliverables** — a user provides input (an invention description, a product brief, a technology area), an agent produces a complete report. Higher unit price, longer execution time, asynchronous delivery. Surfaced through the Workflows side-panel tab.

Source: [AGENT_SDK.md](../AGENT_SDK.md) (deep flow descriptions, pricing math, starter code) and [ROADMAP.md](../ROADMAP.md) (phased rollout, validation gating).

### Priority workflow agents (defined)

| # | Agent | Input | Output | Price / run | Build priority |
|---|---|---|---|---|---|
| W1 | **Prior Art Hunter** | Invention description | Ranked top-10 prior art report with verified citations + relevance reasoning + gaps analysis | $29 (short) / $99 (detailed) | #1 — easiest, biggest market |
| W2 | **Claim Analyzer** | Patent application PDF or text | Claim-by-claim novelty analysis with closest reference + suggested rewording for weak claims | $49 per application | #2 — harder; PDF parsing + deep claim interp |
| W3 | **Freedom-to-Operate (FTO)** | Product description | Active-patent infringement risk matrix (high/med/low per identified feature) | $99–299 per product | #3 — heavy legal disclaimers required |
| W4 | **Technology Landscape** | Tech area (e.g. "solid-state batteries for wearables") | Executive landscape report: top assignees, filing trends, key inventors, white space | $199 per report | #4 — different buyer (VC/R&D vs. patent pros) |

**Build sequencing rationale (from ROADMAP.md):** Phase 1 is pricing/willingness-to-pay validation through cold LinkedIn outreach to patent professionals (see ROADMAP for the questions). Only proceed to building agents if 3 of 5 interviewees confirm intent to use at the proposed price. Build CLI first per agent; have a patent expert review output quality before any UI work.

### Future workflow agents (Phase 3 — speculative)

These appear in ROADMAP.md as candidates to revisit quarterly once a priority agent has shipped:

| Agent | One-line | Buyer | Notes |
|---|---|---|---|
| **Citation Network** agent | Given a patent, map all forward/backward citations and assess prior-art web | Patent pros, BD | Overlap with Patent Dossier § 5 — could be a deeper variant for invalidity work |
| **Examiner Rejection Responder** | Analyze an Office Action, draft response arguments | Prosecution attorneys, solo inventors | Highest-AI-value workflow; requires USPTO ODP for file-wrapper context |
| **Patent Family Tracker** | Monitor assignee filings, alert on new applications in watched areas | BD, competitive intel teams | Recurring subscription opportunity (vs. one-shot reports) |
| **Translation-Aware Search** | Boolean queries across Japanese/Chinese/Korean patent literature | International prosecution, FTO | EPO Patent Translate / WIPO Translate dependency |
| **Design Patent Visual Search** | Match design drawings via vision model | Design patent litigators, brand protection | Wait for vision-model quality to mature |
| **Plain-English Claim Explainer** | Render claim language for non-lawyers (consumer play) | Solo inventors, journalists, students | *Seeded in Patent Dossier § 8 AI Summary already* |

### Workflow tab vs. Patent tab — which surface for what

| Surface | Best for | Live time | Price per call |
|---|---|---|---|
| **Patent tab** (per-patent lookup) | "I have a patent number, tell me about it" | Seconds | 3 credits / dossier · 1 credit / AI summary |
| **Workflows tab** (deliverable) | "I have a brief, produce a report" | Minutes (with progress events) | $29–$299 per run (≥ 30 credits at current ratio) |

The Workflows tab will likely use asynchronous progress streaming (similar to Phase 2D's AI summary loading state, but spanning minutes). Each agent run becomes a row in the "Recent runs" list, clickable to re-open the deliverable.

---

## Part 6 — Build status

Master tracker for everything in this document. Update when a phase ships or is paused.

### Shipped — Patent Dossier (per-patent surface)

Cumulative work to land a complete per-patent investigation flow, side panel + full tab.

| Phase | Date | What shipped | Commit |
|---|---|---|---|
| 0 | 2026-05-09 | Side-panel tab consolidation; Patent + Workflows scaffold tabs | `e10b3e9` |
| 1 | 2026-05-10 | Dossier spec (`research/patent-dossier-spec.md`) + static HTML mockup | `a36ed22` |
| 2A | 2026-05-10 | `/patent-dossier` Cloud Function endpoint with all GP-scrape parsers + 24h cache | `21d66ca` |
| 2B | 2026-05-10 | Side-panel chips wired to live endpoint | `f8ee74f` |
| 2C | 2026-05-10 | `patent.html` full-tab route + 9-section React renderer | `1cff587` |
| 2D | 2026-05-11 | `/dossier-summary` Gemini-backed endpoint + § 1 AI Summary section, auto-load, bundled pricing | `5c9d6ef`, `b2c5151` |
| 2-polish | 2026-05-11 | Sticky brand header (logo + name), scroll-spy quick-nav, Chrome Web Store CTAs (header badge + footer URL), section IDs + smooth scroll | `9f5e9b4` |
| 2-polish | 2026-05-11 | Auto-detect patent number from active Google Patents tab | `dfab7f6` |
| 2-polish | 2026-05-11 | Family ID parser fix, large-family jurisdiction chips + 10-row cap with "Show all" toggle, claim Expand-all/Collapse-all, status enum verified on `Expired` | `de38eda` |
| 2-polish | 2026-05-11 | Better not-found error path (404 → friendly message instead of 502); side-panel error auto-dismisses after 6s | `de38eda` |
| 3A | 2026-05-12 | USPTO ODP file wrapper viewer — `/prosecution-history` endpoint, server-side PDF proxy `/odp-document` (PDFs need X-API-KEY), § 10 Prosecution section with category filter chips + auto-load + 7-day cache (schema-versioned) | pending commit |
| 3B | 2026-05-12 | Office Action analyzer — `/oa-analyze` endpoint, Gemini 2.5 Flash multimodal PDF input (no separate text extraction, handles scanned OAs via native OCR), inline-expand UI with summary / color-coded rejections (§102/103/112) / cited art / suggested arguments | pending commit |
| 3C | 2026-05-12 | OA analyzer quota model — first 5 fresh analyses per (user, application) are free; subsequent fresh analyses cost 1 credit each; ledger in `oaAnalysisQuota` collection; cache hits and re-analyses of OAs in the ledger always free; quota chip in section header | pending commit |
| 3D | 2026-05-12 | Examiner Stats § 9 — `/examiner-stats` endpoint pulling from USPTO ODP bibliographic + search endpoints (PatentsView migrated into ODP 2026-03-20). Surfaces examiner name, art unit, total applications, patented count, allowance rate, avg pendency. Auto-loads, free, 30-day cache per application. | pending commit |
| housekeeping | 2026-05-12 | Removed dead `functions/src/bigquery.ts` (no importers, used pre-removal `@google-cloud/bigquery`); added `feedback_no_bigquery.md` memory and purged BigQuery references from `MEMORY.md` | pending commit |
| 3E | 2026-05-12 | **IDS generator § 12** — client-side merge of backward citations + OA-cited art, dedupe by normalized patent number; four exporters (PDF filled SB/08 via jspdf-autotable, DOCX via `docx`, CSV, XML with internal IDS schema); lifted `oaAnalyses` Map up to `PatentDossierPage` so § 12 can read merged data; non-US patent banner + no-OAs-analyzed banner; free (bundled with dossier). **Closes Tier 1 ODP scope.** | pending commit |
| reliability | 2026-05-12 | Google Patents 429/5xx retry-with-backoff in `fetchPatentHtml`; new `rate_limited` error code → HTTP 429 instead of cryptic 502; client shows friendly "Google Patents is throttling us" message + Try Again button | pending commit |

**Dossier sections live in production:**

| § | Section | Source list | Notes |
|---|---|---|---|
| 1 | AI Summary | Part 5 future (seeded) | Auto-loads on dossier open; bundled with the 3-credit dossier purchase; 30-day cache |
| 2 | Abstract | adjacent | Verbatim from GP |
| 3 | Legal Status | Tier 1 #6 | Current jurisdiction only; per-member tracking awaits Phase 2 ODP |
| 4 | Family Map | Tier 1 #1 | Members + jurisdiction chips; current patent pinned; capped + toggle for big families |
| 5 | Claim Tree | Tier 1 #5 | Independents + dep tree, expand-all / collapse-all, verbatim text under `<details>` |
| 6 | Citation Network | Tier 1 #2 | Forward + backward, top 10 each |
| 7 | Classification | adjacent to Tier 1 | CPC leaf codes + descriptions + primary marker |
| 8 | Similar Patents | adjacent | GP's similar-documents list, filters out the patent itself |
| 9 | Examiner Stats | Tier 2 examiner intelligence | USPTO ODP bibliographic + search; auto-loads; free; 30-day cache; gracefully degrades for non-US / pre-2001 patents |
| 10 | Prosecution History | Tier 1 #3 (file wrapper) | USPTO ODP file wrapper docs with category filter + per-doc PDF proxy; per-OA "Analyze" button (see § 10A); 7-day cache; auto-loads for US post-2001 patents |
| 10A | OA Inline Analyzer | Tier 1 #4 | Click-to-expand on any Office Action row; Gemini 2.5 Flash multimodal PDF analysis; 5 free per application then 1 credit; 30-day per-doc cache |
| 11 | Export & Share | adjacent | Print to PDF + Google Patents link |
| 12 | Information Disclosure Statement (IDS) | Tier 1 #12 | Auto-formatted SB/08 from backward citations + OA-cited art; PDF/DOCX/CSV/XML exports; free (bundled with dossier); deterministic client-side reformat |

### Scaffolded but not wired

| Feature | Location | Notes |
|---|---|---|
| Workflows tab (4-card grid) | Side-panel `WorkflowsTab.tsx` | Cards visible, disabled, "Coming soon" badge |

### Defined but not started

- **Tier 1 ODP-dependent**: ✅ all shipped (file wrapper, OA analyzer, examiner stats, IDS generator)
- **Tier 2**: FTO analysis (as a side-panel tool) · claim charting · patent landscape · assignment / title verification
- **Tier 3**: annuity tracking · PCT national phase deadlines · spec↔claim consistency · claim drafting assistant · reference numeral extraction · patent valuation signals
- **Tier 4**: IPR/PGR prep · Markman support · patent translation · damages support · inventor tracking · lien check
- **Workflow agents W1–W4** (per [`ROADMAP.md`](../ROADMAP.md) Phase 2): Prior Art Hunter · Claim Analyzer · FTO Agent · Technology Landscape Agent
- **Phase 3 workflow agents** (per [`ROADMAP.md`](../ROADMAP.md) Phase 3): Citation Network agent · Examiner Rejection Responder · Patent Family Tracker · Translation-Aware Search · Design Patent Visual Search

### Gated on validation

Per [`ROADMAP.md`](../ROADMAP.md), the workflow agents (Part 5) are notionally gated on pricing validation interviews (5 cold LinkedIn outreaches at the proposed price points). Decision 2026-05-10: **proceed without validation gating** due to low user base — pricing-interview signal is too weak to be useful, so the team will build first and price-test live. Side-panel features (Parts 1–4) are not gated.

### Next up

**Priority order revised 2026-05-12** — W1 deferred to last after cost analysis (see `memory/research_w1_prior_art_hunter.md`: realistic cost $7–15/run vs. the AGENT_SDK $3.50 estimate). User wants safer features shipped first.

1. ✅ **IDS generator** — shipped 2026-05-12 (Phase 3E). Tier 1 ODP scope closed.
2. **Tier 2: claim charting or FTO** — claim charting is a natural extension of the OA Analyzer (we already extract rejections + cited art); FTO requires the live-patent + jurisdiction filter machinery. Both are Workflow-tab candidates.
3. **Patent landscape (Tier 2 #10)** — CPC clustering + competitor overlay. Probably belongs in the Workflows tab as the W4 deliverable; not a per-patent feature.
4. **Workflows tab — Prior Art Hunter agent (W1)** — DEFERRED to last. Flagship deliverable at $29–99 per run. Claude Agent SDK integration, MCP tool wrappers for Boolean gen + GP search, verification-required output. ~1 week. Pre-launch non-negotiables: prompt caching, per-user concurrent-run cap, daily org-wide spend ceiling, verification step, refund policy.

Pause-the-build polish (do anytime):
- `/prosecution-history` could include the current OA quota state so the `AI: X/5 free` chip shows immediately on dossier load (today it appears after the first analysis click)
- Surface `directionCategory` (INGOING/OUTGOING) on prosecution rows for at-a-glance examiner-vs-applicant distinction
- Family ID surfaced in the dossier UI metadata (currently parsed but not rendered)
- Side-panel error auto-dismiss extended to credit errors (currently only patent-fetch errors auto-dismiss)
- Family-tree visualization for large families (currently a flat table; would render better as a priority-chain tree)
- Citation graph viz for the Citation Network section
- Delete the one-off `functions/debug-odp.js` and `functions/debug-odp-examiner.js` scripts (left in place for future debugging; .env-aware, no hardcoded keys)
