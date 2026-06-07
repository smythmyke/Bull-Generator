# Claude Connector Directory — Playbook (proven on GovToolsPro, 2026-06-05)

**Status of this doc:** GovToolsPro was taken end-to-end into the Claude Connector
Directory on 2026-06-05 (submitted, in review). This captures the proven sequence, the
corrections to earlier assumptions, the full submission-form walkthrough, the gotchas, and
the **patent-search (Bull-Generator)-specific to-do list**. A fresh session should be able
to ship this connector from this doc alone. Companions: `PLAN-CLAUDE-CONNECTOR.md` and the
GovToolsPro/JackpotKeywords runbook (technical OAuth/MCP code reference).

---

## 0. The big corrections (read first)

1. **A custom domain is NOT required to ship.** Production WorkOS AuthKit works on the free
   `*.authkit.app` domain — GovToolsPro ran end-to-end on it before any custom domain. OAuth
   on `*.authkit.app` is fine; custom `auth.<domain>` is optional/branding. The MCP endpoint
   can be served on a `*.web.app` URL via a Firebase Hosting rewrite if there's no custom domain.

2. **`*.web.app` DNS is NOT controllable** (Google owns the `web.app` zone). "Controlling CNAME"
   needs a registered domain at a registrar. You don't need DNS control to *use* a `*.web.app`
   URL as-is.

3. **DECIDE THE DOMAIN FIRST for patent-search.** The connector URL is currently a raw
   `…cloudfunctions.net` / possibly `*.web.app` URL. A raw `cloudfunctions.net` URL looks
   unprofessional in the listing (review criteria: "server domain should align with your
   service"). Two acceptable paths: (a) **ship on `*.web.app/api/mcp`** ($0, looks like a normal
   site to users — JackpotKeywords took this path), or (b) **buy/point a real domain** (e.g.
   `patentsearch…` ) → `mcp.<domain>/api/mcp`. Confirm what domain this project controls before
   choosing. (Bull-Generator already has marketing HTML + `patent-search-privacy-policy.html`, so
   a real domain may already exist — verify.)

---

## 1. Proven build sequence (what worked for GovToolsPro)

Remote connector = stateless hand-rolled JSON-RPC-over-HTTP (CommonJS — MCP SDK is ESM and
fights Cloud Functions). Copy `mcpOAuth` + `mcp` transport from the runbook.

1. **Remote MCP endpoint** — Streamable HTTP wrapping existing tool handlers via a synthetic
   req/res adapter. Mount at `/api/mcp`.
2. **Auth at CONNECT** ⭐ — **401 + `WWW-Authenticate: Bearer resource_metadata="…"`** on EVERY
   unauthenticated POST **including `initialize`**.
3. **OAuth verify** — jose-free `node:crypto` JWKS; iss/exp/signature; issuer from
   `WORKOS_AUTHKIT_DOMAIN`; JWKS `…/oauth2/jwks`. Audience log-and-allow.
4. **PRM** — RFC 9728 at `<mcp>/.well-known/oauth-protected-resource`; advertise in the 401.
5. **Tool annotations** — `title` + `readOnlyHint`/`destructiveHint` on every tool. **#1 rejection
   cause.** Patent lookups are read-only (`readOnlyHint: true`); split any write tool out.
6. **Email identity** — verified email → customer record, keyless; fallback lookup via
   `GET https://api.workos.com/user_management/users/{sub}` with `Bearer WORKOS_API_KEY`.

### WorkOS Phase 0 (dashboard, ~15 min — USER)
- Applications → Client ID; API Keys → secret (`sk_<base64>`). AuthKit domain = issuer.
- **Connect → Configuration → enable DCR + CIMD** (scopes `openid profile email`) — per-env; the
  toggle is what fixes "Couldn't register".
- Hand back `WORKOS_CLIENT_ID`, `WORKOS_API_KEY`, `WORKOS_AUTHKIT_DOMAIN` (gitignored `.env`).

### Deploy + verify
- Firebase Hosting rewrite `/api/mcp` + `/api/mcp/**` → the MCP function (⚠️ need BOTH the exact
  path and the glob). On a custom domain if you have one, else on the `*.web.app` host.
- Deploy the **whole functions codebase** (not a single function).
- Verify: PRM 200; unauth `initialize` 401 + `WWW-Authenticate`; JWKS reachable; connect + call.

---

## 2. Submission form walkthrough — `clau.de/mcp-directory-submission` (6 pages)

REMOTE form (local MCPB `.mcpb` uses a different form).

**Page 1 — Company + Server details:** company name/URL/contact; server name (no "MCP"/"Server");
Universal URL + `/api/mcp` URL; tagline ≤55; description 50–100 words; ≥3 use cases w/ example
prompts; connection requirements; **Read/Write** (patent lookups = Read Only); MCP App? No (unless
interactive UI); third-party connections (tick "Third-party data retrieval" if it aggregates USPTO/
PTAB/etc.; NOTE patent-search also uses RapidAPI/`rapidapi.ts` — disclose accordingly); data
handling; **Categories** (no "Legal/IP" bucket → **Other: Legal / IP** or closest); ads? No.

