# ROADMAP — Bull-Generator

**Last updated:** 2026-06-02
**Scope:** Live Chrome extension (since Nov 2024) — AI Patent Search Generator. React + TypeScript + Firebase + Stripe. Surfaces: extension + REST API + MCP server (`patent-search-mcp-server`, npm + Official MCP Registry). Converted from Phase-structured roadmap on 2026-05-27. **For build status of every feature**, see [`research/patent-firm-features.md` Part 6](./research/patent-firm-features.md#part-6--build-status) — this file is the strategic/phased view.

<!-- DASHBOARD-META
project_key: bull-generator
title: "Bull-Generator"
purpose: "AI Patent Search Generator — Chrome extension + REST API + MCP server for patent professionals"
phase: "Phase 2.7 — Tier 2 dossier + Workflows"
phases: ["Phase 0 — Patent Dossier", "Phase 2.5 — USPTO ODP", "Phase 2.6 — Public API + MCP", "Phase 2.7 — Tier 2 + Workflows", "Phase 2 — Agent SDK"]
key_dates:
  - {label: "Smithery/Glama auto-index expected by", date: "2026-06-02"}
-->

**Status legend:** ☐ todo · ◐ in progress · ✓ done · ⊘ blocked · ✗ dropped

> Editing rules: `C:\Projects\dashboards\project-dashboard\STRUCTURE.md`.

## ACTIVE — This Week

- ✅ ODP-1: ODP data-source migration for API/MCP — **COMPLETE 2026-05-31.** Dossier + legal-intelligence (`/v1/challenges`, `/v1/legal-status`, `/v1/assignments`, `/v1/litigation`, `/v1/company-litigation`) + enrichment (`/v1/term`, `/v1/prosecution-timeline`, `/v1/attorney`, `/v1/entity-status`, `/v1/pregrant-pub`) all on ODP. **These 10 legal/enrichment endpoints are a shared DATA LAYER** consumed three ways: (a) standalone in the extension Patent dossier (EXT-ODP-1), (b) feedstock inside the Workflow agents (esp. FTO — W3-1/FTO-1), (c) a new lightweight Due-Diligence workflow (DD-1). Final piece: `/v1/search` no longer scrapes Google on the public surface — the API/MCP path returns AI-generated Boolean queries (`executionMode=client_side`) for the caller to run (commit `7fdc745` backend + `4120e85` MCP v0.4.0; deployed + verified). **The marketplace surface is now 100% scraping-free / USPTO-only — RED #1 legal risk closed.** Extension still on Google Patents (unchanged). Plan: `planning/PLAN-API-DATA-MIGRATION.md`.
- ☐ API-FT-1 (was "B"): Optional server-side full-text search execution from clean data. ODP has NO full-text search (title/metadata only — verified 2026-05-31). PatentsView PatentSearch API (free key, full-text title+abstract) is the only clean source but is mid-transition into USPTO ODP (decommission/transition risk). Plan: request a PatentsView key, build a `/v1/search` execution adapter behind a flag with graceful fallback. **Deferred** — only build if a real API/MCP consumer asks for server-side hits; `/v1/query` + client-side execution covers the use case today. See `memory/research_v1_search_fulltext_source.md`.
- ☐ FTO-1: Build FTO (Freedom-to-Operate) surface — different input shape (product description, not patent) than dossier/MCP tools. Spec: `research/fto-build-plan.md`. Next major feature per 2026-05-12 priority revision (FTO → W4 → W1). **Data layer now shipped (2026-05-31):** `/v1/legal-status` + `/v1/term` supply clean active-status/expiration — this *replaces* the FTO spec's planned "cross-check Google Patents legal status" (fto-build-plan.md line 44), keeping FTO off Google too; `/v1/litigation` + `/v1/challenges` add litigation/PTAB-survival risk signals the original matrix didn't have. **No conflict — the new endpoints fulfil FTO dependencies.** Update fto-build-plan.md Stage to consume these endpoints.
- ☐ REVIEW-1: Triage pre-existing untracked work — `REVENUE-BENCHMARKS.md`, `docs/PORTFOLIO-INTEGRATION-RESEARCH-2026-05-21.md`, `docs/SLACK-BOT-RESEARCH-2026-05-21.md`, `research/pricing-audit-2026-05-12.md`, `functions/debug-odp-*.js`. Commit or discard.

## ACTIVE — Next Two Weeks

- ☐ MCP-SUB-1: Cursor Directory submission for `patent-search-mcp-server` at `cursor.directory/plugins/new` (~5 min) — paste-ready content at `C:\Projects\MarkItUp\planning\CURSOR-DIRECTORY-SUBMISSIONS.md`.
- ☐ MCP-SUB-2: Smithery Settings tab fill — Display Name, Description, Homepage, GitHub Repo, Icon, Visibility=Public (currently unlisted by default per Smithery gotcha #5). Listing exists but hidden from search until done.
- ☐ INDEX-1: Smithery / Glama indexing check — if 2026-06-02 has passed and listings still missing, submit manually via Smithery UI.
- ☐ W4-1: Build W4 Patent Landscape — CPC clustering + competitor overlay; first Workflows-tab agent shipped. Different buyer (VC/R&D) than W1's patent pros. $199 per report.

## BACKLOG

### ODP legal/enrichment endpoints → extension (AFTER API/MCP ships)
- ☐ EXT-ODP-1: Surface the net-new ODP endpoints in the extension UI once the API/MCP versions are built and proven — validity challenges (PTAB), chain of title (assignments), in-force/maintenance status, term/PTA, prosecution timeline, attorney of record, entity status, pregrant-pub, and litigation history. **Additive, net-new data the extension never had — does NOT touch the existing Google Patents dossier path, so no regression risk.** Likely a new "Legal" tab / dossier sections. Source of truth: `planning/PLAN-API-DATA-MIGRATION.md` (Phases 7–8 + build sequence). Discovered during the 2026-05-31 ODP migration.
- ☐ EXT-ODP-2: Open policy question — these endpoints are ODP-only (net-new), so the extension can call them regardless of the GP-vs-ODP dossier split. Confirm whether the extension's core *dossier* eventually also moves to ODP or stays on Google Patents (current decision: stays on GP — "don't replace what works").

### Workflow agents
- ☐ DD-1: **Patent Due-Diligence / Risk Profile** workflow — NEW, recommended near-term. One-shot composition of *already-shipped* endpoints (dossier + `/v1/challenges` + `/v1/litigation` + `/v1/legal-status` + `/v1/term`) → instant risk profile: battle-tested? litigious owner? in force? when does it expire? **Light AI, cheap to build (data composition over endpoints that already exist — not an AI-heavy agent like W1–W4), monetizes the legal layer immediately.** It's the `due-diligence.html` worked example (US 8,724,622 Uniloc) as a product. Bridges EXT-ODP-1 → the heavy workflows. ~40 credits. Keyed off a patent number (or company, via `/v1/company-litigation`).
- ☐ LIT-AI-1: Features/keywords → litigation (semantic). User describes features → AI finds the closest litigated patents. Composes a (future) semantic patent search (embeddings over claims/abstracts — overlaps W1) with the live litigation join (`/v1/litigation` + `litigationByPatent`, shipped 2026-05-31). PTLITIG has no technical content, so the bridge must go through patent text. Roadmapped from the 2026-05-31 reverse-lookup discussion; see `planning/PLAN-API-DATA-MIGRATION.md` "Reverse lookups". Depends on W1-style search.
- ☐ W1-1: Prior Art Hunter (priority #4 — DEFERRED per 2026-05-12 cost analysis). $29–99 per run. Pre-launch non-negotiables: prompt caching, per-user concurrent-run cap, daily org-wide spend ceiling, verification step, refund policy. See `memory/research_w1_prior_art_hunter.md`.
- ☐ W2-1: Claim Analyzer Agent — upload patent application → claim-by-claim novelty analysis with suggested rewording. $49 per application. Requires PDF parsing + deeper claim interpretation.
- ☐ W3-1: Freedom-to-Operate Agent (formal agent version; supersedes/extends FTO-1 surface) — product description → active-patent search → infringement risk matrix. $99–299 per product. Heavy legal disclaimers required. **Consumes the legal data layer** (legal-status/term to drop dead patents; litigation/challenges as risk signals). ⚠️ **Credit accounting:** workflows that fan out legal calls across N candidate patents must budget those internal calls in their headline cost (e.g. FTO over 50 candidates × a few legal lookups each). The standalone EXT-ODP-1 lookups and the in-workflow calls hit the same endpoints — keep one coherent pricing model (cheap/free standalone in-extension; bundled into the workflow's flat price when called internally) so we neither double-charge nor under-cost.

### MCP server v1.1 (gated on real usage signal)
- ☐ MCP-V11-1: Add `claim_chart` as standalone tool
- ☐ MCP-V11-2: Add `claims`, `status`, `compare` tools
- ☐ MCP-V11-3: Full USPTO CPC scheme load
- ☐ MCP-V11-4: `cpc` reverse lookup
- ☐ MCP-V11-5: Optional launch announcement (HN, ProductHunt) — JK playbook says passive distribution suffices; do only if traction warrants

### MCP/API distribution (cross-portfolio playbook)
- ⊘ MCP-SUB-3: awesome-mcp-servers PR #6961 (punkpeye) — `Add smythmyke/patent-search-mcp-server (Legal)` — filed, awaiting Frank's review. Backlog is ~1,300 PRs. Check: `gh pr view 6961 --repo punkpeye/awesome-mcp-servers --json state,reviewDecision`.
- ⊘ MCP-SUB-4: MCP.so issue #2529 at `chatmcp/mcpso` — filed, awaiting. Check: `gh issue view 2529 --repo chatmcp/mcpso --json state`.
- ✗ MCP-SUB-5: appcypher/awesome-mcp-servers — DROPPED, maintainer disabled PRs/issues 2026-05-26.
- ☐ MCP-SUB-6: GovToolsPro MCP distribution followup — once GovToolsPro MCP ships (sibling project), replicate the 5-surface playbook. Reference: `~\.claude\projects\C--Projects-Bull-Generator\memory\project_govtoolspro_mcp_distribution_followup.md`.

### MCP monetization & Claude Connector Directory (2026-06-02 dashboard review)
*New surfaces from the MCP-monetization review — agent-to-agent payments + Anthropic's Connector Directory, neither of which any portfolio MCP does yet. **patent-search is the strongest x402 candidate in the portfolio** — autonomous legal-research agents calling prior-art/dossier/legal-status lookups mid-task are exactly the pay-per-call buyer.*
- ☐ ANNOT-1: Add MCP tool annotations to all 11 tools — `readOnlyHint: true` on the search/dossier/lookup/legal-status/citation tools (all read-only against USPTO/GP data), `balance` read-only too; none are destructive. **Prereq for CONN-1** — missing annotations are the #1 Connector Directory rejection cause (~30%). Mirror into Smithery `.mcpb` + Glama manifests.
- ☐ CONN-1: Submit `patent-search-mcp-server` to the **Claude Connector Directory** (`claude.com/docs/connectors/building/submission`, ~2wk review). **Streamlined plan (JackpotKeywords pilot proven end-to-end via Claude 2026-06-03): `planning/PLAN-CLAUDE-CONNECTOR.md`.** Build/test-ready: `functions/` (on `solicitation-matcher-extension`) hosts the remote endpoint — copy JK's `mcp.ts` + `mcpOAuth.ts` (jose-free WorkOS AuthKit OAuth), require auth at CONNECT, enable DCR+CIMD in WorkOS Connect→Configuration, ANNOT-1 (readOnlyHint on all 11). Privacy policy already exists. ⚠️ Add the endpoint behind the **direct CF URL** (not the inert hosting rewrite) and don't disrupt GovToolsPro prod (shared project — cross-project hosting tangle). **Public submission BLOCKED on a custom domain** (no DNS-controllable domain today → production AuthKit CNAME impossible; same as JK; staging fine for testing). High-fit: legal researchers live in Claude, thin category = strong relevance-based suggestion share.
- ☐ X402-1: Add an x402 / HTTP-402-gated metered path for autonomous-agent pay-per-search. Stripe ships x402 for USDC on Base (Feb 2026) — stays inside the existing Stripe account; an MCP tool returns `402` to gate with zero JSON-RPC schema change. **Build after JK proves the pattern, but prioritize ahead of MarkItUp** — the agentic legal buyer + high per-transaction ceiling ($200–600/hr billers) make this the best M2M revenue fit. Meter the heavy workflow tools (DD-1 risk profile, FTO) per-call.

### Pricing/packaging validation (deferred)
- ⊘ VALIDATE-1: Email/interview 5 patent professionals — blocked: low user base makes pricing-interview signal too weak. Building first, price-testing live.
- ⊘ VALIDATE-2: Audit current Bull-Generator users — same blocker
- ⊘ VALIDATE-3: Document user research findings to inform Phase 2 priorities — same blocker

### Cross-project + ops
- ☐ OPS-1: Cross-project hosting tangle (Option C, deferred) — see `memory/feedback_cross_project_hosting_tangle.md`. DO NOT deploy hosting from Bull-Generator.

### Phase 3 — Continued SDK exploration
- ☐ EXPLORE-1: Citation network agent — given a patent, map all forward/backward citations and assess prior art web
- ☐ EXPLORE-2: Examiner rejection responder — analyze an office action, draft response arguments
- ☐ EXPLORE-3: Patent family tracker — monitor assignee filings, alert on new applications in watched areas
- ☐ EXPLORE-4: Translation-aware search — Japanese/Chinese/Korean patent literature
- ☐ EXPLORE-5: Design patent visual search (when vision models can match design drawings)
- ☐ EXPLORE-6: Agent that explains patent claims in plain English for non-lawyers (consumer play)

## DONE (recent wins)

- ✓ 2026-05-27 — MCP server live on 5 surfaces — npm + Official MCP Registry + Smithery (`.mcpb` bundle via Python `inputSchema` patch workaround) + Glama (auto-indexed from standalone repo `smythmyke/patent-search-mcp-server` after migrating out of subfolder) + GitHub Release v0.1.0.
- ✓ 2026-05-26 — Phase 2.6 shipped: Public API + MCP server. `patent-search-mcp-server@0.1.0` with 11 tools published to npm + Official MCP Registry (`io.github.smythmyke/patent-search-mcp-server`). Commit `20b643c` on `main`, pushed to GitHub.
- ✓ 2026-05-26 — 5 new backend endpoints: `/v1/similar`, `/v1/citations`, `/v1/family`, `/v1/cpc`, `/v1/search` (execute + query modes). Reuse Google Patents XHR scrape + dossier 24h cache.
- ✓ 2026-05-25 — Public API foundation: `functions/src/auth.ts` + `keys.ts` + `apiRateLimit.ts`. API-key auth (`psg_live_*`/`psg_test_*`) alongside Firebase ID token. Per-key Firestore-backed rate limit (60/min, 1000/day). Scope-based authorization. `/v1/*` URL prefix.
- ✓ 2026-05-25 — Extension Admin tab: API Keys section with list / create-form / reveal sub-state machine, 5 scope checkboxes, 3-second delay on reveal, two-click revoke confirm.
- ✓ 2026-05-12 — Phase 2.7 Claim Chart § 12: `/claim-chart` endpoint; Gemini 2.5 Flash decomposes independent claims into elements + maps to examiner-cited art from OA Analyzer; per-claim status synthesis; 24h cache; auto-loads; free, bundled with dossier.
- ✓ 2026-05-12 — Phase 2.5 USPTO ODP integration complete: file wrapper viewer (`/prosecution-history`), Office Action analyzer (`/oa-analyze`, Gemini 2.5 Flash multimodal), examiner statistics (`/examiner-stats`), IDS generator § 12 (PDF/DOCX/CSV/XML exporters), Google Patents 429/5xx retry-with-backoff.
- ✓ 2026-05-09 — Phase 0 Patent Dossier shipped: side-panel chips + full-tab dossier with **13 sections** including examiner intelligence, prosecution-history with AI Office Action analysis, Claim Chart, and IDS generator. Cloud Function with full GP-scrape parser + 24h cache.
- ✓ 2026-05-09 — AI Summary (Gemini-backed, on-demand, auto-loads, bundled pricing). Brand + scroll-spy nav + CWS CTAs + auto-detect from active GP tab + dossier polish.

## DROPPED

*(none)*

---

# Reference

*Below this line is preserved-as-was reference material. The dashboard parser ignores everything from here down.*

## Strategic context

Of the four products in the portfolio, Bull-Generator has the highest per-transaction price ceiling because patent professionals bill $200–600/hour. If the product has users but low revenue, it's likely a pricing/packaging problem — the current utility model leaves money on the table compared to a workflow model.

## Risk register

- **Hallucination is existential** — one invented reference destroys trust with patent pros. All outputs require source verification.
- **Not legal advice** — every Claim Analyzer and FTO output must carry a legal disclaimer. Consult an IP attorney about liability exposure before shipping FTO.
- **Patent search API costs** — Google Patents XHR scrape (`patents.google.com/xhr/result?...`) is the canonical free path and what production uses today. USPTO ODP covers the prosecution-data half (free with API key). Commercial APIs (PatSnap, LexisNexis TotalPatent) are a budget consideration if either breaks at scale. **BigQuery is excluded** — per `feedback_no_bigquery.md`, prior usage cost $7.44/call due to 1.19 TB scans; never propose it as a fallback.

## Resume-here checkpoint (last updated 2026-05-26)

**Last shipped:** Phase 2.6 (public API + MCP server) on 2026-05-26. Commit `20b643c` on `main`, pushed to GitHub. npm + MCP Registry live.

**Test artifacts left in place:**
- Live API keys for `smythmyke@gmail.com`: `psg_live_uHd1aiKLS8gX1MzkNnOhvzCDZ35Djz_mosG2Au9Ld5c` (all scopes) and `psg_live_l1XxVZpnRnJUxvDHkOMKhrW2HzIcy3cJBvbA42jS9V8` (credits:read only — used for scope-rejection test). Keep or revoke via extension Admin tab.
- `functions/scripts/mint-test-key.js` — one-off CLI utility for minting keys outside the UI. Keep.

**Key references to load first next session:**
- `memory/MEMORY.md` — auto-loaded
- `memory/project_mcp_api_deployment_plan.md` — locked decisions for the MCP/API track
- `memory/feedback_mcp_cloning_strategy.md` — portfolio-wide three-tier cloning rule
- `memory/feedback_cross_project_hosting_tangle.md` — DO NOT deploy hosting from Bull-Generator
- `planning/PLAN-MCP-SERVER.md` — what shipped, what's in v1.1
- `planning/PLAN-PUBLIC-API.md` — endpoints reference

## Related docs

- [README.md](./README.md) — (needs expansion; currently placeholder)
- [AGENT_SDK.md](./AGENT_SDK.md) — Agent SDK opportunities, starter code, pricing math
- [planning/PLAN-PUBLIC-API.md](./planning/PLAN-PUBLIC-API.md) — public API spec + endpoint reference
- [planning/PLAN-MCP-SERVER.md](./planning/PLAN-MCP-SERVER.md) — MCP server spec + 11-tool inventory
- [research/patent-firm-features.md](./research/patent-firm-features.md) — feature-by-feature tracker (Part 6 = build status)
- [research/fto-build-plan.md](./research/fto-build-plan.md) — FTO spec
- [patent-search-privacy-policy.html](./patent-search-privacy-policy.html) — privacy policy
