# Patent-Search Generator MCP — Solve Intelligence comparison & tool roadmap (2026-06-05)

Created after reviewing Solve Intelligence's Claude connector and auditing the Bull-Generator
codebase. Companion to `CONNECTOR-DIRECTORY-PLAYBOOK-2026-06-05.md` (how to ship the connector)
and `PLAN-CLAUDE-CONNECTOR.md`.

## Competitor: Solve Intelligence Claude connector (Claude-MCP only)
- 9 tools, all **search / retrieval + a legal corpus**: `search_patents`, `get_patent_content`,
  `search_npl` (non-patent literature), `lookup_patent_search_entities`, patent **law &
  standards** corpus (`list/read/search/grep_patent_law_and_standards`),
  `get_patent_search_guidance`. Connector URL `api.solveintelligence.com/mcp/`.
- Enterprise patent-drafting platform ("Patent Copilot"); MCP requires a paid Solve account
  (OAuth sign-in). Positioning: search, draft, chart patents; prior art / infringement / legal
  research / claim-to-standard mapping.

## Key contrast (opposite of the JackpotKeywords vs Ahrefs case)
Against Ahrefs, JK was outgunned. Against Solve, **Bull-Generator is the MORE differentiated
product on the analysis axis** — Solve's 9 tools are search/retrieval; BG has a deep
analysis/generation backend Solve doesn't expose. BG's gap is simply that **no MCP connector
is built yet** (only `PLAN-CLAUDE-CONNECTOR.md`; no `mcp.ts`). `index.ts` exports `ai`
(dispatcher), `eou`, `stripeWebhook`, `slackBot`.

## What Solve has that BG lacks (don't chase — Solve's data moat)
- `search_npl` (non-patent literature). BG: none.
- Patent **law / case-law / SEP-standards corpus** (list/read/search/grep). BG has litigation/
  challenge *signals* via `legalBundle`, NOT a searchable legal corpus. Skip.
- `get_patent_search_guidance` — cheap to add if wanted.

## What BG has that Solve does NOT ⭐ (the wedge — analysis & generation)
| Capability | Handler |
|---|---|
| CPC suggestion from a description (the "generator") | `cpcSuggest.ts` `handleCpcSuggestRequest` |
| Examiner statistics (allowance rates / timelines) ⭐ | `examinerStats.ts` `handleExaminerStatsRequest` |
| Office-action analysis ⭐ | `officeActionAnalyzer.ts` `handleOfficeActionAnalysisRequest` |
| Claim charts (standalone) | `claimChart.ts` `handleStandaloneClaimChartRequest` |
| Evidence-of-Use / infringement | `eou.ts` `handleEouRequest`, `eouAi.ts` decompose/evaluate |
| Patent Risk Profile (LIVE, ~8s sync) ⭐ | `odp/riskProfile.ts` |
| Prosecution history (USPTO ODP) | `usptoOdp.ts` `handleProsecutionHistoryRequest`/`handleOdpDocumentRequest` |
| Freedom-to-Operate pipeline (async 4–15 min) | `fto/*` (`runFtoPipeline`, stage1/stage2) |
| Legal bundle (litigation/challenges/active status) | `odp/legalBundle.ts` |
| Patent search execute + query builder | `searchExecute.ts` |
| Get patent content | `eouPatent.ts` `handlePatentFetch` |
| CPC lookup | `cpc.ts` `handleCpcRequest` |

## ⚠️ Critical constraint — sync vs async (from research/workflows-feature-ranking-2026-06-03.md)
- **Synchronous (MCP-friendly):** Risk Profile (~8s), search, get_patent, cpc, cpcSuggest,
  examiner_stats, prosecution_history, office_action (verify each returns within the client
  timeout, ~30–60s).
- **Async (4–15 min) — DO NOT expose as plain MCP tools:** Freedom-to-Operate, Prior Art
  Hunter (Agent-SDK loop), Claim Analyzer, Landscape. They time out a stateless tool call.
  Defer, or wrap in a job-create + poll pattern (extra infra) later.

## Recommended INITIAL connector tool set (all sync; leans into Solve's gaps)
1. `search_patents` (`searchExecute`) — table stakes
2. `get_patent` (`handlePatentFetch`) = Solve `get_patent_content`
3. `suggest_cpc` (`cpcSuggest`) ⭐ — describe→classification/search generator angle
4. `examiner_stats` (`examinerStats`) ⭐ — Solve has nothing like it
5. `analyze_office_action` (`officeActionAnalyzer`) ⭐
6. `patent_risk_profile` (`riskProfile`) ⭐ — already live, ~8s
7. `prosecution_history` (`usptoOdp`)
8. `lookup_cpc` (`cpc`) + `get_patent_search_guidance` (cheap adds)
9. (verify timeout, then) `generate_claim_chart` (`claimChart` standalone), `evidence_of_use` (`eou`)

Annotate all with `title` + `readOnlyHint` (search/fetch/stats/analysis are read-only).

## Build sequence
1. Build the remote MCP endpoint (`functions/`, Streamable HTTP) — there is none yet. Reuse the
   GovToolsPro/JK pattern from the playbook (auth-at-connect, jose-free WorkOS OAuth, PRM,
   annotations). Wrap the existing `handle*Request` functions via a synthetic req/res adapter.
2. Ship the initial sync tool set above (≈8–10 tools) — already strong vs Solve.
3. WorkOS Phase 0 + `*.authkit.app` OAuth; serve at a brand domain or `*.web.app/api/mcp`
   (per the playbook — custom domain optional). Privacy policy exists
   (`patent-search-privacy-policy.html`); confirm a live ToS.
4. Later: job+poll for FTO / Prior Art Hunter; consider `search_npl`/legal corpus only if a
   data source is acquired.

## Wedge
BG = **patent analysis & generation** (examiner intel, office-action help, risk profile, claim
charts, EoU, CPC-from-description) — the prosecution/analysis side Solve under-serves — plus
cheaper access (RapidAPI-listed). Don't chase Solve's NPL/legal-corpus data moat.
