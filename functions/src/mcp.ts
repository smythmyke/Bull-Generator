/**
 * Remote MCP server for the Claude Connector Directory (+ OpenAI Apps).
 *
 * Streamable HTTP, STATELESS: each POST carries one JSON-RPC 2.0 message (or a
 * batch) and gets one application/json response. No SSE, no session state — a
 * single Cloud Function invocation handles a message and returns. Hand-rolled
 * JSON-RPC (no @modelcontextprotocol/sdk — it's ESM-only, functions/ is
 * CommonJS). Ported from JackpotKeywords' mcp.ts (proven end-to-end via Claude
 * 2026-06-03; runbook gotchas #1-16 applied).
 *
 * SCOPE — curated connector surface (9 tools), NOT the full 26-tool stdio set:
 * the directory's relevance signal is tool descriptions, and a chat tools menu
 * with 26 entries is noise. Raw-USPTO-data lookups only (the category wedge):
 *   dossier (3cr fresh / 24h cache free), claims (1cr cold / cache free),
 *   prosecution, challenges (PTAB), litigation, examiner, assignments,
 *   legal_status, balance — everything but dossier/claims is free.
 *
 * AUTH — WorkOS AuthKit OAuth 2.1 (see mcpOauth.ts). 401 + WWW-Authenticate on
 * EVERY unauthenticated JSON-RPC POST including `initialize` (runbook gotcha
 * #2: anonymous initialize = the client connects without OAuth and never logs
 * in). Verified email → Firebase Auth user (get-or-create, keyless) → the same
 * uid-keyed credits ledger the extension and API use.
 *
 * Tool results: every tool returns a COMPLETE text rendering (gotcha #13 —
 * claude.ai does not reliably surface structuredContent) and structured
 * payloads are size-capped for the ~25k-token MCP result limit (gotcha #14).
 */

import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import cors from "cors";
import {
  verifyAccessToken,
  fetchWorkOsEmail,
  protectedResourceMetadata,
  protectedResourceMetadataUrl,
} from "./mcpOauth";
import {handleOdpDossierRequest, handleOdpClaimsRequest} from "./odp/odpDossier";
import {handleProsecutionHistoryRequest} from "./usptoOdp";
import {handleExaminerStatsRequest} from "./examinerStats";
import {handleChallengesRequest} from "./odp/ptab";
import {handleLegalStatusRequest} from "./odp/legalStatus";
import {handleAssignmentsRequest} from "./odp/assignments";
import {handleLitigationRequest} from "./litigation";
import {getBalance, useCredit, initCredits} from "./credits";

const SERVER_NAME = "patent-search";
const SERVER_VERSION = "0.1.0";

const DOSSIER_CREDIT_COST = 3; // mirrors index.ts — fresh dossier fetch
const CLAIMS_CREDIT_COST = 1; // mirrors index.ts — cold claims fetch

// Protocol versions we know how to speak. We echo the client's requested
// version when it's one of these; otherwise we answer with our latest.
const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26"];
const LATEST_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];

// ---- JSON-RPC 2.0 types ------------------------------------------------------

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: JsonRpcError;
}

const ERR_PARSE = -32700;
const ERR_INVALID_REQUEST = -32600;
const ERR_METHOD_NOT_FOUND = -32601;
const ERR_INVALID_PARAMS = -32602;
const ERR_INTERNAL = -32603;

function ok(id: string | number | null, result: unknown): JsonRpcResponse {
  return {jsonrpc: "2.0", id, result};
}

function fail(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  return {jsonrpc: "2.0", id, error: {code, message, ...(data !== undefined ? {data} : {})}};
}

// ---- Tool result shape -------------------------------------------------------

interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

function toolError(text: string): ToolResult {
  return {isError: true, content: [{type: "text", text}]};
}

// MCP tool results are capped at ~25k tokens by Claude (runbook gotcha #14).
// Text renderings are budgeted per-tool below; this guard drops an oversized
// structuredContent (the text rendering is the carrier — gotcha #13) rather
// than let one giant payload kill the whole result.
const MCP_MAX_STRUCTURED_CHARS = 60_000;

function withCappedStructured(
  text: string,
  structured: Record<string, unknown>,
): ToolResult {
  try {
    if (JSON.stringify(structured).length > MCP_MAX_STRUCTURED_CHARS) {
      return {content: [{type: "text", text}]};
    }
  } catch {
    return {content: [{type: "text", text}]};
  }
  return {content: [{type: "text", text}], structuredContent: structured};
}

// ---- Tool definitions (curated 9 — cloned from the stdio mcp-server) ---------

