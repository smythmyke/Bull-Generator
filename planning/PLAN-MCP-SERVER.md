# Bull-Generator — MCP Server Plan

**Date:** 2026-05-25
**Status:** Not started. Adopted from MarkItUp's solo-dev playbook (Tier-1 + Tier-2 full clone per `feedback_mcp_cloning_strategy.md`).
**Goal:** Ship `patent-search-mcp-server` — an MCP (Model Context Protocol) server that exposes Bull-Generator's patent pipeline as tools callable from Claude Code, Claude Desktop, Cursor, ChatGPT-with-MCP, and any other MCP-compatible client.

**Why first among external surfaces:** No marketplace review. Smallest surface. Real external consumer that forces the public API to harden. Same logic that made it MarkItUp's first plugin and JK's first plugin. The audience of patent-aware MCP users is small (<1k people) but distribution is free and the per-user economics are favorable (patent professionals bill $200-600/hr).

**Dependency:** [PLAN-PUBLIC-API.md](./PLAN-PUBLIC-API.md) Day 1 must ship first — MCP server is just a thin proxy over those `/v1/*` endpoints.

## What gets shipped

A Node.js package, published as `patent-search-mcp-server` on npm, runnable via `npx patent-search-mcp-server`. Users add it to their MCP client config:

```jsonc
// ~/.claude/mcp.json (or equivalent for Cursor / ChatGPT / Desktop)
{
  "mcpServers": {
    "patent-search": {
      "command": "npx",
      "args": ["-y", "patent-search-mcp-server"],
      "env": { "PATENT_SEARCH_API_KEY": "psg_live_..." }
    }
  }
}
```

Server reads `PATENT_SEARCH_API_KEY` from environment at startup and proxies calls to the Cloud Function URL. No protocol-level auth — matches the standard stdio MCP convention.

## Tools exposed (v1.0 — 11 tools, locked 2026-05-26)

| MCP tool name | Backend endpoint | Args | Cost | Description |
|---|---|---|---|---|
| `balance` | `GET /v1/credits/balance` | none | free | Credit balance + subscription status. Cheapest tool — exercises auth end-to-end. |
| `dossier` | `POST /v1/dossier` | `{patentNumber}` | 3cr (cache: free) | Full patent intelligence: bibliographic, claims, citations, AI summary, examiner stats bundled. The headline tool. |
| `prosecution` | `POST /v1/prosecution-history` | `{patentNumber}` OR `{applicationNumber}` | free | USPTO file-wrapper documents (Office Actions, responses, amendments). |
| `oa_analyze` | `POST /v1/oa-analyze` | `{patentNumber}` (auto-pick recent) OR `{applicationNumber, documentId}` | 5 free/app then 1cr | AI analysis of an Office Action — rejections, cited art, suggested response arguments. |
| `examiner` | `POST /v1/examiner-stats` | `{patentNumber}` | free | Examiner identity + art unit + allowance rate + avg pendency. Also bundled inside `dossier`. |
| `query` | `POST /v1/search` (mode=optimize) | `{description}` | 1cr | Single optimized Boolean query for manual paste into Google Patents. Returns the query string only — does NOT execute. |
| `search` | `POST /v1/search` (mode=execute) **NEW endpoint** | `{description, strategy: "telescoping"\|"onion-ring"\|"faceted", limit?}` | 1cr | Executes against Google Patents server-side and returns ranked patent hits. |
| `similar` | `POST /v1/similar` **NEW endpoint** | `{patentNumber, limit?}` | free | Google Patents' similar-documents ranking for a patent. |
| `citations` | `POST /v1/citations` **NEW endpoint** | `{patentNumber, direction: "backward"\|"forward"\|"both"}` | free | Backward + forward citations standalone (lighter payload than `dossier`). |
| `family` | `POST /v1/family` **NEW endpoint** | `{patentNumber}` | free | Patent family / continuations / national counterparts. |
| `cpc` | `POST /v1/cpc` **NEW endpoint** | `{code}` | free | CPC classification code → title + description + tree neighbors. Source: USPTO CPC scheme. |

**Naming:** plain snake_case, no product-name prefix. The MCP server name `patent-search` provides the namespace (clients display as `mcp__patent-search__dossier` or `patent-search:dossier`). Matches user-facing mental model for future Slack slash commands (`/dossier`, `/search`, etc.). Tool descriptions in the MCP schema are what the LLM reads to decide when to call them — wording matters more than the names.

