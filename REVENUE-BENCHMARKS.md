# Bull-Generator — Profit Potential, API Candidacy, Distribution & Liability Audit

**Date:** 2026-05-19
**Status:** Research only — no implementation changes.
**Method:** Five parallel research agents covering (1) patent/legaltech API pricing, (2) patent professional distribution channels, (3) indie legaltech/patent SaaS revenue + audience sizing, (4) AI agent/MCP/GPT for patent vertical, (5) data legality + UPL liability audit.
**Related:** [README.md](./README.md) · [ROADMAP.md](./ROADMAP.md) · [AGENT_SDK.md](./AGENT_SDK.md) · [MARKETING-STRATEGY.md](./MARKETING-STRATEGY.md) · [research/pricing-audit-2026-05-12.md](./research/pricing-audit-2026-05-12.md) · [research/patent-firm-features.md](./research/patent-firm-features.md)

---

## Headline

**Bull-Generator is viable as a small indie business (~$2k–$5k MRR / $24k–$60k ARR at month 24), with the highest acqui-hire probability of your four projects but the lowest indie revenue ceiling.** Two RED-tier legal issues must be resolved before any public API launch — Google Patents scraping (SerpAPI lawsuit precedent) and W3 Freedom-to-Operate UPL exposure. After those fixes, the API revenue line is secondary; the primary growth lever is **distribution to solo practitioners + pro se inventors** (NAPP + USPTO Pro Bono/PTRC + Strafford CLE), not API tier expansion.