const PATENT_NUMBER_PROP = {
  type: "string",
  description:
    "US patent publication number in canonical form (e.g. US10867416B2). " +
    "Loose input like '10,867,416' or 'us10867416' is normalized by the server.",
} as const;

const TOOLS = [
  {
    name: "dossier",
    description:
      "Fetch a comprehensive intelligence dossier for a US patent by publication number. " +
      "Returns bibliographic data (title, assignees, inventors, dates, legal status), independent claims, " +
      "backward + forward citations, patent family, CPC classifications, examiner info, and similar documents. " +
      "Sourced from USPTO Open Data. Costs 3 credits on a fresh fetch; calls within 24 hours read from " +
      "cache and are free. The headline tool — most patent-analysis workflows start here.",
    inputSchema: {
      type: "object",
      properties: {patentNumber: PATENT_NUMBER_PROP},
      required: ["patentNumber"],
      additionalProperties: false,
    },
    annotations: {
      title: "Patent Dossier",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
      idempotentHint: false,
    },
  },
  {
    name: "claims",
    description:
      "Fetch just the claims of a US patent — the legal scope of the invention, as a numbered list of " +
      "independent and dependent claims with full text. Much cheaper than `dossier` when you only need " +
      "claim language. Free when the patent is in the 24h cache; cold fetch costs 1 credit. " +
      "Prefer this over `dossier` when you don't also need bibliographic data, citations, or family.",
    inputSchema: {
      type: "object",
      properties: {patentNumber: PATENT_NUMBER_PROP},
      required: ["patentNumber"],
      additionalProperties: false,
    },
    annotations: {
      title: "Patent Claims",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
      idempotentHint: true,
    },
  },
  {
    name: "prosecution",
    description:
      "Retrieve the USPTO file-wrapper documents (office actions, responses, amendments, IDS filings, " +
      "notices) for a US patent or application: each document's ID, mail date, category, and description. " +
      "Answers 'what happened during examination?'. Free, public-record.",
    inputSchema: {
      type: "object",
      properties: {
        patentNumber: {
          type: "string",
          description: "Patent publication number (e.g. US10867416B2). One of patentNumber or applicationNumber required.",
        },
        applicationNumber: {
          type: "string",
          description: "USPTO application number (e.g. 15912345). One of patentNumber or applicationNumber required.",
        },
      },
      additionalProperties: false,
    },
    annotations: {
      title: "Prosecution History",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
      idempotentHint: true,
    },
  },
  {
    name: "challenges",
    description:
      "Get the PTAB validity-challenge history for a US patent: who challenged it (petitioner), the patent " +
      "owner, challenge type (IPR/PGR/CBM), filing/institution dates, and outcome (patent survived / final " +
      "written decision / terminated). Answers 'was this patent attacked at the PTAB, by whom, and did it " +
      "survive?'. Free, public-record.",
    inputSchema: {
      type: "object",
      properties: {patentNumber: PATENT_NUMBER_PROP},
      required: ["patentNumber"],
      additionalProperties: false,
    },
    annotations: {
      title: "PTAB Challenges",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
      idempotentHint: true,
    },
  },
  {
    name: "litigation",
    description:
      "Get the US district-court infringement litigation history for a patent: who sued whom, in which " +
      "court, over what (cause of action), with filing dates. Backed by the USPTO Patent Litigation " +
      "Dataset. Coverage: comprehensive 2003-2016, partial to 2020 (no cases after 2020). Empty result = " +
      "not litigated on record in that window. Free, public-record.",
    inputSchema: {
      type: "object",
      properties: {
        patentNumber: PATENT_NUMBER_PROP,
        limit: {type: "number", description: "Max cases to return (default: all stored)."},
      },
      required: ["patentNumber"],
      additionalProperties: false,
    },
    annotations: {
      title: "Patent Litigation",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
      idempotentHint: true,
    },
  },
  {
    name: "examiner",
    description:
      "Get the assigned USPTO examiner's name, art unit, total applications handled, allowance rate, and " +
      "average pendency for a US patent. Useful for prosecution strategy and risk assessment. Free.",
    inputSchema: {
      type: "object",
      properties: {patentNumber: PATENT_NUMBER_PROP},
      required: ["patentNumber"],
      additionalProperties: false,
    },
    annotations: {
      title: "Examiner Statistics",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
      idempotentHint: true,
    },
  },
  {
    name: "assignments",
    description:
      "Chain of title for a US patent: who owns it now and the recorded assignment history (conveyances, " +
      "reel/frame, assignor → assignee, dates). Useful for ownership verification, licensing, and M&A due " +
      "diligence. Free, public-record.",
    inputSchema: {
      type: "object",
      properties: {patentNumber: PATENT_NUMBER_PROP},
      required: ["patentNumber"],
      additionalProperties: false,
    },
    annotations: {
      title: "Patent Assignments",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
      idempotentHint: true,
    },
  },
  {
    name: "legal_status",
    description:
      "Is this US patent still in force? Returns in-force vs lapsed/expired, the anticipated 20-year " +
      "expiration, and the maintenance-fee payment history (derived from USPTO events). Free, public-record.",
    inputSchema: {
      type: "object",
      properties: {patentNumber: PATENT_NUMBER_PROP},
      required: ["patentNumber"],
      additionalProperties: false,
    },
    annotations: {
      title: "Legal Status",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
      idempotentHint: true,
    },
  },
  {
    name: "balance",
    description:
      "Return the current credit balance and subscription status for the authenticated AI Patent Search " +
      "Generator account. Use this before calling `dossier` (3 credits fresh) or `claims` (1 credit cold) " +
      "to verify credits are available; all other tools here are free.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    annotations: {
      title: "Credit Balance",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
      idempotentHint: true,
    },
  },
] as const;