**Deferred to v1.1 (with reasons):**
- `claim_chart` — needs more research. Auto-loaded inside `dossier` when OA data exists; not separately invokable in v1.0.
- `claims` (just the claims text, cheaper than dossier), `status` (active/expired/abandoned + maintenance fees), `compare` (pairwise patent A vs B AI assessment).
- `cpc` reverse lookup (description → suggested codes) — search-like, defer.

## Tool response shape

For dossier-returning tools, return both `content[]` (human-readable text) and `structuredContent` (programmatic). Patent dossiers don't have images to render via `resource_link` — they're text-heavy, so the JSON in `structuredContent` is the load-bearing payload.

```jsonc
// patent_search_dossier result
{
  "content": [
    { "type": "text", "text": "US10867416B2 — Method for ...\n\nAssignee: Acme Corp\nFiled: 2018-04-12\nExaminer: Jane Doe (Art Unit 2625, 67% allowance rate)\n\nIndependent claim 1: ...\n\n13 prior-art citations, 5 forward citations." }
  ],
  "structuredContent": {
    "patentNumber": "US10867416B2",
    "bibliographic": { ... },
    "claims": [ ... ],
    "citations": { backward: [...], forward: [...] },
    "examiner": { name: "...", artUnit: "...", allowanceRate: 0.67 },
    "creditsCharged": 3,
    "cached": false
  }
}
```

## Repo layout

```
Bull-Generator/                       # existing repo root
├── extension-src/                    # existing Chrome extension
├── functions/                        # existing Cloud Functions
├── mcp-server/                       # NEW — separate npm package
│   ├── src/
│   │   ├── index.ts                  # MCP server bootstrap, tool registration
│   │   ├── tools/
│   │   │   ├── balance.ts
│   │   │   ├── dossier.ts
│   │   │   ├── prosecution.ts
│   │   │   ├── oaAnalyze.ts
│   │   │   ├── examiner.ts
│   │   │   ├── query.ts
│   │   │   ├── search.ts
│   │   │   ├── similar.ts
│   │   │   ├── citations.ts
│   │   │   ├── family.ts
│   │   │   └── cpc.ts
│   │   └── api/
│   │       └── client.ts             # Thin fetch wrapper, X-API-Key header
│   ├── package.json                  # name: "patent-search-mcp-server"
│   ├── tsconfig.json
│   ├── README.md                     # Install instructions per MCP client
│   ├── server.json                   # MCP Registry manifest
│   ├── smithery.yaml                 # Smithery config
│   ├── glama.json                    # Glama config
│   ├── Dockerfile                    # For hosted-MCP variants (future)
│   └── LICENSE                       # MIT
```

Standalone package, not folded into the extension or functions build. Versioned independently. Tier-2 clone from `C:\Projects\MarkItUp\mcp-server\` — same structure, file count, and SDK version.

## Distribution

1. **npm** — `patent-search-mcp-server`, published from local CLI using the existing granular token in `~/.npmrc` (already set up for MarkItUp and JK)
2. **Official MCP Registry** — `registry.modelcontextprotocol.io`, namespace `io.github.smythmyke/patent-search-mcp-server` (GitHub OAuth verification via existing account)
3. **Smithery** — auto-syncs from `smithery.yaml` in public GitHub repo within ~7 days. Manual fallback via Smithery UI if needed
4. **Glama** — auto-indexed from `glama.json` in repo
5. **GitHub** — public repo, MIT licensed. Will live at `github.com/smythmyke/Bull-Generator/tree/main/mcp-server` (subfolder, not separate repo — JK chose subfolder, MarkItUp chose separate repo; subfolder is fine for a side surface)

## Auth model

stdio servers handle auth outside the protocol. Standard convention is environment variables. Same pattern as MarkItUp and JK:

- `PATENT_SEARCH_API_KEY` — required. Server exits with a clear error if missing
- `PATENT_SEARCH_API_BASE` — optional override (default `https://us-central1-solicitation-matcher-extension.cloudfunctions.net/ai/v1`). Useful for testing against an emulator

Keys minted from extension Admin tab (see PLAN-PUBLIC-API.md). README documents this flow.

