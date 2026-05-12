# Bull-Generator — Roadmap

> **For build status of every feature** (shipped, scaffolded, defined-not-started, gated), see [`research/patent-firm-features.md` Part 6](./research/patent-firm-features.md#part-6--build-status). This document is the strategic/phased view; that document is the feature-by-feature tracker.

## Current state

Live Chrome extension (since Nov 2024) — "AI Patent Search Generator." Takes natural language input and generates Boolean queries for patent search systems (USPTO, EPO, Google Patents) with wildcards, synonyms, Porter stemming, field selection, and broad/moderate/narrow modes. React + TypeScript + Firebase + Stripe.

**Status as of 2026-05-12:** Patent Dossier surface is live (side-panel chips + full-tab dossier, now **11 sections** including examiner intelligence and prosecution-history with AI Office Action analysis). USPTO ODP integration is ~75% complete — only IDS generation remains. Workflows-tab agents (W1 Prior Art Hunter) are the next major build.

**Strategic note:** Of the four products in the portfolio, Bull-Generator has the highest per-transaction price ceiling because patent professionals bill $200–600/hour. If the product has users but low revenue, it's likely a pricing/packaging problem — the current utility model leaves money on the table compared to a workflow model.

## Phase 0 — Patent Dossier (per-patent surface) ✅ shipped

Not in the original roadmap (added on 2026-05-09 after the patent-firm-features research surfaced Tier 1 as a higher-leverage starting point than the agent ladder). Treats Bull-Generator's existing "search query" utility as just one half of the workflow; the other half — "what is this patent?" — is the dossier.

- [x] Side-panel tab consolidation + new Patent / Workflows scaffolds (`e10b3e9`)
- [x] Patent Dossier spec + static HTML mockup (`a36ed22`)
- [x] `/patent-dossier` Cloud Function with full GP-scrape parser + 24h cache (`21d66ca`)
- [x] Side-panel chip view (`f8ee74f`)
- [x] Full-tab dossier route with 9 sections (`1cff587`)
- [x] AI Summary (Gemini-backed, on-demand, auto-loads, bundled pricing) (`5c9d6ef`, `b2c5151`)
- [x] Brand + scroll-spy nav + Chrome Web Store CTAs + auto-detect from active GP tab + dossier polish (`9f5e9b4`, `dfab7f6`, pending)

## Phase 1 — Validate pricing/packaging hypothesis ⏸ deferred

Originally the gate for building agents. **Decision 2026-05-10: deferred** — low user base makes pricing-interview signal too weak to be useful. Building first, price-testing live, revisiting after first paid Workflow-tab use.

- [ ] Email/interview 5 patent professionals (attorneys, searchers, solo inventors from LinkedIn). Key questions:
  - "If a tool ran a pre-search for your invention and returned 10 ranked prior art references in 10 minutes for $29, would you use it?"
  - "What would break your trust in the output?"
  - "What's the actual workflow gap today?"
- [ ] Audit current Bull-Generator users — who's using it, how often, what's the current conversion to paid?
- [ ] Document the user research findings to inform Phase 2 build priorities

## Phase 2 — Agent SDK expansion (now build-first, validate-live)

See `AGENT_SDK.md` for full opportunity analysis, starter code, and pricing math.
Build status mirrored in [patent-firm-features.md Part 5 + Part 6](./research/patent-firm-features.md#part-5--workflow-agents-one-shot-deliverables).

- [ ] **W1 Prior Art Hunter Agent** (priority #1 — $29–99 per run)
  - Invention description → 3 Boolean queries (broad/moderate/narrow) → patent searches → ranked prior art report with citations
  - Critical: every cited publication MUST be verified via WebFetch before inclusion (no hallucinations)
  - Custom MCP tools: wrap existing Boolean generator + patent search API
  - First step: build as CLI, run on 5 real invention descriptions, have patent expert review output quality
- [ ] **W2 Claim Analyzer Agent** (priority #2 — $49 per application)
  - Upload patent application → claim-by-claim novelty analysis with suggested rewording
  - Requires PDF parsing + deeper claim interpretation — harder than Prior Art Hunter, build second
- [ ] **W3 Freedom-to-Operate Agent** (priority #3 — $99–299 per product)
  - Product description → active-patent search → infringement risk matrix
  - HEAVY legal disclaimers required on every output
- [ ] **W4 Technology Landscape Agent** (priority #4 — $199 per report)
  - Technology area → top assignees, filing trends, white space analysis
  - Target audience: VCs, R&D teams (different buyer than patent pros)

## Phase 2.5 — USPTO ODP integration (in progress)

Parallel track to the Workflow agents — fills in the prosecution-heavy half of dossier Tier 1.

- [x] **File wrapper viewer** (2026-05-12) — `/prosecution-history` endpoint + server-side PDF proxy `/odp-document` (PDFs require X-API-KEY so direct `<a href>` fails); § 10 Prosecution section with category filter chips + auto-load + 7-day cache
- [x] **Office Action analyzer** (2026-05-12) — `/oa-analyze` endpoint, Gemini 2.5 Flash multimodal PDF input (handles scanned OAs via native OCR — no separate text extraction); inline-expand panel with rejections / cited art / suggested arguments; 5 free per application then 1 credit
- [x] **Examiner statistics** (2026-05-12) — `/examiner-stats` endpoint pulling from USPTO ODP bibliographic + search (PatentsView migrated into ODP 2026-03-20); § 9 with examiner name, art unit, total apps, allowance rate, avg pendency
- [ ] **IDS generation** — auto-format Form SB/08 from family citation network and OA-cited art

## Phase 3 — Explore Agent SDK for more opportunities

**Task:** Revisit `AGENT_SDK.md` quarterly. Patent search is a deep vertical with many workflow agents worth building. Candidate areas:

- Citation network agent (given a patent, map all forward/backward citations and assess prior art web)
- Examiner rejection responder (analyze an office action, draft response arguments)
- Patent family tracker (monitor assignee filings, alert on new applications in watched areas)
- Translation-aware search (Japanese/Chinese/Korean patent literature)
- Design patent visual search (when vision models can match design drawings)
- Agent that explains patent claims in plain English for non-lawyers (consumer play)

Review cadence: after each Phase 2 agent ships, re-read `C:\Projects\ideas\claude-code-research\agent-sdk.md` and check `https://code.claude.com/docs/en/agent-sdk/overview` for new capabilities.

## Risk register

- **Hallucination is existential** — one invented reference destroys trust with patent pros. All outputs require source verification.
- **Not legal advice** — every Claim Analyzer and FTO output must carry a legal disclaimer. Consult an IP attorney about liability exposure before shipping FTO.
- **Patent search API costs** — Google Patents XHR scrape (`patents.google.com/xhr/result?...`) is the canonical free path and what production uses today. USPTO ODP covers the prosecution-data half (free with API key). Commercial APIs (PatSnap, LexisNexis TotalPatent) are a budget consideration if either of those breaks at scale. **BigQuery is excluded** — per `feedback_no_bigquery.md`, prior usage cost $7.44/call due to 1.19 TB scans; never propose it as a fallback.

## Related docs

- [README.md](./README.md) — (needs expansion; currently placeholder)
- [AGENT_SDK.md](./AGENT_SDK.md) — Agent SDK opportunities, starter code, pricing math
- [patent-search-privacy-policy.html](./patent-search-privacy-policy.html) — privacy policy (referenced as context)
