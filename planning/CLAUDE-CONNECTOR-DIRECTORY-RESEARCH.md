# Claude Connector Directory — Portfolio Research & Plan (2026-06-03)

Shared, neutral research for all four portfolio MCPs — **JackpotKeywords, MarkItUp, patent-search, GovToolsPro** — which are **all shipping** to the Claude Connector Directory (+ OpenAI Apps). Each repo's own `PLAN-CLAUDE-CONNECTOR.md` / `CLAUDE-CONNECTOR-PLAN.md` holds the project-specific build steps + tool annotations. Shared technical reference (the remote-MCP + OAuth pattern, validated end-to-end against Claude 2026-06-03): `JackpotKeywords/docs/api-deployment/CLAUDE-CONNECTOR-REPLICATION-RUNBOOK.md` — copy `mcpOAuth.ts` + `mcp.ts` verbatim.

## 1. How discovery works
- Connectors live in Claude's unified Directory (Customize → Connectors); users browse/search by category or add a custom URL.
- **Suggested Connectors:** directory connectors are eligible for **in-chat recommendations when relevant to a user's task** — a user who's never heard of the tool can be recommended it. **Ad-free, relevance-based, no paid placement.**
- After connecting, Claude **auto-invokes** the tools when relevant (the user doesn't name them).
- **Implication:** you compete on FIT, not budget. Tool names/descriptions ARE the relevance signal that triggers suggestions — write them for the specific intent you serve.

## 2. Published stats (and what isn't)
- Claude **~30M MAU**; Directory **~418 connectors / 30 categories** (updated 2026-05-28); 25B+ API calls/mo (mostly enterprise/API). Connectors on Pro ($20)/Max/Team/Enterprise + consumer connectors on all plans.
- **Not published:** per-connector installs, monthly tool-call volume, "top tools" leaderboards; no partner has disclosed numbers. → The only ground-truth exposure data is your **own `source:'mcp'` tool-call attribution after listing. Measure, don't project.**

## 3. Competitive landscape — every category already has incumbents
| Project | Directory category | Incumbents already listed | Differentiated wedge (win a narrower intent) |
|---|---|---|---|
| JackpotKeywords | SEO & Web | Ahrefs (official), Semrush, AirOps | Real Google Ads data, AI keywords from a plain description, AEO scan, low price |
| patent-search | Legal / IP | Solve Intelligence, CourtListener, 20+ Anthropic legal connectors | Raw USPTO data lookups (dossier/prosecution/PTAB/examiner/claims) vs drafting |
| GovToolsPro | Government & Nonprofit | GovTribe, Tango, CLEATUS | Value-add/AI workflow tools (never raw SAM/FPDS passthrough — ToS) |
| MarkItUp | Design & Creative | Adobe, Canva, Figma, Sketch | Lightweight in-chat image annotation |

**Read:** no empty rooms. Because suggestions are relevance-based, you win by being the best match for a narrower intent than the incumbent — so differentiation clarity in the tool descriptions matters more than category position.

## 4. Readiness matrix (all four shipping)
| Project | Backend for remote MCP | Owns a domain (prod AuthKit = custom-domain CNAME) | Status |
|---|---|---|---|
| MarkItUp | ✅ `functions/` | ✅ `markitup.app` | Build + go public |
| GovToolsPro | ✅ backend (`mcp.govtoolspro.com`) | ✅ `govtoolspro.com` | Build (in backend) + go public |
| JackpotKeywords | ✅ (pattern validated live) | ❌ `*.web.app` | Build/test on staging; public after a custom domain |
| patent-search | ✅ `functions/` (solicitation-matcher-extension) | ❌ raw CF URL | Build/test on staging; public after a custom domain |

Production AuthKit needs a **custom-domain CNAME** (no default `authkit.app` in prod). Domain-owning projects can go public immediately; the other two build + test on staging now and go public once they have a DNS-controllable domain.

## 5. Shared build pattern (identical for all four)
1. **Remote MCP** — stateless hand-rolled JSON-RPC over HTTP in the project's backend (CommonJS-safe; SDK is ESM). Wrap the project's existing tools + API client; only the transport changes (stdio → Streamable HTTP).
2. **Auth at CONNECT** ⭐ — 401 + `WWW-Authenticate: Bearer resource_metadata="…"` on EVERY unauthenticated POST incl. `initialize` (anonymous initialize = client connects without OAuth and never logs in; tell-tale = "Disconnect" greyed out).
3. **WorkOS AuthKit OAuth** — verify RS256 JWTs with `node:crypto` against JWKS (jose-free), check iss/exp/signature, map verified email → customer (keyless). Serve RFC 9728 PRM. Add fetch timeouts.
4. **WorkOS Phase 0 (~15 min):** Applications→Client ID; API Keys→secret; Domains→AuthKit domain; **Connect → Configuration → enable DCR + CIMD** (scopes `openid profile email`) — per-environment; the toggle is what fixes "Couldn't register" (the `/oauth2/register` endpoint shows in metadata regardless).
5. **Tool annotations** — `readOnlyHint`/`destructiveHint`/`openWorldHint` (Claude sorts + matches on these; #1 rejection cause if missing).
6. Endpoint must be **public** (Claude calls from Anthropic's cloud); add request diagnostics (methods/bearer/auth logging) — they make the OAuth handshake debuggable in one glance.

## 6. Plan: ship all four
Each project, in parallel: copy the shared reference impl into its backend → wrap its own tools + ANNOT-1 → WorkOS Phase 0 → test on staging in Claude (toggle the connector on per-conversation) → go public (domain-owning projects now; the other two after a domain). Then **measure real `source:'mcp'` tool-call volume per project** and double down where it lands. No project is prioritized over another — each has its own category wedge (§3) and its own audience.

## Sources
- [Anthropic — Use connectors (Suggested Connectors, ad-free)](https://support.claude.com/en/articles/11176164-use-connectors-to-extend-claude-s-capabilities) · [Get started with custom connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)
- [Ahrefs Claude connector](https://claude.com/connectors/ahrefs) · [Anthropic 20+ legal connectors](https://www.lawnext.com/2026/05/anthropic-goes-all-in-on-legal-releasing-more-than-20-connectors-and-12-practice-area-plugins-for-claude.html) · [awesome-claude-connectors](https://github.com/rdmgator12/awesome-claude-connectors)
- [WorkOS AuthKit MCP](https://workos.com/docs/authkit/mcp) · [WorkOS custom domains](https://workos.com/docs/custom-domains/authkit) · [DemandSage — Claude stats](https://www.demandsage.com/claude-ai-statistics/)