**CRITICAL:** Use the direct Cloud Function URL, not a Firebase Hosting custom domain, until/unless a custom domain is set up. JK got bit by the Firebase Hosting 60s edge timeout silently 502-ing long-running endpoints. The dossier endpoint can run 20-45s on cold fetches (Google Patents scrape + USPTO ODP roundtrip).

Never log the API key. Never include it in tool result text/errors. The MCP client may print server stderr to the user — assume any stderr is public.

## Work plan — 2 days (after PLAN-PUBLIC-API.md Day 1 completes)

### Day 2A: New backend endpoints (~1 day)

Five new endpoints required to back the full 11-tool MCP surface:

- [ ] **`POST /v1/search` (mode=execute)** — server-side Google Patents search execution. Wraps existing GP-scrape pattern from `googlePatentsEnrich.ts` + `patentDossier.ts`. Optional ranking via existing `/rank` endpoint. ~1 day (biggest piece).
- [ ] **`POST /v1/similar`** — extract Google Patents' similar-documents ranking from the existing XHR response that dossier already fetches. ~1 hr.
- [ ] **`POST /v1/citations`** — extract backward + forward citations from existing dossier data without full payload. ~1 hr.
- [ ] **`POST /v1/family`** — extract patent family from existing XHR response. ~1 hr.
- [ ] **`POST /v1/cpc`** — load USPTO CPC scheme JSON into `functions/data/cpc.json`, simple lookup endpoint. ~half day.
- [ ] Smoke test each via curl using the existing `psg_live_` test key from Day 1
- [ ] Deploy functions (NOT hosting — per `feedback_cross_project_hosting_tangle.md`)

### Day 2B: mcp-server scaffold + 11 tools (~1 day)

