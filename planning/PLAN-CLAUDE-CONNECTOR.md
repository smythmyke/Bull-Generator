# PLAN — Patent Search Claude Connector (Remote MCP + WorkOS OAuth)

**Goal:** list `patent-search-mcp-server` in the **Claude Connector Directory** (+ OpenAI Apps). Strong fit — **legal/IP researchers live in Claude**, and patent search is a **thin, high-value category** in the directory → high share-of-voice when a prior-art / dossier / legal-status query fires (suggestions are relevance-based + ad-free, so you compete on fit, not budget).

**Replication of the JackpotKeywords pilot (proven end-to-end via Claude 2026-06-03).** Full gotchas + reference impl: `C:/Projects/JackpotKeywords/docs/api-deployment/CLAUDE-CONNECTOR-REPLICATION-RUNBOOK.md`. Copy `mcp.ts` + `mcpOAuth.ts`; only the tools + env differ.

## Readiness: build/test-ready, public-blocked on a custom domain (same as JK)
- ✅ Backend exists: `functions/` on `solicitation-matcher-extension` → can host the remote MCP endpoint (direct CF URL `…/ai/...`, same pattern as the existing `/ai/v1` API).
- ✅ Privacy policy already exists (`patent-search-privacy-policy.html`).
- ✅ 11 tools, all **read-only** (USPTO/Google Patents lookups + Boolean-query generation) — clean annotation story.
- ⚠️ **No custom domain** — uses the raw `solicitation-matcher-extension.cloudfunctions.net` URL. **Production WorkOS AuthKit requires a custom domain via CNAME**, so going *public* is blocked until patent-search has a DNS-controllable domain (exactly like JK; unlike MarkItUp/`markitup.app` + GovToolsPro/`govtoolspro.com`). **Staging works fully for build + test now.**

## Build steps (~half day, copy from JK)
1. **Remote MCP transport** — add `mcp.ts` to `functions/` (stateless hand-rolled JSON-RPC over HTTP; CommonJS-safe). Wrap the same 11 tools + existing API client; only transport changes (stdio → Streamable HTTP). Expose at the **direct CF URL** (the hosting rewrite is inert in prod — see the cross-project hosting tangle below).
2. **OAuth verification** — copy JK's `mcpOAuth.ts` verbatim (jose-free `node:crypto` JWKS verification, RFC 9728 PRM, WorkOS email lookup, fetch timeouts). Map verified email → patent-search customer (keyless get-or-create).
3. **ANNOT-1** — `readOnlyHint: true` + `openWorldHint: true` on all 11 tools (none destructive). Mirror into `.mcpb`/Glama manifests.
4. **Auth at CONNECT** ⭐ — 401 + `WWW-Authenticate: Bearer resource_metadata="…"` on EVERY unauthenticated JSON-RPC POST incl. `initialize` (anonymous initialize = client connects without OAuth and never logs in; tell-tale = "Disconnect" greyed out).
5. Serve RFC 9728 PRM at `<mcp>/.well-known/oauth-protected-resource`.

## ⚠️ Cross-project hosting tangle
`solicitation-matcher-extension` also serves **GovToolsPro production**. Add the remote MCP endpoint behind the **direct Cloud Function URL** (never the inert `/api/v1/**` hosting rewrite), and deploy `functions` carefully so you don't disrupt GovToolsPro prod. See `feedback_cross_project_hosting_tangle.md`.

## WorkOS Phase 0 (~15 min)
Staging: **Applications → Create application** (Client ID); **API Keys** (secret); **Domains → AuthKit** card (Staging auto-gen `*.authkit.app`); **Connect → Configuration → enable DCR + CIMD** (scopes `openid profile email`; per-env, the toggle is what fixes "Couldn't register" even though `/oauth2/register` is always advertised). Env: `WORKOS_CLIENT_ID`, `WORKOS_API_KEY`, `WORKOS_AUTHKIT_DOMAIN`.

## Test + (when a domain exists) submit
Claude → Customize → Connectors → "+" → Name + Remote MCP URL → leave OAuth blank (DCR self-registers) → Add → WorkOS login → **toggle ON per-conversation** → call a tool. Success log: `initialize bearer=false→401`, `PRM fetched`, `initialize bearer=true auth=ok`, `tools/call auth=ok`. **Public submission** needs a custom domain (→ production AuthKit CNAME) + production-ready status.

## Cross-refs
JK runbook (canonical) + `mcpOAuth.ts`/`mcp.ts`. Portfolio tracker: `C:/Projects/MarkItUp/planning/MCP-DISTRIBUTION-SURFACES.md`. Note: patent-search is also the portfolio's **strongest x402 candidate** (autonomous legal-research agents) — separate track, see ROADMAP X402-1.