// ---- Auth — WorkOS AuthKit OAuth 2.1 -----------------------------------------

/** The authenticated Claude/ChatGPT user, resolved to a credits-ledger uid. */
interface McpAuth {
  uid: string;
  email: string;
}

type AuthOutcome =
  | { status: "ok"; auth: McpAuth }
  | { status: "anonymous" } // no credentials presented
  | { status: "invalid"; reason: string }; // bad / expired / unresolvable token

// Warm-instance cache: verified email -> uid (saves an admin.auth() round trip).
const uidByEmail = new Map<string, string>();

/**
 * Map a WorkOS-verified email to a Firebase Auth user + credits doc, creating
 * both on first contact (keyless get-or-create; initCredits grants starter
 * credits once and is idempotent). signupSource "mcp" for attribution.
 */
async function getOrCreateUidByEmail(email: string): Promise<string> {
  const cached = uidByEmail.get(email);
  if (cached) return cached;

  let uid: string;
  try {
    const user = await admin.auth().getUserByEmail(email);
    uid = user.uid;
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code !== "auth/user-not-found") throw err;
    const created = await admin.auth().createUser({email, emailVerified: true});
    uid = created.uid;
  }
  await initCredits(admin.firestore(), uid, "mcp");
  uidByEmail.set(email, uid);
  return uid;
}

/**
 * Resolve the caller to a credits-ledger uid.
 *  - Dev bypass (PSG_MCP_DEV_AUTH=1 + x-dev-uid) for local smoke tests.
 *  - Otherwise verify the AuthKit OAuth 2.1 bearer JWT (jose-free, node:crypto
 *    against AuthKit's JWKS), resolve the verified email, get-or-create the
 *    Firebase user.
 */
