# MCP Registry Expansion — patent-search-mcp-server (Bull-Generator)

**Date:** 2026-05-26
**Status:** Planning — companion of MarkItUp's Phase 9

> **Cross-portfolio master doc:** `C:/Projects/MarkItUp/planning/MCP-DISTRIBUTION-SURFACES.md` is the single source of truth for every place a smythmyke MCP server is published. This patent-search-specific doc only covers the patent-search-side priority + action items. Always update the master doc when shipping a new release on any surface.

## Context

patent-search-mcp-server is live on Glama + Official MCP Registry + Smithery as of 2026-05-27. Research identified additional MCP directories worth evaluating. This doc captures registry data, patent-search-specific priority, and the action list.

Companion docs:
- `C:/Projects/MarkItUp/planning/MCP-REGISTRY-EXPANSION-2026-05-26.md`
- `C:/Projects/JackpotKeywords/docs/MCP-REGISTRY-EXPANSION-2026-05-26.md`
- `C:/Projects/GovToolsPro-extension/docs/MCP-REGISTRY-EXPANSION-2026-05-26.md`

## Current footprint for patent-search

| Registry | Status | Notes |
|---|---|---|
| Glama | ✅ Live | id `s2asd2jsh1`, Glama Release submitted, grades resolving |
| Official MCP Registry | ✅ Live | Published via `mcp-publisher` CLI |
| Smithery | ✅ Live as hosted .mcpb bundle | Published 2026-05-27 via `smithery mcp publish ./patent-search-mcp-server.mcpb -n smythmyke/patent-search-mcp-server`. **Initial external-URL publish failed** (Smithery tried to connect to GitHub as MCP endpoint — HTTP 422). Fixed by building a `.mcpb` bundle using `mcpb pack`. Latest deployment id: `20e5d23b-26e4-4f15-b05f-c5463840a00d` (status: SUCCESS). Hosted MCP URL: https://patent-search-mcp-server--smythmyke.run.tools. Listing: https://smithery.ai/servers/smythmyke/patent-search-mcp-server. Manual followup: change visibility from unlisted → public via the banner. |
| awesome-mcp-servers | ❌ Not submitted | Was in closed PR #6909; **Phase 7 reopens as solo PR in Legal section** (line 1736 in local fork) |
| Cursor Directory | ❌ Not submitted | |
| MCP.so | ❌ Not submitted | |
| Stacklok ToolHive | ❌ Not submitted | **Possible fit** — see priority section |
| MCP Market | ❌ Not submitted | Low value — skip |

Baseline: too new to have npm-download data (`n/a downloads/week` as of 2026-05-27).

## Registry data — May 2026

| Registry | Monthly traffic | Catalog size | Submission | Verdict |
|---|---|---|---|---|
| Smithery | **~446K visits** | 7,000–7,300 | Web form / auto-index | ⭐⭐⭐ Mandatory |
| Cursor Directory | High via cursor.com | 1,800+ | Form at `cursor.directory/plugins/new` | ⭐ marginal |
| MCP.so | Mid-tier SEO | 19,700–21,469 | GitHub Issue | ⭐⭐ Worth 5 min |
| awesome-mcp-servers | 88K ⭐ | Thousands | PR; ~1,300 backlog | ⭐⭐ Phase 7 |
| Stacklok ToolHive | Low direct, high enterprise signal | Small hand-curated | Security-vetted PR | ⭐⭐ for patent-search (legal/confidentiality angle) |
| MCP Market | Smaller than Smithery | 10K+ | Web form | Skip |
| Official MCP Registry | Low direct, propagates downstream | ~2,000 | `mcp-publisher` CLI | ⭐⭐⭐ Done |

## patent-search-specific priority

Patent intelligence + prior-art research. Audience: IP attorneys, patent agents, R&D engineers, examiners. **Niche but high-LTV** — being in *more* places matters because organic discovery is slow.

Key insight: legal-tech buyers care about **confidentiality** (attorney-client privilege, work product). That's the same vocabulary ToolHive sells to enterprise buyers. ToolHive submission has marginal but real signal value here — being listed alongside other security-vetted servers tells IP firms "we take confidentiality seriously."

| Registry | Priority | Why |
|---|---|---|
| Smithery | ⭐⭐⭐ | Largest funnel; submit |
| awesome-mcp-servers | ⭐⭐ | Legal section is a real category that legal-tech professionals check (Phase 7 work) |
| MCP.so | ⭐⭐ | Long-tail "patent MCP" SEO |
| Stacklok ToolHive | ⭐⭐ | Defer to GovToolsPro bundle (better than solo — see below) |
| Cursor Directory | ⭐ marginal | Patent professionals aren't IDE users; submit anyway |
| MCP Market | Skip | |

## Action list

1. ~~Verify Smithery listing~~ ✅ **Done 2026-05-27.** Live at https://smithery.ai/servers/smythmyke/patent-search-mcp-server. Config schema attached via second publish (`mcp-server/smithery-config-schema.json`).
2. **Open awesome-mcp-servers PR** — Legal section. Body already drafted. **Phase 7 of master plan.** (~10 min)
3. **Submit to MCP.so** — GitHub issue at `chatmcp/mcp-directory`. (~5 min)
4. **Defer Stacklok ToolHive** — bundle with GovToolsPro submission when that server is ready. Solo submission of patent-search might not pass ToolHive's vetting; bundled with a compliance-targeting peer it's stronger. See GovToolsPro plan doc.
5. **Cursor Directory** — last; low marginal value. (~5 min)
6. **Track impact** — install npm-download tracker once data exists; check 14 days post-launch.

## Templates ready to paste

**Glama-style condensed description (365 chars):**
> MCP server for the AI Patent Search Generator — 11 tools for patent intelligence: dossier (claims, citations, family, classifications, examiner stats), prosecution (USPTO file wrappers), oa_analyze (AI Office Action analysis), search/query (Google Patents multi-strategy), similar, citations, family, examiner, cpc, balance. Install: npx -y patent-search-mcp-server

**One-line for awesome-mcp-servers Legal section / MCP.so:**
> Patent intelligence and prior-art research for the AI Patent Search Generator. Eleven tools: full patent dossier, USPTO prosecution-history file wrappers, AI Office Action analysis, Boolean query generator, multi-strategy search (telescoping / onion-ring / faceted), similar-document ranking, citation graph, family lookup, and CPC classification lookup.

## Source data

- `smythmyke/patent-search-mcp-server` — standalone GitHub repo (created 2026-05-26)
- npm: `patent-search-mcp-server@0.1.0`
- MCP Registry: `io.github.smythmyke/patent-search-mcp-server`
- Glama: `https://glama.ai/mcp/servers/smythmyke/patent-search-mcp-server`
- GitHub Release: `v0.1.0` published 2026-05-27
