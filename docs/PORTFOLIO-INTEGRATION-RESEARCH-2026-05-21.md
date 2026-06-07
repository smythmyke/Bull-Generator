# Bull-Generator — Integration & Platform Research

**Date:** 2026-05-21
**Source conversation:** MarkItUp portfolio session, after building MarkItUp's OAuth foundation + scaffolding the Canva app. User asked: "does this plan sound solid? find other similar MCP/API opportunities."
**Scope:** Critique of existing `AGENT_SDK.md` plan + new integration opportunities Bull-Generator hasn't documented yet + 12/24 month portfolio revenue projections.

## 1. Critique of the existing AGENT_SDK.md + ROADMAP plan

### Strengths
- **Per-transaction price ceiling is the highest in the four-project portfolio** ($29–299). Patent professionals bill $200–600/hour — math works.
- **88% margins on Prior Art Hunter** — believable given documented token costs.
- **Buyer = User** (patent professional is both). No commission/distribution split, no two-sided onboarding.
- **"Accuracy is existential" correctly identified as #1 risk** in the AGENT_SDK doc. This is the right top concern.

### Weaknesses to flag

1. **No third-party marketplace distribution play.** Plan currently relies on Chrome Web Store + direct sales + word-of-mouth. Patent attorneys are notoriously hard to reach cold. ROADMAP doesn't address this.
2. **Pre-launch user research deferred (Phase 1, deferred 2026-05-10).** For a high-trust niche where one hallucinated citation destroys credibility, validating with 5 patent pros BEFORE building agents may be more critical than the current "build first, validate live" stance.
3. **Google Patents ToS scaling risk** — flagged in AGENT_SDK doc but no concrete plan for when free Google Patents hits its limit. BigQuery dataset is $$$$. Commercial APIs (PatSnap, LexisNexis) are even more expensive.
4. **Small TAM.** ~50K US patent attorneys + ~30K examiners + a few thousand searchers. High per-user revenue but the ceiling caps total growth.

## 2. Integration / API opportunities Bull-Generator hasn't yet documented

Ranked by leverage-per-hour, with realistic effort estimates:

