# Claude Connector Directory — Submission Form Answers (prepped 2026-06-07)

Every answer prepped against JK's verbatim question bank
(`C:/Projects/JackpotKeywords/docs/api-deployment/MCP-DIRECTORY-FORM-QUESTIONS-2026-06-07.md`)
+ the playbook §2 walkthrough. Form: `clau.de/mcp-directory-submission` (REMOTE form, 6 pages).
⚠️ Capture Page 1 verbatim during submission (JK didn't).

## Page 1 — Company + Server details

- **Company name:** [MICHAEL — as used for GovToolsPro/JK submissions]
- **Company URL:** `https://smythmyke.github.io/Bull-Generator/`
- **Contact:** smythmyke@gmail.com
- **Server name** (no "MCP"/"Server"): `AI Patent Search Generator`
- **Universal URL:** `https://patent-search-generator.web.app`
- **MCP Server URL:** `https://patent-search-generator.web.app/api/mcp`
- **Tagline** (≤55 chars, 53): `US patent intelligence: dossiers, PTAB, litigation`
- **Description** (50–100 words, ~75):
  > Raw USPTO patent intelligence inside Claude. Look up any US patent's full
  > dossier (bibliography, claims, citations, family), prosecution history,
  > PTAB validity challenges with outcomes, district-court litigation history,
  > ownership chain of title, legal status, and examiner statistics — all
  > fetched live from USPTO Open Data and rendered for chat. A one-shot AI
  > risk profile aggregates the full legal record into a Low/Moderate/High
  > verdict for due-diligence work. Built for patent attorneys, agents,
  > searchers, and inventors.
- **Use cases (≥3, with example prompts):**
  1. Validity/challenge screening — "Has US8724622B2 been challenged at the
     PTAB, and did it survive?"
  2. Due diligence on a patent acquisition — "Run a risk profile on
     US10867416B2 — is it in force, who owns it, any litigation?"
  3. Claim scope review — "Pull the independent claims of US10867416B2 and
     summarize what they cover."
  4. Prosecution strategy — "What's the allowance rate of the examiner who
     handled US10867416B2, and what rejections came up during prosecution?"
- **Connection requirements:** OAuth 2.0 sign-in by email one-time code
  (WorkOS AuthKit Magic Auth); account auto-created on first sign-in with free
  starter credits.
- **Read/Write:** **Read Only** (all 10 tools readOnlyHint: true)
- **MCP App?:** No
- **Third-party connections:** tick **Third-party data retrieval** — USPTO
  Open Data Portal (file wrappers, PTAB trials, assignments, legal status),
  USPTO Patent Litigation Dataset (pre-ingested). Google Gemini is used
  server-side for the risk_profile AI verdict. (RapidAPI is a separate sales
  channel for the same backend, not a data source the connector retrieves
  from — do not list as a data connection.)
- **Data handling:** Verified email → account mapping; tool-call inputs
  (patent numbers/parameters) processed by the same backend as the Chrome
  extension; no conversation content received. Privacy policy §4.2.
- **Categories** (fixed list has no Legal/IP): **Other: Legal / IP**
  (fallback: Business & Productivity)
- **Sponsored content/ads:** No, there is no sponsored content or advertisements

## Page 2 — Authentication

- **Authentication Type:** OAuth 2.0
- **Auth Client:** Dynamic OAuth Client (DCR/CIMD)
- **Static Client ID/Secret:** blank
- **Transport Support:** **Streamable HTTP only** (do not tick SSE)

## Page 3 — Documentation & support

- **Docs link:** `https://patent-search-generator.web.app/` (setup + tool
  table + troubleshooting + coverage notes)
- **Privacy Policy:** `https://patent-search-generator.web.app/privacy.html`
- **DPA URL:** blank
- **Support channel:** `smythmyke@gmail.com`
- (ToS — required live by final checklist: `https://patent-search-generator.web.app/terms.html` ✅)

## Page 4 — Test Account Access

- **Credentials:** `mcp-review@anthropic.com` — no password (Magic Auth
  one-time email code; reviewers control that inbox; no 2FA). Pre-seeded
  **500 credits** via `functions/scripts/seed-reviewer.js` (run BEFORE
  submission — covers ~12 risk profiles or ~150 dossiers).
- **Test Account Server URL:** blank (same as main)
- **Setup instructions (paste):**
  1. In Claude, add the connector: Settings → Connectors → Add custom
     connector → URL `https://patent-search-generator.web.app/api/mcp` (OAuth
     fields blank) → Add.
  2. Sign in with mcp-review@anthropic.com — a one-time code is emailed; no
     password or 2FA.
  3. In a conversation, enable "AI Patent Search Generator" in the tools menu
     near the message box, then ask a patent question.
  - Example prompts (real, populated data):
    - "Has US8724622B2 been challenged at the PTAB? Did it survive?" (15
      challenges on record)
    - "Who has been sued over US8724622B2?" (31 district-court suits)
    - "Pull the dossier for US10867416B2 and summarize the claims." (Adobe
      deep-learning patent)
    - "Is US10867416B2 still in force and who owns it?"
    - "Run a risk profile on US10867416B2." (40 credits; account is seeded)
  - Note: dossier/claims/risk_profile cache for 24h — repeat calls are free.
- **Test Data Availability:** ✅ sample data (live USPTO records); ✅ all
  tools testable

## Page 5 — Server Technical Details

- **Tool list (comma-separated, `tool_name (Human Title)`):**
  `dossier (Patent Dossier), claims (Patent Claims), prosecution (Prosecution
  History), challenges (PTAB Challenges), litigation (Patent Litigation),
  examiner (Examiner Statistics), assignments (Patent Assignments),
  legal_status (Legal Status), risk_profile (Patent Risk Profile (AI)),
  balance (Credit Balance)`
- **Titles & annotations:** ✅ both (every tool has title + readOnlyHint/
  destructiveHint/openWorldHint/idempotentHint)
- **Resources / Prompts:** blank (none)

## Page 5b — Launch Readiness & Media

- **GA date:** blank (already live)
- **Surfaces tested:** Claude.ai (web) ✅ [+ Claude Code if tested]
- **Server Logo:** Drive link to `connector-site/logo.png` (128×128 PNG —
  PNG accepted for GovToolsPro/JK despite the SVG ask). [MICHAEL: upload to
  Drive, paste link]
- **Server Logo URL / favicon check:** ⚠️ as of 2026-06-07 Google s2
  (`google.com/s2/favicons?domain=patent-search-generator.web.app&sz=64`)
  still 404s — the domain is new and the cache lags days. Favicon went live
  2026-06-07. Either wait until s2 shows the real mark before submitting, or
  tick + disclose "favicon recently deployed, s2 cache refreshing" in
  Additional Information (JK's approach).
- **Promotional images:** 3–5 PNGs ≥1000px wide, cropped to the response
  only, captured at 125–150% browser zoom. Suggested shots from the test
  prompts: (1) PTAB challenges table for US8724622B2, (2) dossier summary for
  US10867416B2, (3) risk profile verdict, (4) litigation history, (5)
  examiner stats. Pair each with its prompt in `prompts.txt`. [MICHAEL:
  capture from your live session, upload to Drive folder with logo]
- **Promotional materials link:** same Drive folder; note "prompts.txt pairs
  each screenshot with its prompt text."

## Page 6 — Skills & final checklist

- **Skill Name:** `Patent Research Workflow`
- **Skill Description:** Drives the AI Patent Search Generator connector tools
  in the right order (free lookups → dossier → AI risk profile) to turn a US
  patent number into synthesized legal intelligence.
- **GitHub URL:** `https://github.com/smythmyke/patent-search-mcp-server/tree/main/skills/patent-research-workflow`
  (⚠️ push `mcp-server/skills/patent-research-workflow/SKILL.md` to the public
  repo BEFORE submitting)
- **Related Plugins:** blank

- **Policy Compliance:** all true — read-only lookups; no cross-service
  automation; no financial transactions; live in production; we own the
  backend.
- **Technical Requirements:** all true — OAuth on all tools; annotations on
  all tools; HTTPS; CORS configured (`cors({origin:true})`); tested on
  Claude.ai (2026-06-07, logs show initialize/tools-list/tools-call auth=ok).
- **Documentation Requirements:** all true — docs/privacy/ToS live (links
  above).
- **Testing Requirements:** seed reviewer + verify before ticking; creds valid
  ≥30 days (no expiry on Magic Auth); post-submit freeze ≥30 days (no WorkOS
  config changes, reviewer account stays seeded).
- **Additional Information (free text):** favicon s2-cache disclosure (if
  applicable) + cost note: "Test account is pre-seeded with 500 credits. Five
  tools are free; dossier costs 3 credits (fresh fetch, 24h cache free),
  claims 1, litigation 2, examiner 2, risk_profile 40 (fresh, 24h cache
  free). Failed operations are not charged."

## Pre-submission checklist (do in order)

1. [ ] Run `node functions/scripts/seed-reviewer.js` (needs Michael's OK —
       creates the reviewer account + 500 credits)
2. [ ] Verify reviewer sign-in works end-to-end (optional dry run: add the
       connector in a fresh Claude profile using a personal email first — done
       2026-06-07 with Michael's account)
3. [ ] Push SKILL.md to the public patent-search-mcp-server repo
4. [ ] Upload logo + screenshots + prompts.txt to a Drive folder (public link)
5. [ ] Check s2 favicon; decide wait-vs-disclose
6. [ ] Fill the form from this doc; capture Page 1 questions verbatim into
       JK's question-bank doc
7. [ ] Submit; start the ≥30-day freeze