**Page 2 — Authentication:** OAuth 2.0; Dynamic client (DCR/CIMD); Streamable HTTP.

**Page 3 — Docs & support:** docs link (setup + tool descriptions + troubleshooting); privacy
policy URL (you already have `patent-search-privacy-policy.html` — confirm its live URL); DPA
(optional); support channel.

**Page 4 — Test account (blocks review):** login email **`mcp-review@anthropic.com`** (reviewers
control the inbox; AuthKit one-time code; no 2FA). ⚠️ AuthKit must allow self-signup. Pre-seed
credits if metered. Setup steps + example prompts (use a real patent/CPC for populated output).
List tools as `tool_name (Human Title)`; confirm titles + annotations.

**Page 5 — Launch readiness & media:** GA date (blank if live); surfaces tested (Claude.ai web);
square 1:1 logo (hosted/Drive); favicon via `google.com/s2/favicons?domain=<MCP-URL-domain>` (serve
`/favicon.ico` + `<link rel="icon">`; cache lags); 3–5 promo PNGs ≥1000px cropped to the response.

**Page 6 — Skills/Plugins (optional) + final checklist:** optional SKILL.md via GitHub URL; final
checklist (policy/technical/docs/testing). **Privacy policy AND ToS must be live.**

---

## 3. Gotchas / hard-won lessons
- Favicon is fetched from the **MCP-URL domain** via Google's `s2/favicons` (caches hard) — serve
  `/favicon.ico` + `<link rel="icon">` in that host's root HTML.
- Logo & favicon = the same real mark (favicon shows on every tool call).
- If metered with refund-on-failure: empty-result guard must test real data presence, not array
  `.length` (GovToolsPro shipped + fixed this billing bug).
- Reviewer credit seeding: grant script must create-the-doc-if-missing.
- Category mismatch is normal — pick closest or Other.
- ⚠️ **No raw third-party data passthrough** if your data agreements forbid it (GovToolsPro's
  ToS rule); value-add/AI tools only. Patent-search should expose synthesized lookups (dossier/
  prosecution/PTAB/examiner/claims), consistent with its USPTO-data terms.
- Two valid directories: remote connector (this form) + local MCPB (`.mcpb`, separate form).

---

## 4. patent-search (Bull-Generator) — specifics & TO-DO

**Current state (from repo scan):**
- Backend: `functions/` (`functions/src/index.ts`, `cpc.ts`, `cpcSuggest.ts`, `odp/riskProfile.ts`,
  `odp/legalBundle.ts`, `ai.ts`, `rapidapi.ts`). Also on **RapidAPI** (`rapidapi.ts`).
- Marketing site HTML present (`index.html`, `developers.html`, `legal-intelligence.html`,
  `due-diligence.html`) + **`patent-search-privacy-policy.html`** (privacy policy exists).
- Category wedge: Legal / IP — raw USPTO data lookups (dossier/prosecution/PTAB/examiner/claims)
  vs drafting tools.

**TO-DO (in order):**
1. **Determine the domain** — does this project control a real domain (where the marketing HTML is
   served), or is it on raw CF / `*.web.app`? Decide: ship on `*.web.app/api/mcp` ($0) or
   `mcp.<domain>/api/mcp` (if a domain is controlled). See §0.3.
2. **Confirm/add the remote MCP endpoint** in `functions/` (Streamable HTTP wrapping the patent
   tools). Enumerate the exact tool list (cpc, cpcSuggest, riskProfile, legalBundle, …) — all
   read-only.
3. **WorkOS Phase 0** (dashboard) — app, DCR+CIMD, 3 env values. `*.authkit.app` is fine.
4. **Wire OAuth** (node:crypto JWKS + PRM + auth-at-connect) + **tool annotations** (`readOnlyHint:
   true` across the board).
5. **Hosting rewrite** `/api/mcp` (+ `/api/mcp/**`) → the MCP function on the chosen host. Deploy
   whole codebase.
6. **Verify** in Claude (connect → OAuth → call a tool).
7. **Submission assets**: privacy policy URL (you have the page — confirm live HTTPS URL); **ToS**
   (confirm a live ToS exists — may need to add one); docs link (setup + tools + troubleshooting);
   square logo; favicon on the MCP host; 3–5 promo screenshots ≥1000px (use a real patent/CPC);
   reviewer test account `mcp-review@anthropic.com` (seed credits if metered); category **Other:
   Legal / IP**.
8. **Submit** the remote form.

**Open questions:** what domain (if any) this controls; exact tool list + which are metered;
whether ToS is published (privacy already is); whether `mcp.ts`/`mcpOAuth.ts` already exist in
`functions/`; how RapidAPI usage should be disclosed on the third-party-connections question.