| # | Opportunity | Effort | Why it might work | Why it might not |
|---|---|---|---|---|
| 1 | **MCP server (Smithery + official MCP Registry)** | **1–2 days** (proven playbook from MarkItUp's `markitup-mcp-server`) | Patent attorneys using Claude Code / Cursor for IP work is small but growing. Listing is free distribution. Reuses existing Boolean generator + patent search as MCP tools. | Audience overlap with MCP-aware lawyers is genuinely small (<1k people). Distribution value > revenue value. |
| 2 | **Microsoft Word add-in (Office Add-in marketplace)** | 2–3 weeks | Patent applications ARE written in Word. Add-in that surfaces prior art inline as the user types claim language is uniquely valuable. Office Add-in marketplace is open. | Microsoft Office Add-in approval process exists. Distribution good but reaches general office users, not specifically patent attorneys. |
| 3 | **Notion / Confluence integration** | 1 week each (MarkItUp now has reusable OAuth infrastructure) | Patent attorneys / searchers maintain extensive case notes. "Drop a patent number → get the dossier inline" is a real daily workflow. | Notion adoption among solo patent attorneys is low (they use Word + Outlook). Better for in-house IP teams at tech companies. |
| 4 | **USPTO Patent Center deeper integration** | 3–4 weeks | Already done ODP. Going further (PTACTS, Patent Public Search overlays) builds the strongest credibility moat. Official-systems integration = highest trust. | No revenue directly — credibility play only. Best done via Chrome extension's existing surface. |
| 5 | **Slack / Teams bot for law firms** | ~2 weeks (MarkItUp has reusable Slack OAuth + Cloud Tasks pattern) | "/patent-search [invention]" → bot replies with ranked prior art. Partners + associates collaborate on cases in Slack/Teams. | Sales cycle to law firm IT is slow. Pricing model unclear (per-firm subscription? per-search?). |
| 6 | **PatSnap Marketplace app** | 4–6 weeks (enterprise sales cycle) | PatSnap has 12K+ enterprise customers. Listing gets in front of corporate IP departments — bigger deals than solo attorneys. | Hardest path — enterprise procurement cycles. Not worth it until first $20k MRR. |
| 7 | **Zapier / Make.com integration** | 1 week | "When new patent published in [tech area], run Bull-Generator analysis." Long-tail automation users. | Tiny revenue per integration. Cheap to ship but low-impact. |
| 8 | **Westlaw / LexisNexis / Bloomberg Law** | 2–3 months | Dominant legal research platforms. Highest stickiness once integrated. | Enterprise sales nightmare. Maybe v3 (year 2+). |

## 3. Recommended sequence

**Phase 1 (next 2–4 weeks):**
1. **MCP server** (1–2 days, leverages existing infra). Free distribution via Smithery + MCP Registry. Same playbook as MarkItUp.
2. **Begin pre-launch user research** (the Phase 1 the ROADMAP deferred). 5 patent attorneys, 30 min each. Validate Prior Art Hunter trust threshold before sinking 4 weeks into agent code that gets rejected for "I won't trust an AI's citation."

**Phase 2 (after Prior Art Hunter is built):**
3. **Microsoft Word add-in** — highest workflow-fit, differentiated from any existing tool.

**Phase 3 (after $5k MRR):**
4. PatSnap marketplace listing if MCP + Word add-in produced real signal.

**Skip entirely until v3:** Westlaw/LexisNexis/Bloomberg integrations. Enterprise sales cycle not worth it under $20k MRR.

## 4. 12 / 24-month conservative revenue projection (Bull-Generator only)

Assumptions:
- All workflow agents (Prior Art Hunter, Claim Analyzer, FTO, Landscape) shipped within 6 months
- MCP server shipped within 1 month
- No marketplace breakout (no PatSnap deal, no creator partnership)
- Solo-founder time ~20% of total portfolio bandwidth
- Conversion rates assume cold-traffic patent professional baseline (slow, high-trust threshold)

| Horizon | My conservative MRR | Cut in half | Notes |
|---|---|---|---|
| 12 months | $1k–$2.5k | $0.5k–$1.25k | First law firms onboarding through year. Prior Art Hunter primary revenue driver. |
| 24 months | $3k–$7k | $1.5k–$3.5k | Word add-in mature, 1–2 mid-firm subscriptions, Prior Art Hunter steady-state. |

**Reality check:** Bull-Generator could surprise UP (one law firm subscription = $5k MRR easily — patent firms pay enterprise rates) or DOWN (no firms close in year 1 due to high-trust friction). Variance is wider than the table suggests.

## 5. Cross-project context

Bull-Generator fits in MarkItUp's broader portfolio per `docs/PORTFOLIO-OUTLOOK.md` (canonical at `C:\Projects\JackpotKeywords\docs\PORTFOLIO-OUTLOOK.md`):
- GovToolsPro = high-floor anchor
- JackpotKeywords = mid/mid growth bet
- MarkItUp = low-floor / mid-ceiling growth bet
- **Bull-Generator = highest per-transaction ceiling, slowest validation cycle**

Solo-founder time allocation per portfolio doc: 50% GovToolsPro / 25–30% JackpotKeywords / 20–25% MarkItUp — Bull-Generator is currently NOT in the explicit allocation. Either it absorbs MarkItUp's 20–25% slot (if MarkItUp's Canva work is winding down) or it remains a side project for now.

## Related

- [Bull-Generator AGENT_SDK.md](../AGENT_SDK.md) — original workflow-agent plan
- [Bull-Generator ROADMAP.md](../ROADMAP.md) — phase-by-phase build tracker
- `C:\Projects\JackpotKeywords\docs\PORTFOLIO-OUTLOOK.md` — combined 3-project outlook (Bull-Generator was added to portfolio thinking after this doc was written)
- `C:\Projects\MarkItUp\planning\CANVA-OAUTH-SPEC.md` — reusable OAuth infrastructure that Bull-Generator could leverage for Notion/Slack/etc.