async function resolveMcpAuth(req: functions.https.Request): Promise<AuthOutcome> {
  if (process.env.PSG_MCP_DEV_AUTH === "1") {
    const devUid = req.header("x-dev-uid");
    if (devUid) return {status: "ok", auth: {uid: devUid, email: "dev@local"}};
  }

  const authz = req.header("authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(authz.trim());
  if (!m) return {status: "anonymous"};

  const verified = await verifyAccessToken(m[1].trim());
  if ("error" in verified) return {status: "invalid", reason: verified.error};

  const email = verified.email || (await fetchWorkOsEmail(verified.sub));
  if (!email) return {status: "invalid", reason: "email_unavailable"};

  try {
    const uid = await getOrCreateUidByEmail(email);
    return {status: "ok", auth: {uid, email}};
  } catch (err) {
    functions.logger.error("MCP auth: account get-or-create failed:", (err as Error).message);
    return {status: "invalid", reason: "account_resolution_failed"};
  }
}

/** 401 + RFC 9728 discovery hint so MCP clients begin the OAuth flow. */
function send401(res: functions.Response, reason: string): void {
  res
    .status(401)
    .set(
      "WWW-Authenticate",
      `Bearer resource_metadata="${protectedResourceMetadataUrl()}", error="invalid_token"`,
    )
    .json({error: "unauthorized", reason});
}

// ---- Tool implementations ----------------------------------------------------

/** Standard error → tool-error mapping for the handler result contract. */
function handlerError(result: { error?: string; code?: string }, what: string): ToolResult {
  const code = result.code ? ` [${result.code}]` : "";
  return toolError(`Could not fetch ${what}${code}: ${result.error}`);
}

/** Extract + validate the patentNumber arg shared by most tools. */
function patentNumberArg(args: Record<string, unknown>): string | null {
  const v = typeof args.patentNumber === "string" ? args.patentNumber.trim() : "";
  return v || null;
}

const INSUFFICIENT_CREDITS_HINT =
  "Credits can be added from your AI Patent Search Generator account " +
  "(https://patent-search-generator.web.app).";

async function chargeCredits(
  uid: string,
  action: string,
  amount: number,
): Promise<{ ok: true; remaining: number } | { ok: false; message: string }> {
  try {
    const result = await useCredit(admin.firestore(), uid, action, amount, "mcp");
    return {ok: true, remaining: result.remaining};
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {ok: false, message: `${message} ${INSUFFICIENT_CREDITS_HINT}`};
  }
}

async function runDossierTool(args: Record<string, unknown>, auth: McpAuth): Promise<ToolResult> {
  const patentNumber = patentNumberArg(args);
  if (!patentNumber) return toolError("patentNumber is required (e.g. US10867416B2).");

  const result = await handleOdpDossierRequest({patentNumber});
  if (result.error || !result.dossier) return handlerError(result, `dossier for ${patentNumber}`);
  const d = result.dossier as unknown as Record<string, unknown> & {
    cached?: boolean;
    patentNumber?: string;
  };

  let billingLine = "(served from 24h cache — free)";
  if (!d.cached) {
    const charge = await chargeCredits(auth.uid, `dossier:${d.patentNumber}`, DOSSIER_CREDIT_COST);
    if (!charge.ok) return toolError(charge.message);
    billingLine = `(fresh fetch — ${DOSSIER_CREDIT_COST} credits charged; ${charge.remaining} remaining. Repeat calls within 24h are free.)`;
  }

  // Complete text rendering (gotcha #13): header + claims + citations + family
  // + classification + similar, not just a one-line summary.
  const header = (d.header ?? {}) as Record<string, unknown>;
  const claims = (d.claims ?? {}) as {
    totalCount?: number;
    independentNumbers?: number[];
    items?: Array<{ number: number; text: string; isIndependent: boolean }>;
  };
  const citations = (d.citations ?? {}) as {
    backwardCount?: number;
    forwardCount?: number;
  };
  const family = (d.family ?? {}) as { members?: Array<Record<string, unknown>> };
  const classification = (d.classification ?? {}) as {
    cpcCodes?: Array<{ code: string; label: string; primary: boolean }>;
  };
  const similar = Array.isArray(d.similar) ?
    (d.similar as Array<{ patentNumber?: string; title?: string }>) : [];

  const lines: string[] = [
    `${d.patentNumber} — ${header.title ?? "(no title)"}`,
    header.currentAssignee ? `Assignee: ${header.currentAssignee}` : null,
    Array.isArray(header.inventors) && header.inventors.length ?
      `Inventors: ${(header.inventors as unknown[]).join(", ")}` : null,
    header.filingDate ? `Filed: ${header.filingDate}` : null,
    header.grantDate ? `Granted: ${header.grantDate}` : null,
    header.priorityDate ? `Priority: ${header.priorityDate}` : null,
    `Status: ${header.statusLabel ?? "unknown"}`,
    Array.isArray(classification.cpcCodes) && classification.cpcCodes.length ?
      `CPC: ${classification.cpcCodes.slice(0, 12).map((c) => c.code).join(", ")}` : null,
    `Citations: ${citations.backwardCount ?? 0} backward / ${citations.forwardCount ?? 0} forward`,
    Array.isArray(family.members) ? `Family members: ${family.members.length}` : null,
    `Claims: ${claims.totalCount ?? 0} total, independent: ${(claims.independentNumbers ?? []).join(", ") || "n/a"}`,
    "",
  ].filter((s): s is string => s !== null);

  // Independent claims in full (budgeted) — the legal heart of the dossier.
  const independents = (claims.items ?? []).filter((c) => c.isIndependent);
  let budget = 30_000; // chars — leaves room within the 25k-token result cap
  for (const c of independents) {
    if (budget <= 0) {
      lines.push(`… remaining independent claims omitted for length (use the claims tool for full text).`);
      break;
    }
    const text = c.text.length > budget ? `${c.text.slice(0, budget)} …[truncated]` : c.text;
    lines.push(`■ Claim ${c.number} (independent)`);
    lines.push(text);
    lines.push("");
    budget -= text.length;
  }

  if (similar.length) {
    lines.push(`Similar documents (${similar.length}):`);
    for (const s of similar.slice(0, 10)) {
      lines.push(`  • ${s.patentNumber ?? "?"} — ${s.title ?? ""}`);
    }
    if (similar.length > 10) lines.push(`  … and ${similar.length - 10} more`);
    lines.push("");
  }
  lines.push(billingLine);

  return withCappedStructured(lines.join("\n"), d);
}

async function runClaimsTool(args: Record<string, unknown>, auth: McpAuth): Promise<ToolResult> {
  const patentNumber = patentNumberArg(args);
  if (!patentNumber) return toolError("patentNumber is required (e.g. US10867416B2).");

  const result = await handleOdpClaimsRequest({patentNumber});
  if (result.error) return handlerError(result, `claims for ${patentNumber}`);
  const data = result as unknown as {
    patentNumber: string;
    cached: boolean;
    claims: {
      totalCount: number;
      independentNumbers: number[];
      items: Array<{ number: number; text: string; isIndependent: boolean; dependsOn?: number }>;
    };
  };

  let billingLine = "(served from 24h cache — free)";
  if (data.cached === false) {
    const charge = await chargeCredits(auth.uid, `claims:${data.patentNumber}`, CLAIMS_CREDIT_COST);
    if (!charge.ok) return toolError(charge.message);
    billingLine = `(fresh fetch — ${CLAIMS_CREDIT_COST} credit charged; ${charge.remaining} remaining)`;
  }

  const lines: string[] = [
    `${data.patentNumber} — ${data.claims.totalCount} claims (${data.claims.independentNumbers.length} independent)`,
    billingLine,
    "",
  ];
  let budget = 60_000; // chars — full claim text, capped under the 25k-token limit
  let omitted = 0;
  for (const claim of data.claims.items) {
    if (budget <= 0) {
      omitted++;
      continue;
    }
    const marker = claim.isIndependent ? "■" : `└─ (dep. on ${claim.dependsOn ?? "?"})`;
    const text = claim.text.length > budget ? `${claim.text.slice(0, budget)} …[truncated]` : claim.text;
    lines.push(`${marker} Claim ${claim.number}`);
    lines.push(text);
    lines.push("");
    budget -= text.length + 24;
  }
  if (omitted > 0) {
    lines.push(`… ${omitted} further claims omitted for length (of ${data.claims.totalCount} total).`);
  }

  return withCappedStructured(lines.join("\n"), {
    patentNumber: data.patentNumber,
    cached: data.cached,
    claims: data.claims,
  });
}

/**
 * Resolve a patent number to its USPTO application number (+ filing date) via
 * the dossier — cache-first, free (mirrors how the free slice endpoints
 * /similar, /citations, /family resolve through handleOdpDossierRequest
 * without billing).
 */
async function resolveApplicationNumber(
  patentNumber: string,
): Promise<{ applicationNumber: string; filingDate?: string } | { error: string }> {
  const result = await handleOdpDossierRequest({patentNumber});
  if (result.error || !result.dossier) {
    return {error: `Could not resolve ${patentNumber} to a USPTO application: ${result.error}`};
  }
  const header = result.dossier.header as { applicationNumber?: string; filingDate?: string };
  if (!header.applicationNumber) {
    return {error: `USPTO record for ${patentNumber} has no application number on file.`};
  }
  return {applicationNumber: header.applicationNumber, filingDate: header.filingDate};
}

async function runProsecutionTool(args: Record<string, unknown>): Promise<ToolResult> {
  const patentNumber = typeof args.patentNumber === "string" ? args.patentNumber.trim() : "";
  let applicationNumber = typeof args.applicationNumber === "string" ? args.applicationNumber.trim() : "";
  if (!patentNumber && !applicationNumber) {
    return toolError("Provide patentNumber or applicationNumber.");
  }
  let filingDate: string | undefined;
  if (!applicationNumber) {
    const resolved = await resolveApplicationNumber(patentNumber);
    if ("error" in resolved) return toolError(resolved.error);
    applicationNumber = resolved.applicationNumber;
    filingDate = resolved.filingDate;
  }

  const result = await handleProsecutionHistoryRequest({applicationNumber, filingDate});
  if (result.error || !result.history) {
    return handlerError(result, `prosecution history for ${patentNumber || applicationNumber}`);
  }
  const history = result.history;
  const docs = history.documents ?? [];
  const lines = [
    `Application: ${history.applicationNumber}` + (patentNumber ? ` (patent ${patentNumber})` : ""),
    `${history.documentCount} file-wrapper document(s):`,
    ...docs.slice(0, 100).map((d) => `  • [${d.documentId}] ${d.date} (${d.category}/${d.code}) — ${d.description}`),
    docs.length > 100 ? `  … and ${docs.length - 100} more (of ${docs.length} total)` : null,
  ].filter((s): s is string => s !== null);

  return withCappedStructured(lines.join("\n"), history as unknown as Record<string, unknown>);
}

async function runChallengesTool(args: Record<string, unknown>): Promise<ToolResult> {
  const patentNumber = patentNumberArg(args);
  if (!patentNumber) return toolError("patentNumber is required (e.g. US8724622B2).");

  const result = await handleChallengesRequest({patentNumber});
  if (result.error) return handlerError(result, `PTAB challenges for ${patentNumber}`);
  const data = result as unknown as {
    patentNumber?: string;
    challengeCount?: number;
    challenges?: Array<{
      trialNumber: string; type: string; petitioner: string; patentOwner: string;
      petitionFilingDate: string; status: string; outcome: string;
    }>;
  };
  const c = data.challenges ?? [];
  const lines = [
    `${data.challengeCount ?? 0} PTAB challenge(s) for ${data.patentNumber ?? patentNumber}`,
    ...c.slice(0, 50).map((t) =>
      `  ${t.trialNumber} (${t.type}) filed ${t.petitionFilingDate} — ${t.petitioner} v ${t.patentOwner} — ${t.status} → ${t.outcome}`),
    c.length > 50 ? `  … and ${c.length - 50} more` : null,
  ].filter((s): s is string => s !== null);

  return withCappedStructured(lines.join("\n"), data as Record<string, unknown>);
}

async function runLitigationTool(args: Record<string, unknown>): Promise<ToolResult> {
  const patentNumber = patentNumberArg(args);
  if (!patentNumber) return toolError("patentNumber is required (e.g. US8724622B2).");
  const body: Record<string, unknown> = {patentNumber};
  if (typeof args.limit === "number") body.limit = args.limit;

  const result = await handleLitigationRequest(body);
  if (result.error) return handlerError(result, `litigation history for ${patentNumber}`);
  const data = result as unknown as {
    patentNumber?: string;
    caseCount?: number;
    cases?: Array<{
      caseNumber: string; court: string; dateFiled: string; caseName: string;
      plaintiffs: string[]; defendants: string[]; cause: string;
    }>;
    truncated?: boolean;
    coverageNote?: string;
  };
  const cs = data.cases ?? [];
  const lines = [
    `${data.caseCount ?? 0} district-court suit(s) for ${data.patentNumber ?? patentNumber}` +
      (data.truncated ? " (truncated by limit)" : ""),
    ...cs.slice(0, 50).map((c) =>
      `  ${c.dateFiled} ${c.caseNumber} (${c.court}) — ${c.plaintiffs[0] || c.caseName} v ${c.defendants[0] || "?"} — ${c.cause}`),
    cs.length > 50 ? `  … and ${cs.length - 50} more` : null,
    data.coverageNote ? `Note: ${data.coverageNote}` : null,
  ].filter((s): s is string => s !== null);

  return withCappedStructured(lines.join("\n"), data as Record<string, unknown>);
}

async function runExaminerTool(args: Record<string, unknown>): Promise<ToolResult> {
  const patentNumber = patentNumberArg(args);
  if (!patentNumber) return toolError("patentNumber is required (e.g. US10867416B2).");

  const resolved = await resolveApplicationNumber(patentNumber);
  if ("error" in resolved) return toolError(resolved.error);

  const result = await handleExaminerStatsRequest({applicationNumber: resolved.applicationNumber});
  if (result.error || !result.stats) return handlerError(result, `examiner stats for ${patentNumber}`);
  const stats = result.stats;
  const lines = [
    `Examiner for ${patentNumber} (application ${stats.applicationNumber}): ${stats.examinerName || "unknown"}`,
    stats.artUnit ? `Art unit: ${stats.artUnit}` : null,
    `Total applications handled: ${stats.totalApplications} (${stats.patentedCount} patented)`,
    `Allowance rate: ${(stats.allowanceRate * 100).toFixed(1)}%`,
    `Average pendency: ${Math.round(stats.avgPendencyDays / 30.44)} months ` +
      `(${stats.avgPendencyDays} days, sample of ${stats.pendencySampleSize})`,
  ].filter((s): s is string => s !== null);

  return withCappedStructured(lines.join("\n"), stats as unknown as Record<string, unknown>);
}

async function runAssignmentsTool(args: Record<string, unknown>): Promise<ToolResult> {
  const patentNumber = patentNumberArg(args);
  if (!patentNumber) return toolError("patentNumber is required (e.g. US10000000B2).");

  const result = await handleAssignmentsRequest({patentNumber});
  if (result.error) return handlerError(result, `assignments for ${patentNumber}`);
  const data = result as unknown as {
    patentNumber?: string; currentAssignee?: string; assignmentCount?: number;
    assignments?: Array<{
      reelFrame: string; conveyanceText: string; recordedDate: string;
      assignors: Array<{ name: string }>; assignees: string[];
    }>;
  };
  const lines = [
    `${data.patentNumber ?? patentNumber} — current assignee: ${data.currentAssignee || "unknown"} ` +
      `(${data.assignmentCount ?? 0} recorded assignment(s))`,
    ...(data.assignments ?? []).slice(0, 30).map((a) =>
      `  ${a.recordedDate} ${a.reelFrame} "${a.conveyanceText}" — ${a.assignors.map((x) => x.name).join(", ")} → ${a.assignees.join(", ")}`),
    (data.assignments?.length ?? 0) > 30 ? `  … and ${data.assignments!.length - 30} more` : null,
  ].filter((s): s is string => s !== null);

  return withCappedStructured(lines.join("\n"), data as Record<string, unknown>);
}

async function runLegalStatusTool(args: Record<string, unknown>): Promise<ToolResult> {
  const patentNumber = patentNumberArg(args);
  if (!patentNumber) return toolError("patentNumber is required (e.g. US10000000B2).");

  const result = await handleLegalStatusRequest({patentNumber});
  if (result.error) return handlerError(result, `legal status for ${patentNumber}`);
  const data = result as unknown as {
    patentNumber?: string; inForce?: boolean | null; statusLabel?: string;
    anticipatedExpiration?: string; lastMaintenancePayment?: string;
    lapseOrExpirationEvent?: { date: string; description: string } | null;
  };
  const lines = [
    `${data.patentNumber ?? patentNumber}: ` +
      `${data.inForce === true ? "IN FORCE" : data.inForce === false ? "NOT in force" : "status unknown"} ` +
      `(${data.statusLabel ?? "?"})`,
    data.anticipatedExpiration ? `Anticipated expiration: ${data.anticipatedExpiration}` : null,
    data.lastMaintenancePayment ? `Last maintenance-fee payment: ${data.lastMaintenancePayment}` : null,
    data.lapseOrExpirationEvent ?
      `Lapse/expiry event: ${data.lapseOrExpirationEvent.date} ${data.lapseOrExpirationEvent.description}` : null,
  ].filter((s): s is string => s !== null);

  return withCappedStructured(lines.join("\n"), data as Record<string, unknown>);
}

async function runBalanceTool(auth: McpAuth): Promise<ToolResult> {
  const data = await getBalance(admin.firestore(), auth.uid);
  const lines = [
    `Credit balance: ${data.balance}`,
    `  • Subscription credits: ${data.subscriptionCredits}`,
    `  • Top-up credits: ${data.topupCredits}`,
    `Total used: ${data.totalUsed}`,
    data.subscription ?
      `Subscription: ${data.subscription.planId} (${data.subscription.status})` :
      "Subscription: none",
    "Costs: dossier 3 credits (fresh fetch; 24h cache free), claims 1 credit (cold fetch); all other tools here are free.",
  ];
  return withCappedStructured(lines.join("\n"), data as unknown as Record<string, unknown>);
}

// ---- Tool dispatch -----------------------------------------------------------

async function callTool(
  name: string,
  args: Record<string, unknown>,
  auth: McpAuth,
): Promise<ToolResult> {
  switch (name) {
    case "dossier": return runDossierTool(args, auth);
    case "claims": return runClaimsTool(args, auth);
    case "prosecution": return runProsecutionTool(args);
    case "challenges": return runChallengesTool(args);
    case "litigation": return runLitigationTool(args);
    case "examiner": return runExaminerTool(args);
    case "assignments": return runAssignmentsTool(args);
    case "legal_status": return runLegalStatusTool(args);
    case "balance": return runBalanceTool(auth);
    default: return toolError(`Unknown tool: ${name}`);
  }
}

// ---- JSON-RPC method handling --------------------------------------------------

function negotiateProtocolVersion(params: Record<string, unknown> | undefined): string {
  const requested = params?.protocolVersion;
  if (typeof requested === "string" && SUPPORTED_PROTOCOL_VERSIONS.includes(requested)) {
    return requested;
  }
  return LATEST_PROTOCOL_VERSION;
}

/**
 * Handle one JSON-RPC request object. Returns a response for requests (those
 * with an `id`), or null for notifications (no `id`).
 */
async function handleMessage(msg: JsonRpcRequest, auth: McpAuth): Promise<JsonRpcResponse | null> {
  const isNotification = msg.id === undefined || msg.id === null;
  const id = (msg.id ?? null) as string | number | null;

  if (msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return isNotification ? null : fail(id, ERR_INVALID_REQUEST, "Invalid JSON-RPC 2.0 request.");
  }

  switch (msg.method) {
    case "initialize":
      return ok(id, {
        protocolVersion: negotiateProtocolVersion(msg.params),
        capabilities: {tools: {}},
        serverInfo: {name: SERVER_NAME, version: SERVER_VERSION},
      });

    // Lifecycle notifications — acknowledged, no response body.
    case "notifications/initialized":
    case "notifications/cancelled":
      return null;

    case "ping":
      return ok(id, {});

    case "tools/list":
      return ok(id, {tools: TOOLS});

    case "tools/call": {
      const name = msg.params?.name;
      if (typeof name !== "string") {
        return fail(id, ERR_INVALID_PARAMS, "tools/call requires a string `name`.");
      }
      const rawArgs = msg.params?.arguments;
      const args: Record<string, unknown> =
        rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs) ?
          (rawArgs as Record<string, unknown>) :
          {};
      try {
        const result = await callTool(name, args, auth);
        return ok(id, result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return fail(id, ERR_INTERNAL, message);
      }
    }

    default:
      return isNotification ? null : fail(id, ERR_METHOD_NOT_FOUND, `Method not found: ${msg.method}`);
  }
}

// ---- HTTP transport ------------------------------------------------------------

const corsHandler = cors({origin: true});

/** True for the PRM discovery paths — both RFC 9728 forms (gotcha #11). */
function isPrmPath(path: string): boolean {
  // Suffix form (advertised in WWW-Authenticate): /api/mcp/.well-known/...
  // Path-insert form (standard probe): /.well-known/oauth-protected-resource[/api/mcp]
  return (
    path.endsWith("/.well-known/oauth-protected-resource") ||
    path.startsWith("/.well-known/oauth-protected-resource")
  );
}

export const mcp = functions
  .runWith({timeoutSeconds: 120, memory: "512MB"})
  .https.onRequest((req, res) => {
    corsHandler(req, res, async () => {
      if (req.method === "OPTIONS") {
        res.status(204).send("");
        return;
      }

      // RFC 9728 Protected Resource Metadata — public GET, both forms.
      if (req.method === "GET" && isPrmPath(req.path)) {
        functions.logger.info(`MCP PRM fetched (${req.path})`);
        res.json(protectedResourceMetadata());
        return;
      }

      // Some MCP clients probe with GET (expecting an SSE stream). We're
      // stateless / POST-only, so advertise that explicitly rather than 404.
      if (req.method === "GET") {
        res.status(405).json({
          error: "method_not_allowed",
          message: "This MCP endpoint is stateless Streamable HTTP. Send JSON-RPC 2.0 over POST.",
        });
        return;
      }

      if (req.method !== "POST") {
        res.status(405).json({error: "method_not_allowed"});
        return;
      }

      const body = req.body;
      const outcome = await resolveMcpAuth(req);

      // Diagnostics — trace which methods clients call and the auth result
      // (turns "it spun silently" into a one-glance diagnosis).
      const methods = Array.isArray(body) ?
        body.map((m) => (m && typeof m === "object" ? (m as { method?: string }).method : "?")).join(",") :
        body && typeof body === "object" ?
          (body as { method?: string }).method :
          "?";
      const hasBearer = /^Bearer\s+/i.test(req.header("authorization") || "");
      functions.logger.info(
        `MCP POST methods=[${methods}] bearer=${hasBearer} auth=${outcome.status}` +
          (outcome.status === "invalid" ? `(${outcome.reason})` : ""),
      );

      // Protected resource — every JSON-RPC call requires a verified identity.
      // 401 + WWW-Authenticate (RFC 9728) on unauthenticated requests INCLUDING
      // initialize is what makes the client run OAuth at CONNECT time (gotcha
      // #2: a deferred 401 on tools/call alone does not reliably trigger
      // Claude's OAuth flow — the client connects anonymously and never logs in).
      if (outcome.status !== "ok") {
        send401(res, outcome.status === "invalid" ? outcome.reason : "authentication_required");
        return;
      }
      const auth = outcome.auth;

      if (Array.isArray(body)) {
        if (body.length === 0) {
          res.status(400).json(fail(null, ERR_INVALID_REQUEST, "Empty batch."));
          return;
        }
        const responses: JsonRpcResponse[] = [];
        for (const msg of body) {
          const r = await handleMessage(msg as JsonRpcRequest, auth);
          if (r) responses.push(r);
        }
        if (responses.length === 0) {
          res.status(202).end();
          return;
        }
        res.json(responses);
        return;
      }

      if (!body || typeof body !== "object") {
        res.status(400).json(fail(null, ERR_PARSE, "Request body must be a JSON-RPC 2.0 object."));
        return;
      }

      const response = await handleMessage(body as JsonRpcRequest, auth);
      if (!response) {
        res.status(202).end();
        return;
      }
      res.json(response);
    });
  });
