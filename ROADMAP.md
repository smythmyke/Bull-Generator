# Bull-Generator — Roadmap

## Current state

Live Chrome extension (since Nov 2024) — "Patent Boolean Search Generator." Takes natural language input and generates Boolean queries for patent search systems (USPTO, EPO, Google Patents) with wildcards, synonyms, Porter stemming, field selection, and broad/moderate/narrow modes. React + TypeScript + Firebase + Stripe.

**Strategic note:** Of the four products in the portfolio, Bull-Generator has the highest per-transaction price ceiling because patent professionals bill $200–600/hour. If the product has users but low revenue, it's likely a pricing/packaging problem — the current utility model leaves money on the table compared to a workflow model.

## Phase 1 — Validate pricing/packaging hypothesis

Before building new features, confirm the opportunity:

- [ ] Email/interview 5 patent professionals (attorneys, searchers, solo inventors from LinkedIn). Key questions:
  - "If a tool ran a pre-search for your invention and returned 10 ranked prior art references in 10 minutes for $29, would you use it?"
  - "What would break your trust in the output?"
  - "What's the actual workflow gap today?"
- [ ] Audit current Bull-Generator users — who's using it, how often, what's the current conversion to paid?
- [ ] Document the user research findings to inform Phase 2 build priorities

## Phase 2 — Agent SDK expansion

See `AGENT_SDK.md` for full opportunity analysis, starter code, and pricing math.

**Only proceed if Phase 1 validates willingness to pay.**

- [ ] **Prior Art Hunter Agent** (priority #1 — $29–99 per run)
  - Invention description → 3 Boolean queries (broad/moderate/narrow) → patent searches → ranked prior art report with citations
  - Critical: every cited publication MUST be verified via WebFetch before inclusion (no hallucinations)
  - Custom MCP tools: wrap existing Boolean generator + patent search API
  - First step: build as CLI, run on 5 real invention descriptions, have patent expert review output quality
- [ ] **Claim Analyzer Agent** (priority #2 — $49 per application)
  - Upload patent application → claim-by-claim novelty analysis with suggested rewording
  - Requires PDF parsing + deeper claim interpretation — harder than Prior Art Hunter, build second
- [ ] **Freedom-to-Operate Agent** (priority #3 — $99–299 per product)
  - Product description → active-patent search → infringement risk matrix
  - HEAVY legal disclaimers required on every output
- [ ] **Technology Landscape Agent** (priority #4 — $199 per report)
  - Technology area → top assignees, filing trends, white space analysis
  - Target audience: VCs, R&D teams (different buyer than patent pros)

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
- **Patent search API costs** — Google Patents public scrape works for MVP but may hit limits. Budget for commercial API (PatSnap, LexisNexis TotalPatent, Google BigQuery patent dataset) at scale.

## Related docs

- [README.md](./README.md) — (needs expansion; currently placeholder)
- [AGENT_SDK.md](./AGENT_SDK.md) — Agent SDK opportunities, starter code, pricing math
- [patent-search-privacy-policy.html](./patent-search-privacy-policy.html) — privacy policy (referenced as context)