The W1–W4 agent suite ($29–$299/run) sits cleanly inside the legal-AI per-task pricing band (CoCounsel's $75/task is the dominant benchmark) — but no solo-founder Chrome-extension patent SaaS has any public precedent of hitting $50k MRR in this vertical.

---

## Locked-in decisions (2026-05-19)

1. **Sustain + maintain mode.** Fix legal landmines, ship planned roadmap technically, but **no growth investment** in distribution. Accept the product reaches its natural ceiling (~$2k–$5k MRR) without aggressive spend. If Patently-O coverage or organic CLE invitations materialize, take them; don't pay for them.
2. **W3 Freedom-to-Operate restructured as attorney-only** with verified bar-number gating. Output framed as "Draft Analysis — For Attorney Review." No end-user infringement verdicts. Drops some addressable market but ships safely.
3. **Google Patents migration in parallel with W1–W4 build.** Migrate `/patent-dossier` to USPTO ODP + EPO OPS + WIPO Patentscope while building agents. Migration is mandatory pre-launch security work given the SerpAPI lawsuit precedent.

This is the **acqui-hire setup path** — build for the IP-services-firm acquisition pattern (Octimine→Dennemeyer, Cipher→LexisNexis, Henchman→LexisNexis) rather than venture-scale indie SaaS.

---

## 1. ToS / UPL liability audit — the critical findings

### Two RED-tier issues that gate API launch

**RED #1 — Google Patents XHR scraping is existentially risky.**
Bull-Generator's canonical data path (`patents.google.com/xhr/result`, per `ROADMAP.md`) matches exactly what Google v. SerpAPI (N.D. Cal., Dec 19 2025) targets. SerpAPI MTD filed Feb 20, 2026; no dismissal yet. Even if SerpAPI prevails on MTD, Google's enforcement appetite is demonstrated. **Migration to USPTO ODP + EPO OPS + WIPO Patentscope covers ~98% of useful data and removes the existential exposure.**

**RED #2 — W3 FTO Agent to non-attorneys = UPL exposure.**
Patent agents (USPTO-registered, non-attorney) explicitly cannot opine on infringement per state UPL rules; only licensed attorneys may give FTO opinions. An AI agent generating "infringement risk matrix" for non-attorney founders/PMs triggers UPL exposure in CA, NY, TX, and most states. The CA Bar's August 2025 directive on "agentic AI tools that autonomously perform tasks without human prompting" is the paradigm case the next set of rules will target. **Restructured as attorney-only with bar-number gating, W3 ships safely.**

### Full risk audit summary

| Verdict | Items |
|---|---|
| 🟢 **Green** (ship now) | USPTO ODP redistribution, US patent text (public domain), US patent drawings, examiner stats, FAR/eCFR-equivalent data, descriptive analytics (W4 Landscape), Gemini output ownership (with Vertex AI routing for indemnification), Boolean query generator |
| 🟡 **Yellow** (ship with controls) | EPO OPS (€2,800/yr commercial license required), WIPO Patentscope (derivative-value license + attribution), customer-uploaded drafts (limited license-back ToS), W2 claim rewording (practitioner-gating), pre-filing invention descriptions (confidentiality + retention controls), EU AI Act (limited-risk transparency), GDPR + SCCs, hallucination liability (E&O insurance + verify gate) |
| 🔴 **Red** (don't ship as-is) | Google Patents XHR scraping, W3 FTO Agent to non-attorneys, hallucinated citations without verify gate |

### Three highest-priority risks ranked

1. **Google Patents scraping (existential, immediate)** — rip out before public API launch. ODP + EPO OPS + Patentscope substitutes available.
2. **W3 FTO UPL exposure (product-defining)** — restructure to attorney-gated tool. Per locked-in decision: bar-number verification + "Draft Analysis" framing + no end-user verdicts.
3. **AI hallucination liability (slow-bleed)** — Mata v. Avianca precedent. Mitigations: (a) route all Gemini calls through Vertex AI for IP indemnification, (b) tech E&O with AI rider $3k–$10k/yr (Corgi or Embroker), (c) ToS liability cap at 12 months' fees + downstream developer indemnification, (d) mandatory hallucination warning + acknowledgement on every W1 output, (e) audit logs.

### Comparison to siblings

- **vs. GovToolsPro CMMC/DFARS overlay:** Bull-Generator is **materially worse**. CMMC failures are bounded contractual breaches; patent UPL + malpractice flow-through is open-ended tort exposure with personal-attorney sanctions in the chain.
- **vs. JackpotKeywords Google Ads ToS:** **Materially worse**. Google Ads violations result in account termination; SerpAPI-precedent + UPL exposure put Bull-Generator in a higher-stakes bucket.

---

## 2. Per-shape unit economics & verdicts

### Raw API endpoints

| Endpoint | Cost basis | Defensible price | ToS verdict | Verdict |
|---|---|---|---|---|
| `/patent-dossier` (US patents, post-migration) | ~$0.10–$0.30 | $0.50–$2.00/call or $99–$499/mo | 🟢 GREEN after ODP migration | Ship. Current 3-credit price is **3–5× too cheap** for external developer API. |
| `/oa-analyze` | ~$0.20 (Gemini multimodal PDF) | $3–$10/call | 🟡 YELLOW (Vertex AI routing) | Ship. Closest comp: Abigail $49/OA-response DOCX (50–100× markup on AI cost). |
| `/claim-chart` | ~$0.30 (Gemini reasoning) | $5–$25/chart | 🟡 YELLOW | Ship. Higher-value than `/oa-analyze` — Patlytics/Solve built companies on this. |
| `/examiner-stats` | ~$0 (ODP free) | $0.10–$0.50/call | 🟢 GREEN | Loss-leader. Drive funnel to higher-value endpoints. |
| `/prosecution-history`, `/odp-document` | ~$0 (ODP free) | $0.10–$0.30/call | 🟢 GREEN | Loss-leader. |
| Boolean query generator | ~$0.005 | $0.05–$0.20/call or freemium hook | 🟢 GREEN | Keep as the original freemium magnet. |

### W1–W4 Agent Suite

CoCounsel's $75/task is the dominant per-task benchmark in legal AI. Bull-Generator's planned pricing sits inside this band correctly.

| Agent | Planned | Defensible | ToS | Verdict |
|---|---|---|---|---|
| **W1 Prior Art Hunter** | $29–$99/run | $49 entry / $99 standard / $199 enhanced | 🔴 hallucination risk; requires mandatory human-verify gate + audit logs + E&O insurance | **Ship with verify gate.** Real revenue line. |
| **W2 Claim Analyzer** | $49/application | $49–$99 (underpriced vs. firm rates of several thousand) | 🟡 UPL; gate to USPTO Reg. No. | Ship to registered practitioners only. |
| **W3 Freedom-to-Operate** | $99–$299/product | $299–$599 if shippable | 🔴 UPL exposure | **Restructured as attorney-only with bar-number gating** (per locked-in decision). Output framed as "Draft Analysis — For Attorney Review." |
| **W4 Technology Landscape** | $199/report | $199–$399 | 🟢 GREEN (descriptive analytics) | Ship. Easiest greenlight. |

### Pricing correction vs. existing live tiers

Current pricing ($9 Searcher / $19 Pro / $39 Firm) is correct for the consumer Chrome extension. **For external developer API consumption, the Dossier endpoint is 3–5× too cheap** — recommend a separate API tier structure:

- Free 10 req/day (no AI endpoints)
- Lookup $29/mo (raw endpoints, no AI)
- Analyst $99/mo (adds AI-analyzed endpoints with 200 AI calls)
- Intelligence $299–$499/mo (adds W1/W2/W4 agent quota + Vertex AI indemnification)
- Enterprise $2k–$5k/mo (unlimited + SLA + attorney-tier W3 access)

Per the locked-in "sustain + maintain" decision: this pricing structure is recommended but not the priority. Focus on shipping W1–W4 with the migration before refining API tiers.

---

## 3. Audience — smallest TAM of your four projects

| Project | Audience | Notes |
|---|---|---|
| MarkItUp | 10s of millions of marketers | Massive |
| JackpotKeywords (Etsy) | ~1M Etsy sellers | Niche but large |
| GovToolsPro | 80k–150k federal contractors | Niche B2B |
| **Bull-Generator** | **40k–70k English-language patent professionals worldwide** | **Smallest TAM by far** |

### Hard numbers (verified)

| Audience | Count |
|---|---|
| USPTO OED registered patent attorneys/agents | ~50,000 (~36k–40k active practicing) |
| US patent attorneys only (subset) | ~26k–30k actively practicing |
| UK CIPA practising | 2,700 |
| European Patent Attorneys (epi) | ~14,400 across 39 EPC states |
| Japan Benrishi (JPAA) | ~11,600 |
| Global patent attorneys/agents (rough) | ~110k–130k worldwide; English-language addressable subset ~60k–80k |
| AIPLA membership | ~8,000 (63% private practice, 33% corporate) |
| IPO (corporate IP departments) | 125+ companies across 30 countries |
| AUTM (tech transfer) | 3,200 across 800+ institutions |
| Patent search firms | ~5k–10k specialist searchers globally |
| USPTO patent filings FY24 | ~602,000 (24% small/micro entity, 76% large) |
| Pro se filings | Small share, 76% abandonment rate |

### Implication for revenue ceiling

$50k MRR requires either:
- **(a)** 3,300 users at $15 ARPU (~5–8% global penetration) — no indie patent tool has ever hit this without an enterprise sales team
- **(b)** 170 users at $300 ARPU (~0.3% penetration) — requires firm/team pricing and procurement-grade sales motion

Patlytics took $65M VC to achieve path (b). For solo bootstrapped, **realistic ceiling without pricing/positioning overhaul: $5k–$15k MRR (~$60k–$180k ARR)**.

---

## 4. Distribution — where real growth WOULD come from (deferred per locked-in decision)

**AI adoption in IP practice jumped 57% → 85% (2023–2025)** per AIPLA-cited data. The window is open. Per the locked-in "sustain + maintain" decision, the following channels are documented but **deferred from active investment**:

| Channel | Cost | 12-mo lift | Time to impact |
|---|---|---|---|
| NAPP membership + sponsored webinar + listserv | $1k–$3k | 150–300 paid users | 60–90 days |
| USPTO Pro Bono + PTRC free-tier play | ~$0 cash, ~40hr founder time | 200–500 users + PR halo | 90–180 days |
| Strafford CLE speaker slot + IPWatchdog co-branded webinar | $5k–$10k | 100–250 paid users | 120–180 days |
| **Combined (if activated)** | **$6k–$15k cash** | **450–1,050 users** (~200–300 paid) | 6–12 months |

**Critical context:** DeepIP ($40M raised, 400+ IP law firms) is eating the AmLaw 100 high-end. Bull-Generator's differentiated lane is the **under-served downmarket** (solo practitioners + pro se inventors) that DeepIP can't profitably serve.

**Skip even if activated:** AIPLA booths (weak ROI), Salesforce-style enterprise integrations (Bull-Generator too small for Anaqua/Clarivate partner programs), Product Hunt (wrong audience), generic LinkedIn ads.

**If the channel investment is revisited:** highest-leverage is the **USPTO Pro Bono + PTRC free-tier play** — near-zero cash cost, ~40hr founder time, 200–500 users, PR halo, Trojan-horse path into firms when pro se inventors hire attorneys.

---

## 5. MCP / agent distribution — whitespace already closed

The patent MCP space is already populated:

| Server | Status | Notes |
|---|---|---|
| **riemannzeta/patent_mcp_server** | Free, open-source, on PyPI | 52 tools across USPTO endpoints; updated through 2026 for PatentsView shutdown |
| **patent.dev Patent Connector** | Free open beta | EPO OPS + USPTO ODP + DPMA; closest "commercial-feeling" indie MCP |
| **john-walkoe USPTO PFW MCP** | Free | Token-saving file wrapper context reduction |
| **KunihiroS Google Patents MCP** | Free wrapper | User pays SerpApi upstream |
| **PatSnap Eureka MCP** | Commercial | Only enterprise-grade patent MCP shipped; well-positioned incumbent |
| **6+ Apify patent actors** | $8.99/mo or pay-per-event | Google Patents Scraper, USPTO Patent & Trademark Data, "Google Patents API for AI Agents" (MCP-compatible) |

**No category whitespace for Bull-Generator MCP.** Realistic 12-month installs of a free Bull-Generator MCP: **150–600 installs, 2–5% paid conversion = $340–$11.7k ARR**. Brand/SEO play only, not revenue line.

**The real API revenue is W1–W4 agents priced per-run, sold direct to pro se inventors and solo patent attorneys** — not via MCP distribution. Bull-Generator's per-run model has no direct comparable in patent vertical (Harvey/DeepIP/Solve all per-seat enterprise).

| Agent (year 1, direct sales) | Worst | Likely | Best |
|---|---|---|---|
| W1 Prior Art Hunter | $1k | $7k | $25k |
| W2 Claim Analyzer | $735 | $4.9k | $17k |
| W3 FTO (attorney-only) | $750 | $6k | $30k |
| W4 Tech Landscape | $600 | $5k | $20k |
| **Total agents** | **~$3k** | **~$23k** | **~$92k** |
| MCP/GPT/n8n combined | $340 | $2.1k | $11.7k |
| **Combined Y1 incremental** | **~$3.3k** | **~$25k** | **~$104k** |

---

## 6. Indie revenue comparables

| Product | Funding | ARR | Outcome |
|---|---|---|---|
| **Patlytics** | $65M total in <2.5 years | ~$5–10M est. (20× growth) | Enterprise GTM, AmLaw 100, VC scale |
| **DeepIP** | $40M total (Series B 3/2026) | Not public, "10× revenue 18mo" | Enterprise AmLaw |
| **Spellbook** | $50M Series B (10/2025) + $40M debt | ~$30M+ est. | "On pace to triple in 2025" |
| **Solve Intelligence (YC)** | $40M Series B (12/2025) | Not public | ~$9,300/user/year list (enterprise) |
| **Casetext** | Acquired by Thomson Reuters 8/2023 | ~$30–40M est. at exit | **$650M acquisition** |
| **Henchman** | $10.4M total | "750% revenue growth pre-exit" | **Acquired by LexisNexis 6/2024** |
| **XLPAT (India)** | Bootstrapped | **~$325k revenue after 13 years** | Indie indie ceiling |
| **PowerPatent** | Bootstrapped | No public ARR after 15 years | Sub-scale |
| **Octimine** | Munich indie | Not public at exit | **Acquired by Dennemeyer 11/2018** |
| **Cipher (Aistemos)** | £3M raise | Not public | **Acquired by LexisNexis 2023** |
| **Patent Plus (Chrome ext)** | Bootstrapped indie | ~$0 MRR signal | 845 users — closest direct comparable |

### Decay/durability

- Enterprise B2B SaaS gold standard: 5–7% annual churn (93–95% retention)
- **AI-native products (ChartMogul 2025): median GRR 40%, NRR 48%** — "AI churn wave" is real
- Vertical-legal tools embedded in firm workflow (Westlaw, PatentSight, Lex Machina, Derwent): retention >95% once on AmLaw firm IT bills
- **Bull-Generator's likely position:** at $9–$39/mo with individual-seat purchase, no SSO, no firm procurement, behaves like AI-wrapper B2C tool. Expect monthly churn 8–15% = annual GRR 30–50% in base case.

### Pattern

**Two paths exist:** venture-backed enterprise GTM ($30M+ raises, $5–30M ARR) or modest indie → acqui-hire to IP services firm (Octimine/Cipher/Henchman pattern). **No public example of solo-founder Chrome extension hitting $50k MRR in patent vertical.**

The acqui-hire path is the most realistic outcome for Bull-Generator at scale. IP services firms (LexisNexis, Clarivate, Dennemeyer, Anaqua, Wolters Kluwer) buy modest indie tools at single-digit-million valuations to bolt features into their suites.

---

## 7. Probability bands

| Target | Month 12 | Month 24 |
|---|---|---|
| $2k MRR (~50–200 paying users) | **25–35%** | 45–55% |
| $5k MRR | 8–12% | 20–28% |
| $15k MRR (~750 users) | <3% | 6–10% |
| $50k MRR | <0.5% | 2–4% |

**Realistic 24-month outcome:** **$2k–$5k MRR side-business ($24k–$60k ARR)**, with **20–30% probability of small acqui-hire exit** to IP services firm in years 3–5.

"Best-case-everything-works" scenario lands at $100k ARR. Above that requires pricing/positioning overhaul to enterprise seats — fundamentally different business than current Chrome extension.

---

## 8. Comparison across all four projects

| Dimension | MarkItUp | JackpotKeywords (Etsy) | GovToolsPro | **Bull-Generator** |
|---|---|---|---|---|
| Audience size | 10s of millions | ~1M | 80k–150k | **40k–70k** |
| ACV potential | $5–$30/mo | $5–$30/mo | $50–$500/mo, $1k–$50k/yr enterprise | **$9–$39/mo + $29–$299/run agents** |
| Current traction | Pre-launch scaffold | Pre-launch MVP | Mature, paying users | **36 users (18 months live)** |
| ToS risk | None | RED on Shape A (Google Ads) | Yellow SAM, Red CUI | **RED on Google Patents scraping + W3 FTO UPL** |
| API competition | Moderate | Heavy | Direct comparable at $19/mo | Mid-pack (5+ patent MCPs exist) |
| MCP whitespace | None | Yes (AEO first-mover) | Closed Feb 2026 | **Closed first** (5+ patent MCPs) |
| Distribution wedge | None | Etsy founder credibility | Mature product + paying users | **Pro se + solo practitioner downmarket** |
| 24-mo ARR base case | $50k–$100k | $24k–$96k / $60k–$300k (Etsy) | $1M–$3M | **$24k–$60k** |
| 24-mo ARR stretch | $100k–$300k | $300k+ | $3M–$5M | **$120k** |
| Probability of $5k MRR @ M24 | 35–50% | 50–60% | 85–90% | **20–28%** |
| Most likely exit path | Indie sustained | Indie sustained | Indie sustained | **Acqui-hire to IP services firm** |

**Plain English:** Bull-Generator has the smallest TAM, the highest legal complexity, the most mature product, and the lowest probability of becoming a meaningful indie business — but the highest probability of an acqui-hire exit. It's the **outlier in the portfolio shape**.

---

## 9. Recommended sequencing under locked-in "sustain + maintain" mode

### Months 1–3 (legal cleanup + migration)
- **Migrate Google Patents → USPTO ODP + EPO OPS + Patentscope.** Mandatory. ~2–4 weeks effort.
- **Switch Gemini routing to Vertex AI** for IP indemnification on AI outputs.
- **Tech E&O insurance** with AI rider ($1M/$2M, $3–$10k/yr via Corgi or Embroker).
- **Update ToS:** liability cap (12 months' fees), downstream developer indemnification, no-training warranty on customer uploads, hallucination acknowledgement.

### Months 4–9 (ship the planned roadmap)
- **W1 Prior Art Hunter** with mandatory human-verify gate + audit logs. Restructure for solo practitioners + pro se inventors (the natural buyer per the existing 36-user signal).
- **W2 Claim Analyzer** gated to verified USPTO Reg. No.
- **W4 Technology Landscape** as the easy greenlight launch.
- **W3 FTO** as attorney-only with bar-number gating. Output framed as "Draft Analysis — For Attorney Review." (Lower priority — ship last.)

### Months 10–24 (passive growth + acqui-hire setup)
- Ship a free Bull-Generator MCP server as brand/SEO play (1–2 weeks effort, ~$0–$5k ARR).
- Maintain product. Don't invest in NAPP/CLE/USPTO distribution unless organic signals appear.
- Track product depth as the moat: prosecution + IDS + claim chart + examiner intelligence. These are the features IP services firms buy in acqui-hires.
- If month-12 traction signals support it, revisit the "modest indie business" investment path (NAPP + USPTO Pro Bono + Strafford CLE).

---

## 10. Bottom line

Under the locked-in "sustain + maintain" decision, Bull-Generator is **a $24k–$60k ARR side-business at month 24 with ~20–30% probability of a $1M–$5M acqui-hire exit to an IP services firm in years 3–5**.

This is not the venture-scale outcome of MarkItUp's stretch case or GovToolsPro's base case. It is a **realistic, defensible side-project** that protects existing 36-user revenue, ships the planned roadmap technically, fixes mandatory legal exposure, and positions for an acqui-hire if downstream traction materializes — while preserving capacity for the higher-leverage projects (GovToolsPro as anchor, JackpotKeywords + MarkItUp as growth bets) in the rest of the portfolio.

The biggest single risk: **ignoring the Google Patents migration**. Everything else can wait or be scaled down. That one is mandatory.

---

## Sources

### API pricing
- [Harvey AI revenue / valuation — Sacra](https://sacra.com/c/harvey/) · [Harvey $11B raise — CNBC](https://www.cnbc.com/2026/03/25/legal-ai-startup-harvey-raises-200-million-at-11-billion-valuation.html)
- [Hebbia pricing](https://www.eesel.ai/blog/hebbia-ai-pricing) · [Hebbia vs Harvey](https://spellbook.com/briefs/hebbia-vs-harvey)
- [CoCounsel Pricing 2026](https://costbench.com/software/ai-legal-tools/cocounsel/) · [Spellbook Pricing](https://www.aivortex.io/legal/compare/spellbook-pricing-2026/)
- [PatSnap Eureka Pricing](https://eureka.patsnap.com/pricing) · [Clarivate Developer Portal](https://developer.clarivate.com/apis)
- [IFI CLAIMS Direct](https://www.ificlaims.com/platform/claims-direct/) · [Patentcloud Bundle](https://www.inquartik.com/pricing/bundle/)
- [USPTO ODP Rate Limits](https://data.uspto.gov/apis/api-rate-limits) · [PatentsView transition to ODP](https://www.uspto.gov/subscription-center/2026/patentsview-migrating-uspto-open-data-portal-march-20)
- [EPO OPS client library](https://patent.dev/epo-ops-v3-2-go-client-library/) · [Lens APIs](https://about.lens.org/lens-apis/)
- [Abigail Patent AI](https://abigail.app/blog/guides/best-patent-prosecution-ai-2026) · [Patent Search Cost](https://www.upcounsel.com/patent-search-cost) · [FTO Search Cost](https://www.wissenresearch.com/how-much-does-freedom-to-operate-fto-search-cost/)

### Distribution channels
- [AIPLA Events](https://www.aipla.org/events) · [NAPP](https://napp.org/) · [IPO 2026 Annual Meeting](https://ipo.org/index.php/am2026/)
- [r/patentlaw subreddit stats](https://gummysearch.com/r/patentlaw/) · [IPWatchdog Advertising](https://ipwatchdog.com/about/advertise-on-ipwatchdog/)
- [PLI Patent Law Institute](https://www.pli.edu/programs/patent-law-institute) · [Strafford Patent Law CLE](https://www.straffordpub.com/patent-law)
- [USPTO Patent Pro Bono](https://www.uspto.gov/patents/basics/using-legal-services/pro-bono/patent-pro-bono-program) · [USPTO PTRCs](https://www.uspto.gov/learning-and-resources/patent-trademark-resource-centers)
- [DeepIP $40M Funding — IPWatchdog](https://ipwatchdog.com/press/deepip-reaches-40m-in-funding-establishing-the-ai-standard-in-patent-work/)
- [AI Adoption in Patent Practice — Solve Intelligence](https://www.solveintelligence.com/blog/post/patent-attorneys-ai-and-the-skills-gap-insights-from-aipla)
- [Cypris 2026 Prior Art Tools Review](https://www.cypris.ai/insights/best-prior-art-search-software-for-2026-ai-tools-and-enterprise-platforms-compared)

### Indie SaaS + audience sizing
- [Patlytics $40M Series B](https://www.businesswire.com/news/home/20260408770722/en/Patlytics-Raises-$40-Million-Series-B-to-Expand-the-AI-Platform-Purpose-Built-for-IP-Work)
- [Spellbook Series B $50M](https://www.artificiallawyer.com/2025/10/09/spellbook-raises-50m-ceo-scott-stevenson-interview/)
- [Robin AI collapse](https://legaltechnology.com/2025/10/28/robin-ai-listed-for-distressed-sale-nine-months-after-making-the-sunday-times-100-tech-list/)
- [Henchman acquired by LexisNexis](https://tracxn.com/d/companies/henchman/__cS8FUGwy3kZLuZTF1b6Gb8DM9qxXRdR5txcVTzUIXjo)
- [Casetext $650M acquisition](https://www.prnewswire.com/news-releases/thomson-reuters-completes-acquisition-of-casetext-inc-301903701.html)
- [Octimine acquired by Dennemeyer](https://www.dennemeyer.com/ip-blog/news/dennemeyer-group-acquires-innovative-provider-of-semantic-patent-search-services-octimine/)
- [CIPA UK](https://www.cipa.org.uk/what-we-do/) · [epi members](https://patentepi.org/en/the-institute/description-of-the-epi.html) · [JPAA](https://www.jpaa.or.jp/en/about-us/)
- [USPTO FY24 budget](https://www.uspto.gov/sites/default/files/documents/fy24pbr.pdf) · [WIPO IP Indicators 2025](https://www.wipo.int/web-publications/world-intellectual-property-indicators-2025-highlights/en/patents-highlights.html)
- [ChartMogul AI Churn Wave](https://chartmogul.com/reports/saas-retention-the-ai-churn-wave/)

### MCP / agent
- [riemannzeta/patent_mcp_server](https://github.com/riemannzeta/patent_mcp_server) · [patent.dev Patent Connector](https://patent.dev/patent-connector-mcp-server-for-ai-powered-patent-research/)
- [PatSnap Eureka MCP](https://open.patsnap.com/devportal/guides/mcp-installation)
- [Apify Google Patents Scraper](https://apify.com/scrapepilot/google-patents-scraper----claims-inventors-citations/api/mcp)
- [USPTO AI rollout — Snell & Wilmer](https://www.swlaw.com/publication/inside-the-usptos-ai-rollout-what-ip-stakeholders-need-to-know/)
- [Harvey Agents Patent Portfolio Analysis](https://www.harvey.ai/resources/videos/harvey-agents-patent-portfolio-analysis)
- [Sterne Kessler × Thomson Reuters Patent Claim Eligibility Analyzer](https://www.sternekessler.com/news-insights/news/sterne-kessler-and-thomson-reuters-partner-to-create-new-ai-tool-for-patent-litigation/)

### Legal audit / UPL / liability
- [Google v. SerpAPI complaint analysis — IPWatchdog](https://ipwatchdog.com/2025/12/26/google-sues-serpapi-parasitic-scraping-circumvention-protection-measures/)
- [Google's SerpAPI lawsuit announcement](https://blog.google/technology/safety-security/serpapi-lawsuit/)
- [SerpAPI MTD analysis — ALM Corp](https://almcorp.com/blog/serpapi-google-lawsuit-motion-dismiss-web-scraping-dmca/)
- [USPTO Terms of Use](https://www.uspto.gov/terms-use-uspto-websites) · [USPTO ODP getting started](https://data.uspto.gov/apis/getting-started)
- [EPO Espacenet Fair Use Charter](https://ea.espacenet.com/?locale=en_EA&view=fairusecharter) · [WIPO Patentscope Terms](https://www.wipo.int/en/web/patentscope/data/terms_patentscope)
- [Gemini API Additional Terms](https://ai.google.dev/gemini-api/terms) · [Google Cloud Generative AI Indemnified Services](https://cloud.google.com/terms/generative-ai-indemnified-services)
- [ABA Formal Opinion 512](https://www.lawnext.com/wp-content/uploads/2024/07/aba-formal-opinion-512.pdf)
- [California State Bar AI amendments (2026)](https://www.calbar.ca.gov/public/public-meetings-comment/public-comment/public-comment-archives/2026-public-comment/proposed-amendments-rules-professional-conduct-related-artificial-intelligence)
- [Texas Ethics Opinion 705](https://www.spellbook.legal/learn/state-bar-rules-ai-use)
- [Mata v. Avianca, Inc. — Wikipedia](https://en.wikipedia.org/wiki/Mata_v._Avianca,_Inc.)
- [35 U.S.C. § 122 — Cornell LII](https://www.law.cornell.edu/uscode/text/35/122)
- [Copyright on content of patents — Wikipedia](https://en.wikipedia.org/wiki/Copyright_on_the_content_of_patents_and_in_the_context_of_patent_prosecution)
- [epi Guidelines on Generative AI (2024)](https://information.patentepi.org/issue-4-2024/epi-guidelines-use-of-generative-ai.html)
- [EU AI Act 2026 Compliance](https://www.gdprregister.eu/regulations/eu-ai-act-compliance/)
- [Yale JOLT — ChatGPT, Esq. (UPL analysis)](https://yjolt.org/sites/default/files/avery_abril_delriego_26yalejltech64.pdf)
- [Finnegan FTO Opinions practice](https://www.finnegan.com/en/work/practices/diligence-licensing-and-opinions/freedom-to-operate-opinions.html)
- [Corgi AI Liability Insurance](https://www.artificiallawyer.com/2026/05/05/corgi-launches-ai-liability-insurance/)
- [Embroker E&O for AI Consultants](https://www.embroker.com/blog/eo-insurance-for-ai-consultants/)
