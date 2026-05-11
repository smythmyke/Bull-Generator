# Patent Firm Feature Research

> Beyond patent search: features patent firms / IP professionals need day-to-day, filtered by what Google Patents already provides vs. what requires other data sources, ranked by frequency of use.

Date compiled: 2026-05-09

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
