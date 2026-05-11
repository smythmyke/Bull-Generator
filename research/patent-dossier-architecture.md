# Patent Dossier Architecture Research

> Design discussion for expanding beyond the side panel: a full-tab "Patent Dossier" surface that delivers report-grade outputs for Tier 1 patent features.

Date compiled: 2026-05-09
Related: [patent-firm-features.md](patent-firm-features.md), `sample-report.html` (existing report mockup)

---

## Motivation

The Tier 1 GP-native features (family lookup, citation network, claim tree, legal status) deliver real value individually, but the side panel's ~400px width can't render:

- Family trees with priority chains × jurisdictions
- Citation graphs with assignee clustering
- Wide claim charts with dependency lines
- Multi-jurisdiction status grids

A full Chrome tab gives the canvas needed for a dossier-grade deliverable, plus opens up shareability, PDF export, and SEO landing pages.

---

## The dual-surface model

### Side panel — consumption, in-context, fast
- User is *on* a Google Patents page; needs an answer in 2 seconds
- Width-constrained (~400px); no room for graphs or wide tables
- Best for: status badge, quick family list, claim count, "open full dossier" button
- Mental model: **"what am I looking at right now"**

### Full tab — production, dossier-grade, shareable
- User enters a patent number (or arrives via "open full dossier" from the side panel)
- Full-width canvas; can render trees, graphs, claim charts, status grids
- Can be printed, exported, shared as URL
- Best for: triage at start of a matter, deliverables, multi-data synthesis
- Mental model: **"give me everything on this patent"**

---

## Patent Dossier — proposed sections

A single route (`patent.html?number=US10123456`) producing a sectioned report. Skeleton mirrors `sample-report.html`.

| # | Section | Content |
|---|---|---|
| 1 | Header / metadata | Title, abstract, assignee, inventors, dates, status badge, jurisdictions |
| 2 | Legal status panel | Per-jurisdiction grid: granted/lapsed/expired/pending, key dates, next fee deadline |
| 3 | Family map | Visual tree (priority chain × jurisdictions), color-coded, expandable per member |
| 4 | Claim tree | Interactive collapsible hierarchy, independents highlighted, dependency depth |
| 5 | Citation network | 2-level graph (backward + forward), assignee clusters, hot nodes, date/assignee filters |
| 6 | Classification context | CPC/IPC codes with definitions, sibling classifications, neighborhood scale |
| 7 | Similar patents | Google's similar-doc list + custom scoring |
| 8 | AI summary | Gemini executive overview (plain-English, claim scope, prosecution highlights when ODP wired) |
| 9 | Export / share | PDF, copy-as-memo, persistent shareable URL |

One dossier covers all four Tier 1 features simultaneously — much higher perceived value than four separate side-panel widgets.

---

## Side panel ↔ full tab handoff

On any Google Patents page, the side panel header would show:

```
US 10,123,456
[Status: Active US, Lapsed EP] [Family: 7] [Claims: 24] [Cites: 142↓ 38↑]
[ Open full dossier → ]   [ Quick family → ]   [ Quick claim tree → ]
```

- Chips give 80% of the answer instantly
- "Open full dossier" → `chrome.tabs.create({ url: chrome.runtime.getURL('patent.html?number=...') })`
- "Quick family / claim tree" → expanded inline view in side panel for users who don't want to leave context

---

## Architecture notes

### Routing
- New HTML entry point `patent.html` bundled with the extension
- Opens in a normal Chrome tab via `chrome.tabs.create()` with `chrome.runtime.getURL()`
- Keeps everything inside the extension — no separate web app required to start

### State + sharing
- **Phase 1 (extension-only):** dossier renders client-side, no persistence, not shareable
- **Phase 2 (shareable URLs):** persist to Firestore, serve from public web route
  - Every dossier becomes a viral surface (partner shares link → client lands on branded report)
  - Each dossier URL is a potential SEO landing page

### Data fetching
- **Option A:** scrape the GP page in a hidden tab via the extension (current pattern)
- **Option B:** Cloud Function `/patent-dossier` hits Google Patents server-side, returns structured JSON
- Option B is cleaner for shareable links + future SEO landing pages
- Recommendation: build Option A for speed, refactor to Option B when adding sharing

### Cloud Function endpoint
- `/patent-dossier` takes a patent number, returns JSON blob covering all sections
- HTML page becomes a thin renderer
- Caches per patent number (most data is static; legal status refresh window ~24h)

---

## Credits model

Natural pricing ladder:
| Action | Cost | Tier |
|---|---|---|
| Side panel quick lookup | 0–1 credit | Free |
| Full dossier (one patent) | 3–5 credits | Free with cap, Pro unlimited |
| Multi-patent comparison | 10+ credits | Pro |
| Persistent shareable URL | — | Pro/Firm only |
| PDF export | — | Pro/Firm only |

This naturally creates upgrade pressure without nagging — free users hit a real wall on the third action that matters.

---

## Business unlocks

- **Chrome Web Store screenshots** — full dossier is dramatically more compelling than search-string output
- **SEO landing pages** — shared dossier URLs ("US 10,123,456 patent overview") can rank for long-tail patent number searches
- **Upgrade hook** — free users get N dossiers/month, paid get unlimited + sharing + PDF
- **Standalone product story** — users who don't need search may still pay for dossiers
- **Viral surface** — every share is branded distribution

---

## Recommended next steps

Two reasonable starting points:

**(a) Spec the dossier first.** Write a markdown spec with section-by-section data fields, then build a static HTML mockup (in the spirit of sample-report.html) populated with one real patent. Decide if the format works *before* writing data fetchers. *Lower risk; less rework.*

**(b) Build family-lookup end-to-end.** Vertical slice: side panel chip + corresponding dossier section. Prove the architecture before scaling. *Faster shipped feature; risk of refactor when the format firms up.*

**Recommendation:** start with (a). The existing `sample-report.html` shows the user already thinks in report formats — locking the format upfront saves rework. Once the spec is solid, vertical slices become straightforward.

---

## Open questions

- Should the dossier be extension-only initially, or built on a public web route from day one?
- Does the dossier require user auth (forces signup, captures email) or open access (more shares, more reach)?
- For shareable links: rate-limit per IP? require sign-in to share? watermark with referring user?
- PDF export: client-side (print stylesheet) or server-side (Puppeteer)?
- How does this relate to the sibling `PatentEvidenceSearch` product — share the dossier surface or keep separate?