- [ ] Tier-2 clone `C:\Projects\MarkItUp\mcp-server\` → `C:\Projects\Bull-Generator\mcp-server\`
- [ ] Swap names throughout: `markitup` → `patent-search`, `MarkItUp` → `PatentSearch`, `MARKITUP_API_KEY` → `PATENT_SEARCH_API_KEY`, `mk_live_` → `psg_live_`
- [ ] Update `package.json`: name, mcpName (`io.github.smythmyke/patent-search-mcp-server`), description, keywords, repository URL
- [ ] Update `server.json` and `smithery.yaml`: same name swap + env var rename
- [ ] Rewrite `src/api/client.ts`:
  - DEFAULT_API_BASE = direct Cloud Function URL
  - `humanizeError` messages reference extension Admin tab for key management
- [ ] Implement 11 tools in `src/tools/*.ts` — each ~30-50 LOC: zod schema + handler that calls `api.post('/dossier', args)` etc.
- [ ] Register all 11 in `src/index.ts` (mirror MarkItUp's switch statement)
- [ ] Local-test from Claude Code:
  - Add `~/.claude/mcp.json` entry pointing at `node /absolute/path/to/Bull-Generator/mcp-server/dist/index.js`
  - Set env var to the existing `psg_live_uHd1aiKLS8gX1MzkNnOhvzCDZ35Djz_mosG2Au9Ld5c` test key (minted Day 1)
  - Confirm `balance` returns balance
  - Confirm `dossier` for `US10867416B2` returns full dossier and deducts 3 credits

### Extension Admin tab UI (parallel with Day 2B)

- [ ] Add API Keys section to extension Admin tab (`extension-src/src/components/...`):
  - List existing keys (name, prefix, createdAt, lastUsedAt, revoke button)
  - Create-key form (name input, scope checkboxes, environment radio)
  - Modal showing raw key once with copy + "I saved it" confirmation
  - Calls `/keys/create`, `/keys/list`, `/keys/revoke` endpoints (already live from Day 1)

### Day 3: Publish

- [ ] Write `README.md` with copy-pasteable install snippets for Claude Code, Claude Desktop, Cursor (clone MarkItUp's README structure, swap content)
- [ ] `npm publish` v0.1.0 (use existing granular token in `~/.npmrc`)
- [ ] Run `mcp-publisher.exe` to publish to official MCP Registry (clone the binary from `C:\Projects\MarkItUp\mcp-server\mcp-publisher.exe` — same tool, same auth)
- [ ] Verify GitHub namespace claim: `io.github.smythmyke/...` should auto-verify via the existing GitHub OAuth from MarkItUp/JK setups
- [ ] Push `mcp-server/` subfolder to Bull-Generator's GitHub repo (currently the extension is closed-source; the `mcp-server/` subfolder can be public via a separate sparse-clone or by making the whole repo public — TBD by user preference)
- [ ] Confirm Smithery + Glama auto-index within 7 days; manual submit if not

### Optional Day 4: Announcement (skippable per solo-dev playbook)

- [ ] Add a note on the existing landing page that the MCP server exists, with install snippet
- [ ] Skip ProductHunt / HackerNews / `awesome-mcp-servers` PR for v1 (per JK playbook — distribution channels handle discovery passively)

## Success criteria

- Published to npm + MCP Registry within 3 days of starting Day 1 (matches JK's actual experience)
- Visible on Smithery + Glama within 10 days of publish
- Server runs successfully from Claude Code + Claude Desktop + Cursor on the user's own machine (cross-client smoke test)
- `patent_search_dossier` works end-to-end for a known patent in ≤45 seconds with credits correctly deducted
- ≥1 distinct API key created from the extension Admin tab with the `psg_live_` prefix actually called by the MCP server within 2 weeks

## Risks

- **Dossier endpoint latency** — `patent_search_dossier` can run 20-45s on cold fetches. Some MCP clients may show "tool running" with no progress. Mitigation: clear stderr message at start ("Fetching dossier for US...; can take up to 60 seconds"). Document the latency in the README.
- **Google Patents rate limiting at higher MCP volume** — already mitigated in `googlePatentsEnrich.ts` with retry-with-backoff. Document `429` mapping (Retry-After header) so the LLM can wait.
- **API key leak via logs** — never log the key, redact in errors. Document in README that users should revoke from Admin tab if they accidentally commit `mcp.json`.
- **Cost spike from a runaway agent loop** — per-key rate limit (60/min, 1000/day) from PLAN-PUBLIC-API.md Day 1 catches this. Dossier at 3 credits × 1000/day = 3k credits/day per key max — bounded.
- **Patent attorneys aren't MCP-aware** — true. The MCP server is distribution to early-adopter / power-user patent pros (likely <1k people initially). The forcing-function value (hardening the API, getting one real external consumer) is the primary justification, not direct revenue.

## What this enables next

Once the v1 API is live and the MCP server is shipping, the natural extension surfaces are (in solo-dev order):

1. **Notion integration** — uses the same API key. Unlisted OAuth app for solo dev; listed later. Notion is a credible workflow surface for patent attorneys maintaining case notes.
2. **Self-distributed Slack app** — unlisted via Public Distribution mode (same pattern as MarkItUp's Slack work). Defer the Slack Marketplace listing (6-12 weeks externally gated) until validated demand.
3. **W1-W4 Workflow agents** — once Claude Agent SDK is wired into `functions/`, the SAME MCP tools can be consumed internally by the agents. Single source of truth, no duplicate logic.

Externally-gated surfaces from `docs/PORTFOLIO-INTEGRATION-RESEARCH-2026-05-21.md` (Microsoft Word add-in, Canva, PatSnap, Westlaw) stay deferred per the solo-dev playbook — they require marketplace review cycles and/or enterprise sales that aren't solo-deployable.

## Related

- [PLAN-PUBLIC-API.md](./PLAN-PUBLIC-API.md) — hard dependency (Day 1 must ship first)
- `feedback_mcp_cloning_strategy.md` — three-tier cloning rule
- `C:\Projects\MarkItUp\planning\PLAN-MCP-SERVER.md` — source playbook
- `C:\Projects\MarkItUp\mcp-server\` — Tier-2 clone source (full folder)
- `C:\Projects\JackpotKeywords\mcp-server\` — second working instance (proves scaffold clones cleanly to a different project)
- `../docs/PORTFOLIO-INTEGRATION-RESEARCH-2026-05-21.md` — broader surface inventory (this MCP server is item #1)
- `../AGENT_SDK.md` — internal MCP tools for Agent SDK; converges with this server's tool definitions
- `../ROADMAP.md` — fits between Phase 2.5 (USPTO ODP, complete) and Phase 2.7 (Tier 2 dossier + workflows)
