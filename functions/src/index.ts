import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import cors from "cors";
import {handleAIRequest} from "./ai";
import {handleCreditRequest, useCredit, FREE_ENDPOINTS} from "./credits";
import {handleWebhookEvent} from "./stripe";
import {createEouHandler} from "./eou";
import {handleAdminRequest, ADMIN_UID} from "./admin";
import {
  handlePatentDossierRequest,
  handleDossierSummaryRequest,
  handleSimilarRequest,
  handleCitationsRequest,
  handleFamilyRequest,
  handleClaimsRequest,
} from "./patentDossier";
import {handleClaimChartRequest, handleStandaloneClaimChartRequest} from "./claimChart";
import {
  handleOdpDossierRequest,
  handleOdpSimilarRequest,
  handleOdpCitationsRequest,
  handleOdpFamilyRequest,
  handleOdpClaimsRequest,
} from "./odp/odpDossier";
import {handleChallengesRequest} from "./odp/ptab";
import {handleLegalStatusRequest} from "./odp/legalStatus";
import {handleLegalBundleRequest} from "./odp/legalBundle";
import {handleRiskProfileRequest} from "./odp/riskProfile";
import {handleAssignmentsRequest} from "./odp/assignments";
import {handleLitigationRequest, handleCompanyLitigationRequest} from "./litigation";
import {tryResolveRapidApi, applyRapidApiBilling} from "./rapidapi";
import {
  handleTermRequest,
  handleProsecutionTimelineRequest,
  handleAttorneyRequest,
  handleEntityStatusRequest,
  handlePregrantPubRequest,
} from "./odp/enrichment";
import {handleProsecutionHistoryRequest, handleOdpDocumentRequest} from "./usptoOdp";
import {handleOfficeActionAnalysisRequest} from "./officeActionAnalyzer";
import {handleExaminerStatsRequest} from "./examinerStats";
import {
  AuthContext,
  resolveAuth,
  asDecodedIdToken,
  hasScope,
  resolvePlatformSource,
} from "./auth";
import {handleKeysRequest} from "./keys";
import {checkApiKeyRateLimit, logApiUsage} from "./apiRateLimit";
import {handleCpcRequest} from "./cpc";
import {handleCpcSuggestRequest} from "./cpcSuggest";
import {handleSlackCommand} from "./slack/command";
import {handleSlackEvent} from "./slack/events";
import {beginInstall, completeInstall} from "./slack/install";
import {handleSearchExecuteRequest, handleSearchQueryRequest} from "./searchExecute";

const DOSSIER_CREDIT_COST = 3;
const OA_ANALYSIS_CREDIT_COST = 1;
const LEGAL_BUNDLE_CREDIT_COST = 10; // one "Load legal intelligence" bundle; 24h-cached free
const RISK_PROFILE_CREDIT_COST = 40; // DD-1 one-shot: legal-bundle + dossier header + AI verdict

admin.initializeApp();

const corsHandler = cors({origin: true});

// In-memory rate limiting for Firebase-token (browser-extension) traffic.
// API-key traffic uses Firestore-backed limits in apiRateLimit.ts so they
// hold across function instances.
const rateLimits = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT = 100; // requests per hour
const RATE_WINDOW = 60 * 60 * 1000; // 1 hour

function checkInMemoryRateLimit(userId: string): boolean {
  const now = Date.now();
  const entry = rateLimits.get(userId);

  if (!entry || now > entry.resetTime) {
    rateLimits.set(userId, {count: 1, resetTime: now + RATE_WINDOW});
    return true;
  }

  if (entry.count >= RATE_LIMIT) {
    return false;
  }

  entry.count++;
  return true;
}

// Unified rate-limit check: Firestore-backed for API keys, in-memory for
// Firebase ID tokens. Returns null when allowed, or a payload to send as 429.
async function checkRateLimitFor(
  ctx: AuthContext
): Promise<{ retryAfterSeconds: number } | null> {
  // RapidAPI enforces per-plan limits at its gateway; our shared house account
  // must not be throttled collectively. Skip the internal limiter for it.
  if (ctx.source === "rapidapi") return null;
  if (ctx.source === "apikey" && ctx.keyId) {
    const result = await checkApiKeyRateLimit(ctx.keyId);
    if (!result.allowed) {
      return { retryAfterSeconds: result.retryAfterSeconds ?? 60 };
    }
    return null;
  }
  // Firebase-token path: existing in-memory limiter
  if (!checkInMemoryRateLimit(ctx.uid)) {
    return { retryAfterSeconds: 60 * 60 };
  }
  return null;
}

// Strip the optional /api/v1 (Firebase Hosting rewrite) or /v1 prefix and
// map clean v1 names to the internal handler paths used by the existing
// browser extension. This way both surfaces hit the same dispatch switch.
const V1_ALIASES: Record<string, string> = {
  "/dossier": "/patent-dossier",
  "/search": "/search-execute",
  "/query": "/search-query",
};

function normalizePath(rawPath: string): string {
  let p = rawPath;
  if (p.startsWith("/api/v1")) p = p.slice("/api/v1".length) || "/";
  if (p.startsWith("/v1")) p = p.slice("/v1".length) || "/";
  return V1_ALIASES[p] ?? p;
}

// Map an internal path to the scope needed to call it. Firebase-token auth
// holds "*" scope so this check is a no-op for the extension; API keys must
// hold the matching scope.
function scopeForPath(path: string): string | null {
  if (path.startsWith("/admin/")) return null; // admin requires firebase auth anyway
  if (path.startsWith("/keys/")) return null;  // keys requires firebase auth anyway
  if (path.startsWith("/credits/")) return "credits:read";
  if (path === "/patent-dossier") return "dossier";
  if (path === "/dossier-summary") return "dossier";
  if (path === "/claim-chart") return "dossier";
  if (path === "/similar") return "dossier";
  if (path === "/citations") return "dossier";
  if (path === "/family") return "dossier";
  if (path === "/claims") return "dossier";
  if (path === "/challenges") return "dossier";       // PTAB validity challenges
  if (path === "/legal-status") return "dossier";     // in-force / maintenance
  if (path === "/assignments") return "dossier";      // chain of title
  if (path === "/litigation") return "dossier";       // district-court suits
  if (path === "/company-litigation") return "dossier"; // reverse lookup by company
  if (path === "/term") return "dossier";             // PTA-adjusted expiration
  if (path === "/prosecution-timeline") return "dossier"; // USPTO event log
  if (path === "/attorney") return "dossier";         // attorneys of record
  if (path === "/entity-status") return "dossier";    // small/micro/large
  if (path === "/pregrant-pub") return "dossier";     // as-filed publication
  if (path === "/legal-bundle") return "dossier";     // all per-patent legal data, one call
  if (path === "/risk-profile") return "dossier";     // legal-bundle + dossier header + AI verdict
  if (path === "/cpc") return "dossier";
  if (path === "/cpc-suggest") return "dossier";
  if (path === "/search-execute" || path === "/search-query") return "search";
  if (path === "/prosecution-history") return "prosecution";
  if (path === "/examiner-stats") return "prosecution";
  if (path === "/odp-document") return "prosecution";
  if (path === "/oa-analyze") return "oa-analyze";
  // Default for any AI endpoint
  return "search";
}

function sendRateLimit(
  res: functions.Response,
  retryAfterSeconds: number
): void {
  res.set("Retry-After", String(retryAfterSeconds));
  res.status(429).json({
    error: "Rate limit exceeded. Try again later.",
    retryAfterSeconds,
  });
}

// AI proxy endpoints
export const ai = functions
  .runWith({
    timeoutSeconds: 300,
    memory: "512MB",
    // Header-auth shortcut for /admin/* — see early-return below.
    secrets: ["ADMIN_API_KEY"],
  })
  .https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    if (req.method !== "POST" && req.method !== "GET" && req.method !== "DELETE") {
      res.status(405).json({error: "Method not allowed"});
      return;
    }

    // Header-auth shortcut for /admin/* — lets external pollers (e.g. the
    // sellers-dashboard sidecar) hit admin endpoints without a Firebase
    // password login. Falls through to the standard Firebase-token flow
    // below if the header is missing or doesn't match, so the admin web
    // UI is unaffected.
    const earlyPath = normalizePath(req.path);
    if (earlyPath.startsWith("/admin/")) {
      const provided = (req.headers["x-admin-key"] as string | undefined) || "";
      const expected = process.env.ADMIN_API_KEY || "";
      if (expected && provided && provided === expected) {
        const syntheticToken = { uid: ADMIN_UID } as admin.auth.DecodedIdToken;
        try {
          const result = await handleAdminRequest(earlyPath, req.body, syntheticToken);
          res.status(200).json({ data: result });
        } catch (err) {
          if (err instanceof functions.https.HttpsError) {
            res.status(err.httpErrorCode.status).json({ error: err.message });
          } else {
            throw err;
          }
        }
        return;
      }
    }

    let ctx: AuthContext | null = null;

    try {
      // RapidAPI marketplace gateway (Door 1): if the request carries a valid
      // X-RapidAPI-Proxy-Secret, bind the billing-exempt house account and emit
      // the per-call billing header. Absent → normal auth (Door 2: extension /
      // direct API / MCP). Invalid secret → 401 (thrown, handled below).
      const house = tryResolveRapidApi(req);
      if (house) {
        ctx = { uid: house.uid, email: null, source: "rapidapi", scopes: ["*"] };
        applyRapidApiBilling(res, normalizePath(req.path));
      } else {
        ctx = await resolveAuth(req);
      }
      const decodedToken = asDecodedIdToken(ctx);
      const path = normalizePath(req.path);

      // Server-authoritative platform attribution: classify the request as
      // extension / website / mcp / api from auth context + User-Agent.
      // Overwrite any client-supplied body.source so downstream handlers
      // (handleCreditRequest's /credits/init, /credits/use, /credits/checkout)
      // pick up the trustworthy value automatically. Also passed explicitly
      // into useCredit() calls below for usage attribution.
      const platformSource = resolvePlatformSource(
        ctx,
        req,
        (req.body as { source?: unknown })?.source
      );
      if (req.body && typeof req.body === "object") {
        (req.body as { source: string }).source = platformSource;
      }

      // Data-source split (PLAN-API-DATA-MIGRATION.md): API-key / MCP callers
      // are served from USPTO ODP (public-domain, RapidAPI-safe). The browser
      // extension (Firebase token) keeps the existing Google Patents path,
      // byte-for-byte unchanged. The dossier-family handlers share an identical
      // result contract, so the dispatch blocks below are source-agnostic.
      // API-key, MCP, and RapidAPI callers are served from USPTO ODP (clean,
      // RapidAPI-safe). Only the extension's Firebase-token path uses Google Patents.
      const useOdp = ctx.source !== "firebase";
      const dossierHandler = useOdp ? handleOdpDossierRequest : handlePatentDossierRequest;
      const similarHandler = useOdp ? handleOdpSimilarRequest : handleSimilarRequest;
      const citationsHandler = useOdp ? handleOdpCitationsRequest : handleCitationsRequest;
      const familyHandler = useOdp ? handleOdpFamilyRequest : handleFamilyRequest;
      const claimsHandler = useOdp ? handleOdpClaimsRequest : handleClaimsRequest;

      // Scope check (no-op for Firebase token which holds "*")
      const requiredScope = scopeForPath(path);
      if (requiredScope && !hasScope(ctx, requiredScope)) {
        res.status(403).json({
          error: `API key missing required scope: ${requiredScope}`,
        });
        return;
      }

      // Admin endpoints (Firebase token only — enforced inside handler)
      if (path.startsWith("/admin/")) {
        const result = await handleAdminRequest(path, req.body, decodedToken);
        res.status(200).json({data: result});
        await logApiUsageIfKey(ctx);
        return;
      }

      // API key management endpoints (Firebase token only — enforced inside handler)
      if (path.startsWith("/keys/") || path === "/keys") {
        const result = await handleKeysRequest(path, req.body, ctx);
        res.status(200).json({data: result});
        await logApiUsageIfKey(ctx);
        return;
      }

      // Credit endpoints (balance, use, checkout, packs, history)
      if (path.startsWith("/credits/")) {
        const result = await handleCreditRequest(path, req.body, decodedToken);
        res.status(200).json({data: result});
        await logApiUsageIfKey(ctx);
        return;
      }

      // Patent Dossier endpoint — separate from AI proxy. Credits deducted
      // only on a fresh fetch (cache hits are free for the caller).
      if (path === "/patent-dossier") {
        const db = admin.firestore();
        const rl = await checkRateLimitFor(ctx);
        if (rl) { sendRateLimit(res, rl.retryAfterSeconds); return; }
        const result = await dossierHandler(req.body);
        if (result.error) {
          const statusCode = result.code === "invalid_number" ? 400 :
            result.code === "not_found" ? 404 :
            result.code === "rate_limited" ? 429 : 502;
          res.status(statusCode).json({error: result.error, code: result.code});
          await logApiUsageIfKey(ctx, { isError: true });
          return;
        }
        // Only charge when we actually fetched fresh data
        if (result.dossier && !result.dossier.cached) {
          const deductResult = await useCredit(
            db,
            ctx.uid,
            `dossier:${result.dossier.patentNumber}`,
            DOSSIER_CREDIT_COST,
            platformSource
          );
          res.status(200).json({data: result.dossier, credits: deductResult});
          await logApiUsageIfKey(ctx, { creditsUsed: DOSSIER_CREDIT_COST });
        } else {
          res.status(200).json({data: result.dossier});
          await logApiUsageIfKey(ctx);
        }
        return;
      }

      // Claim Chart § 12 — two call shapes:
      //   1. Extension path: caller passes {patentNumber, claims, oaAnalyses}.
      //      Free (the caller already paid for the dossier + OA analyses).
      //   2. Standalone path (MCP `claim_chart` tool): caller passes just
      //      {patentNumber, oaDocumentIds?}. We fetch the dossier internally;
      //      if the dossier was a cold miss we bill 3cr (same as `dossier`).
      if (path === "/claim-chart") {
        const db = admin.firestore();
        const rl = await checkRateLimitFor(ctx);
        if (rl) { sendRateLimit(res, rl.retryAfterSeconds); return; }
        const isStandalone = !Array.isArray((req.body as { claims?: unknown })?.claims) ||
          ((req.body as { claims?: unknown[] }).claims?.length ?? 0) === 0;
        if (isStandalone) {
          const result = await handleStandaloneClaimChartRequest(
            req.body,
            useOdp ? handleOdpDossierRequest : undefined
          );
          if (result.error) {
            const statusCode = result.code === "invalid_input" ? 400 :
              result.code === "not_found" ? 404 :
              result.code === "rate_limited" ? 429 : 502;
            res.status(statusCode).json({error: result.error, code: result.code});
            await logApiUsageIfKey(ctx, { isError: true });
            return;
          }
          // Cold dossier fetch → bill 3cr (matches `dossier` endpoint pricing).
          if (result.dossierCacheHit === false) {
            const deductResult = await useCredit(
              db,
              ctx.uid,
              `claim-chart:${result.chart!.patentNumber}`,
              DOSSIER_CREDIT_COST,
              platformSource
            );
            res.status(200).json({data: result.chart, credits: deductResult});
            await logApiUsageIfKey(ctx, { creditsUsed: DOSSIER_CREDIT_COST });
          } else {
            res.status(200).json({data: result.chart});
            await logApiUsageIfKey(ctx);
          }
          return;
        }
        // Extension path
        const result = await handleClaimChartRequest(req.body);
        if (result.error) {
          const statusCode = result.code === "invalid_input" ? 400 : 502;
          res.status(statusCode).json({error: result.error, code: result.code});
          await logApiUsageIfKey(ctx, { isError: true });
          return;
        }
        res.status(200).json({data: result.chart});
        await logApiUsageIfKey(ctx);
        return;
      }

      // Dossier AI summary — bundled with the 3-credit dossier fetch, so this
      // endpoint is free to call. Rate-limited like other writes.
      if (path === "/dossier-summary") {
        const rl = await checkRateLimitFor(ctx);
        if (rl) { sendRateLimit(res, rl.retryAfterSeconds); return; }
        // API/MCP callers get an ODP-sourced dossier (no Google Patents); the
        // extension passes undefined and keeps the GP read-through. Phase 4.
        const result = await handleDossierSummaryRequest(
          req.body,
          useOdp ? handleOdpDossierRequest : undefined
        );
        if (result.error) {
          const statusCode = result.code === "invalid_number" ? 400 :
            result.code === "not_found" ? 404 :
            result.code === "rate_limited" ? 429 : 502;
          res.status(statusCode).json({error: result.error, code: result.code});
          await logApiUsageIfKey(ctx, { isError: true });
          return;
        }
        res.status(200).json({data: result.summary});
        await logApiUsageIfKey(ctx);
        return;
      }

      // Similar patents — Google Patents' "similar documents" ranking for a
      // patent. Free. Reads from the dossier cache when warm.
      if (path === "/similar") {
        const rl = await checkRateLimitFor(ctx);
        if (rl) { sendRateLimit(res, rl.retryAfterSeconds); return; }
        const result = await similarHandler(req.body);
        if (result.error) {
          const statusCode = result.code === "invalid_number" ? 400 :
            result.code === "not_found" ? 404 :
            result.code === "rate_limited" ? 429 : 502;
          res.status(statusCode).json({error: result.error, code: result.code});
          await logApiUsageIfKey(ctx, { isError: true });
          return;
        }
        res.status(200).json({data: { patentNumber: result.patentNumber, similar: result.similar, cached: result.cached }});
        await logApiUsageIfKey(ctx);
        return;
      }

      // Citations — backward + forward citations for a patent. Free.
      // direction: backward | forward | both (default both)
      if (path === "/citations") {
        const rl = await checkRateLimitFor(ctx);
        if (rl) { sendRateLimit(res, rl.retryAfterSeconds); return; }
        const result = await citationsHandler(req.body);
        if (result.error) {
          const statusCode = result.code === "invalid_number" ? 400 :
            result.code === "not_found" ? 404 :
            result.code === "rate_limited" ? 429 : 502;
          res.status(statusCode).json({error: result.error, code: result.code});
          await logApiUsageIfKey(ctx, { isError: true });
          return;
        }
        res.status(200).json({data: result});
        await logApiUsageIfKey(ctx);
        return;
      }

      // Patent family — continuations / national counterparts. Free.
      if (path === "/family") {
        const rl = await checkRateLimitFor(ctx);
        if (rl) { sendRateLimit(res, rl.retryAfterSeconds); return; }
        const result = await familyHandler(req.body);
        if (result.error) {
          const statusCode = result.code === "invalid_number" ? 400 :
            result.code === "not_found" ? 404 :
            result.code === "rate_limited" ? 429 : 502;
          res.status(statusCode).json({error: result.error, code: result.code});
          await logApiUsageIfKey(ctx, { isError: true });
          return;
        }
        res.status(200).json({data: { patentNumber: result.patentNumber, family: result.family, cached: result.cached }});
        await logApiUsageIfKey(ctx);
        return;
      }

      // Claims-only slice — lighter than full dossier for LLM token budgets.
      // Free when the dossier is cached; cold miss costs 1cr (covers the
      // Google Patents fetch, no AI work).
      if (path === "/claims") {
        const db = admin.firestore();
        const rl = await checkRateLimitFor(ctx);
        if (rl) { sendRateLimit(res, rl.retryAfterSeconds); return; }
        const result = await claimsHandler(req.body);
        if (result.error) {
          const statusCode = result.code === "invalid_number" ? 400 :
            result.code === "not_found" ? 404 :
            result.code === "rate_limited" ? 429 : 502;
          res.status(statusCode).json({error: result.error, code: result.code});
          await logApiUsageIfKey(ctx, { isError: true });
          return;
        }
        const payload = { patentNumber: result.patentNumber, claims: result.claims, cached: result.cached };
        if (result.cached === false) {
          const deductResult = await useCredit(
            db,
            ctx.uid,
            `claims:${result.patentNumber}`,
            1,
            platformSource
          );
          res.status(200).json({data: payload, credits: deductResult});
          await logApiUsageIfKey(ctx, { creditsUsed: 1 });
        } else {
          res.status(200).json({data: payload});
          await logApiUsageIfKey(ctx);
        }
        return;
      }

      // ── Legal Intelligence bundle (net-new ODP data; US-only; free in v1) ──
      // Factual public-record reporting, available to both the extension
      // (Firebase) and API/MCP (key). No Google Patents involved.

      // Validity challenges (PTAB) — who challenged this patent, type, outcome.
      if (path === "/challenges") {
        const rl = await checkRateLimitFor(ctx);
        if (rl) { sendRateLimit(res, rl.retryAfterSeconds); return; }
        const result = await handleChallengesRequest(req.body);
        if (result.error) {
          const statusCode = result.code === "invalid_number" ? 400 :
            result.code === "not_found" ? 404 :
            result.code === "rate_limited" ? 429 : 502;
          res.status(statusCode).json({error: result.error, code: result.code});
          await logApiUsageIfKey(ctx, { isError: true });
          return;
        }
        res.status(200).json({data: result});
        await logApiUsageIfKey(ctx);
        return;
      }

      // Legal status — in-force vs lapsed/expired + maintenance-fee history.
      if (path === "/legal-status") {
        const rl = await checkRateLimitFor(ctx);
        if (rl) { sendRateLimit(res, rl.retryAfterSeconds); return; }
        const result = await handleLegalStatusRequest(req.body);
        if (result.error) {
          const statusCode = result.code === "invalid_number" ? 400 :
            result.code === "not_found" ? 404 :
            result.code === "rate_limited" ? 429 : 502;
          res.status(statusCode).json({error: result.error, code: result.code});
          await logApiUsageIfKey(ctx, { isError: true });
          return;
        }
        res.status(200).json({data: result});
        await logApiUsageIfKey(ctx);
        return;
      }

      // Assignments — chain of title (recorded conveyances, reel/frame).
      if (path === "/assignments") {
        const rl = await checkRateLimitFor(ctx);
        if (rl) { sendRateLimit(res, rl.retryAfterSeconds); return; }
        const result = await handleAssignmentsRequest(req.body);
        if (result.error) {
          const statusCode = result.code === "invalid_number" ? 400 :
            result.code === "not_found" ? 404 :
            result.code === "rate_limited" ? 429 : 502;
          res.status(statusCode).json({error: result.error, code: result.code});
          await logApiUsageIfKey(ctx, { isError: true });
          return;
        }
        res.status(200).json({data: result});
        await logApiUsageIfKey(ctx);
        return;
      }

      // Litigation — district-court infringement suits (USPTO PTLITIG dataset,
      // pre-ingested to Firestore). Free; empty result = not litigated on record.
      if (path === "/litigation") {
        const rl = await checkRateLimitFor(ctx);
        if (rl) { sendRateLimit(res, rl.retryAfterSeconds); return; }
        const result = await handleLitigationRequest(req.body);
        if (result.error) {
          res.status(result.code === "invalid_number" ? 400 : 502).json({error: result.error, code: result.code});
          await logApiUsageIfKey(ctx, { isError: true });
          return;
        }
        res.status(200).json({data: result});
        await logApiUsageIfKey(ctx);
        return;
      }

      // Company -> litigation (reverse lookup). Free; empty/suggestions when no
      // exact match. Input: { company, limit? }.
      if (path === "/company-litigation") {
        const rl = await checkRateLimitFor(ctx);
        if (rl) { sendRateLimit(res, rl.retryAfterSeconds); return; }
        const result = await handleCompanyLitigationRequest(req.body);
        if (result.error) {
          res.status(result.code === "invalid_input" ? 400 : 502).json({error: result.error, code: result.code});
          await logApiUsageIfKey(ctx, { isError: true });
          return;
        }
        res.status(200).json({data: result});
        await logApiUsageIfKey(ctx);
        return;
      }

      // Legal-intelligence bundle — one call fans out the 9 per-patent
      // legal/enrichment endpoints. Charged once on a fresh fetch; 24h cache
      // is free (mirrors /patent-dossier). Powers the extension "Legal
      // Intelligence" cluster and the DD-1 risk profile.
      if (path === "/legal-bundle") {
        const db = admin.firestore();
        const rl = await checkRateLimitFor(ctx);
        if (rl) { sendRateLimit(res, rl.retryAfterSeconds); return; }
        const result = await handleLegalBundleRequest(req.body);
        if (result.error) {
          const statusCode = result.code === "invalid_number" ? 400 :
            result.code === "not_found" ? 404 :
            result.code === "rate_limited" ? 429 : 502;
          res.status(statusCode).json({error: result.error, code: result.code});
          await logApiUsageIfKey(ctx, { isError: true });
          return;
        }
        // Extension §14 "Legal Intelligence" is free for signed-in users; the
        // metered tier is the DD-1 risk profile (AI verdict) + marketplace API.
        if (result.bundle && !result.bundle.cached && ctx.source !== "firebase") {
          const deductResult = await useCredit(
            db, ctx.uid, `legal-bundle:${result.bundle.patentNumber}`, LEGAL_BUNDLE_CREDIT_COST, platformSource
          );
          res.status(200).json({data: result.bundle, credits: deductResult});
          await logApiUsageIfKey(ctx, { creditsUsed: LEGAL_BUNDLE_CREDIT_COST });
        } else {
          res.status(200).json({data: result.bundle});
          await logApiUsageIfKey(ctx);
        }
        return;
      }

      // Patent Risk Profile (DD-1) — legal-bundle + an AI verdict (risk label +
      // rationale). Flat-priced, charged once on a fresh fetch; 24h cache free.
      if (path === "/risk-profile") {
        const db = admin.firestore();
        const rl = await checkRateLimitFor(ctx);
        if (rl) { sendRateLimit(res, rl.retryAfterSeconds); return; }
        const result = await handleRiskProfileRequest(req.body);
        if (result.error) {
          const statusCode = result.code === "invalid_number" ? 400 :
            result.code === "not_found" ? 404 :
            result.code === "rate_limited" ? 429 : 502;
          res.status(statusCode).json({error: result.error, code: result.code});
          await logApiUsageIfKey(ctx, { isError: true });
          return;
        }
        if (result.riskProfile && !result.riskProfile.cached) {
          const deductResult = await useCredit(
            db, ctx.uid, `risk-profile:${result.riskProfile.patentNumber}`, RISK_PROFILE_CREDIT_COST, platformSource
          );
          res.status(200).json({data: result.riskProfile, credits: deductResult});
          await logApiUsageIfKey(ctx, { creditsUsed: RISK_PROFILE_CREDIT_COST });
        } else {
          res.status(200).json({data: result.riskProfile});
          await logApiUsageIfKey(ctx);
        }
        return;
      }

      // ── Enrichment endpoints (Phase 7; net-new ODP data; free in v1) ──
      // All read the same file wrapper, share the dossier error mapping.
      {
        const odpEnrichment: Record<string, (b: { patentNumber?: string }) => Promise<{ error?: string; code?: string }>> = {
          "/term": handleTermRequest,
          "/prosecution-timeline": handleProsecutionTimelineRequest,
          "/attorney": handleAttorneyRequest,
          "/entity-status": handleEntityStatusRequest,
          "/pregrant-pub": handlePregrantPubRequest,
        };
        const handler = odpEnrichment[path];
        if (handler) {
          const rl = await checkRateLimitFor(ctx);
          if (rl) { sendRateLimit(res, rl.retryAfterSeconds); return; }
          const result = await handler(req.body);
          if (result.error) {
            const statusCode = result.code === "invalid_number" ? 400 :
              result.code === "not_found" ? 404 :
              result.code === "rate_limited" ? 429 : 502;
            res.status(statusCode).json({error: result.error, code: result.code});
            await logApiUsageIfKey(ctx, { isError: true });
            return;
          }
          res.status(200).json({data: result});
          await logApiUsageIfKey(ctx);
          return;
        }
      }

      // Patent search — `mode: "execute"` runs the search against Google
      // Patents server-side and returns ranked hits; `mode: "optimize"`
      // returns just the optimized Boolean query string for manual paste.
      // 1 credit either way (covers AI work).
      if (path === "/search-execute" || path === "/search-query") {
        const db = admin.firestore();
        const rl = await checkRateLimitFor(ctx);
        if (rl) { sendRateLimit(res, rl.retryAfterSeconds); return; }
        const isExecute = path === "/search-execute";
        // Only the extension (Firebase token) executes against Google Patents.
        // API-key / RapidAPI callers get the generated queries to run themselves
        // — the public surface does not scrape Google.
        const result = isExecute
          ? await handleSearchExecuteRequest(req.body, { execute: ctx.source === "firebase" })
          : await handleSearchQueryRequest(req.body);
        if (result.error) {
          const statusCode = result.code === "invalid_input" ? 400 :
            result.code === "ai_failed" ? 502 :
            result.code === "rate_limited" ? 429 : 502;
          res.status(statusCode).json({error: result.error, code: result.code});
          await logApiUsageIfKey(ctx, { isError: true });
          return;
        }
        // 1 credit for either mode
        const deductResult = await useCredit(db, ctx.uid, `search:${isExecute ? "execute" : "query"}`, 1, platformSource);
        res.status(200).json({data: result, credits: deductResult});
        await logApiUsageIfKey(ctx, { creditsUsed: 1 });
        return;
      }

      // CPC classification lookup. Free. v1.0 uses curated static dataset;
      // full USPTO scheme planned for v1.2.
      if (path === "/cpc") {
        const rl = await checkRateLimitFor(ctx);
        if (rl) { sendRateLimit(res, rl.retryAfterSeconds); return; }
        const result = await handleCpcRequest(req.body);
        if (result.error) {
          res.status(400).json({error: result.error, code: result.code_err});
          await logApiUsageIfKey(ctx, { isError: true });
          return;
        }
        res.status(200).json({data: result});
        await logApiUsageIfKey(ctx);
        return;
      }

      // CPC reverse lookup — description → suggested codes via Gemini.
      // 1 credit; cached by description hash for 30 days so repeated calls
      // on the same description are charged only once per cache window.
      if (path === "/cpc-suggest") {
        const db = admin.firestore();
        const rl = await checkRateLimitFor(ctx);
        if (rl) { sendRateLimit(res, rl.retryAfterSeconds); return; }
        const result = await handleCpcSuggestRequest(req.body);
        if (result.error) {
          const statusCode = result.code === "invalid_input" ? 400 :
            result.code === "no_api_key" ? 503 : 502;
          res.status(statusCode).json({error: result.error, code: result.code});
          await logApiUsageIfKey(ctx, { isError: true });
          return;
        }
        const payload = {
          description: result.description,
          suggestions: result.suggestions,
          cached: result.cached,
          notes: result.notes,
        };
        if (result.cached === false) {
          const deductResult = await useCredit(
            db,
            ctx.uid,
            "cpc-suggest",
            1,
            platformSource
          );
          res.status(200).json({data: payload, credits: deductResult});
          await logApiUsageIfKey(ctx, { creditsUsed: 1 });
        } else {
          res.status(200).json({data: payload});
          await logApiUsageIfKey(ctx);
        }
        return;
      }

      // USPTO ODP prosecution history — free, lazy-loaded from the dossier.
      // Future AI-heavy slices (OA analyzer) will charge separately.
      if (path === "/prosecution-history") {
        const rl = await checkRateLimitFor(ctx);
        if (rl) { sendRateLimit(res, rl.retryAfterSeconds); return; }
        const result = await handleProsecutionHistoryRequest(req.body);
        if (result.error) {
          const statusCode =
            result.code === "invalid_number" ? 400 :
            result.code === "out_of_coverage" ? 404 :
            result.code === "not_found" ? 404 :
            result.code === "no_api_key" ? 503 : 502;
          res.status(statusCode).json({error: result.error, code: result.code});
          await logApiUsageIfKey(ctx, { isError: true });
          return;
        }
        res.status(200).json({data: result.history});
        await logApiUsageIfKey(ctx);
        return;
      }

      // Office Action analyzer — fetches the OA PDF, Gemini-summarizes into
      // rejections + cited art + suggested arguments. First 5 analyses per
      // application are free; subsequent fresh analyses cost 1 credit each.
      if (path === "/oa-analyze") {
        const db = admin.firestore();
        const rl = await checkRateLimitFor(ctx);
        if (rl) { sendRateLimit(res, rl.retryAfterSeconds); return; }
        const result = await handleOfficeActionAnalysisRequest(req.body, ctx.uid);
        if (result.error) {
          const statusCode =
            result.code === "invalid_input" ? 400 :
            result.code === "not_found" ? 404 :
            result.code === "no_api_key" ? 503 :
            result.code === "ai_failed" ? 502 : 502;
          res.status(statusCode).json({error: result.error, code: result.code});
          await logApiUsageIfKey(ctx, { isError: true });
          return;
        }
        const payload = { analysis: result.analysis, quota: result.quota };
        if (result.billed) {
          const deductResult = await useCredit(
            db,
            ctx.uid,
            `oa:${result.analysis!.documentId}`,
            OA_ANALYSIS_CREDIT_COST,
            platformSource
          );
          res.status(200).json({data: payload, credits: deductResult});
          await logApiUsageIfKey(ctx, { creditsUsed: OA_ANALYSIS_CREDIT_COST });
        } else {
          res.status(200).json({data: payload});
          await logApiUsageIfKey(ctx);
        }
        return;
      }

      // Examiner stats — examiner identity + aggregate stats (allowance rate,
      // avg pendency) from USPTO ODP. Free, auto-loaded with the dossier.
      if (path === "/examiner-stats") {
        const rl = await checkRateLimitFor(ctx);
        if (rl) { sendRateLimit(res, rl.retryAfterSeconds); return; }
        const result = await handleExaminerStatsRequest(req.body);
        if (result.error) {
          const statusCode =
            result.code === "invalid_input" ? 400 :
            result.code === "not_found" ? 404 :
            result.code === "no_examiner" ? 404 :
            result.code === "no_api_key" ? 503 : 502;
          res.status(statusCode).json({error: result.error, code: result.code});
          await logApiUsageIfKey(ctx, { isError: true });
          return;
        }
        res.status(200).json({data: result.stats});
        await logApiUsageIfKey(ctx);
        return;
      }

      // USPTO ODP PDF proxy — streams a file-wrapper PDF back to the browser
      // (ODP URLs require X-API-KEY, so direct <a href> wouldn't work).
      if (path === "/odp-document") {
        const rl = await checkRateLimitFor(ctx);
        if (rl) { sendRateLimit(res, rl.retryAfterSeconds); return; }
        const result = await handleOdpDocumentRequest(req.body);
        if (result.error) {
          const statusCode =
            result.code === "invalid_input" ? 400 :
            result.code === "not_found" ? 404 :
            result.code === "no_api_key" ? 503 :
            result.code === "too_large" ? 413 : 502;
          res.status(statusCode).json({error: result.error, code: result.code});
          await logApiUsageIfKey(ctx, { isError: true });
          return;
        }
        res.set("Content-Type", result.contentType || "application/pdf");
        res.set("Content-Disposition", `inline; filename="${result.filename}"`);
        res.status(200).send(result.buffer);
        await logApiUsageIfKey(ctx);
        return;
      }

      // AI endpoints — deduct credits server-side BEFORE processing
      const db = admin.firestore();

      // Determine credit cost: client can pass creditCost (0 for quick searches),
      // defaults to 1 for backward compat. Free endpoints always cost 0.
      const isFreeEndpoint = FREE_ENDPOINTS.has(path);
      const creditCost = isFreeEndpoint ? 0 :
        (typeof req.body?.creditCost === "number" ? Math.max(0, Math.floor(req.body.creditCost)) : 1);

      if (creditCost > 0) {
        // Rate limit only paid operations
        const rl = await checkRateLimitFor(ctx);
        if (rl) { sendRateLimit(res, rl.retryAfterSeconds); return; }
        const deductResult = await useCredit(db, ctx.uid, `ai:${path}`, creditCost, platformSource);
        const result = await handleAIRequest(path, req.body);
        res.status(200).json({data: result, credits: deductResult});
        await logApiUsageIfKey(ctx, { creditsUsed: creditCost });
      } else {
        // Free endpoint or zero-cost search (quick depth)
        const result = await handleAIRequest(path, req.body);
        res.status(200).json({data: result});
        await logApiUsageIfKey(ctx);
      }
    } catch (error) {
      if (error instanceof functions.https.HttpsError) {
        // Map resource-exhausted to 402
        const statusCode = error.code === "resource-exhausted" ? 402 :
          error.code === "unauthenticated" ? 401 :
          error.code === "not-found" ? 404 :
          error.code === "invalid-argument" ? 400 :
          error.code === "permission-denied" ? 403 : 500;
        res.status(statusCode).json({error: error.message});
        if (ctx) await logApiUsageIfKey(ctx, { isError: true });
        return;
      }
      console.error("AI request error:", error);
      const message = error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({error: message});
      if (ctx) await logApiUsageIfKey(ctx, { isError: true });
    }
  });
});

// Fire-and-forget usage log for API-key callers; no-op for Firebase tokens.
async function logApiUsageIfKey(
  ctx: AuthContext,
  opts: { creditsUsed?: number; isError?: boolean } = {}
): Promise<void> {
  if (ctx.source !== "apikey" || !ctx.keyId) return;
  await logApiUsage(ctx.uid, ctx.keyId, opts);
}

// Stripe webhook (unauthenticated - verified by Stripe signature)
export const stripeWebhook = functions.https.onRequest((req, res) => {
  // No CORS needed for webhooks
  if (req.method !== "POST") {
    res.status(405).json({error: "Method not allowed"});
    return;
  }

  const signature = req.headers["stripe-signature"] as string;
  if (!signature) {
    res.status(400).json({error: "Missing stripe-signature header"});
    return;
  }

  handleWebhookEvent(req.rawBody, signature)
    .then(() => {
      res.status(200).json({received: true});
    })
    .catch((error) => {
      console.error("Webhook error:", error);
      const message = error instanceof Error ? error.message : "Webhook processing failed";
      res.status(400).json({error: message});
    });
});

// EOU (Evidence of Use) endpoints for Patent Evidence Search app
export const eou = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    if (req.method !== "POST") {
      res.status(405).json({error: "Method not allowed"});
      return;
    }

    try {
      const ctx = await resolveAuth(req);
      const decodedToken = asDecodedIdToken(ctx);
      const handler = createEouHandler();
      await handler(req, res, decodedToken);
    } catch (error) {
      if (error instanceof functions.https.HttpsError) {
        const statusCode = error.code === "unauthenticated" ? 401 :
          error.code === "not-found" ? 404 :
          error.code === "invalid-argument" ? 400 :
          error.code === "permission-denied" ? 403 : 500;
        res.status(statusCode).json({error: error.message});
        return;
      }
      console.error("EOU request error:", error);
      const message = error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({error: message});
    }
  });
});

// Slack bot endpoint — routes:
//   POST /command           → slash command dispatcher (14 commands, signature-verified)
//   GET  /install/callback  → Slack OAuth redirect (mints workspace API key)
//   POST /install/begin     → Firebase-auth'd: returns OAuth URL for the install dance
export const slackBot = functions
  .runWith({
    timeoutSeconds: 60,
    memory: "512MB",
    secrets: ["SLACK_CLIENT_ID", "SLACK_CLIENT_SECRET", "SLACK_SIGNING_SECRET"],
  })
  .https.onRequest(async (req, res) => {
    try {
      // Slash command webhook (Slack POSTs form-urlencoded with signature).
      if (req.method === "POST" && req.path === "/command") {
        await handleSlackCommand(req, res);
        return;
      }

      // Events API webhook — currently subscribed to `app_uninstalled` only.
      // Also handles Slack's url_verification challenge during initial setup.
      if (req.method === "POST" && req.path === "/events") {
        await handleSlackEvent(req, res);
        return;
      }

      // OAuth redirect callback (Slack GETs with ?code=&state=).
      if (req.method === "GET" && req.path === "/install/callback") {
        const code = typeof req.query.code === "string" ? req.query.code : "";
        const state = typeof req.query.state === "string" ? req.query.state : "";
        if (!code || !state) {
          res.status(400).send("Missing code or state");
          return;
        }
        const result = await completeInstall(code, state);
        res.status(200).send(
          `<html><body style="font-family:sans-serif;max-width:600px;margin:40px auto;padding:0 20px">` +
          `<h2>✅ AI Patent Search Generator installed</h2>` +
          `<p>Workspace: <strong>${escapeHtml(result.teamName)}</strong></p>` +
          `<p>You can close this tab and try a slash command in Slack:</p>` +
          `<pre>/dossier US10867416B2</pre>` +
          `</body></html>`
        );
        return;
      }

      // Firebase-auth'd install initiator. Used by the extension's Admin tab
      // (or the local mint-install-url script) to get an OAuth URL for a uid.
      if (req.method === "POST" && req.path === "/install/begin") {
        const ctx = await resolveAuth(req);
        const decoded = asDecodedIdToken(ctx);
        const result = await beginInstall(decoded.uid);
        res.status(200).json({data: result});
        return;
      }

      res.status(404).send("Not found");
    } catch (error) {
      if (error instanceof functions.https.HttpsError) {
        const statusCode = error.code === "unauthenticated" ? 401 :
          error.code === "invalid-argument" ? 400 :
          error.code === "permission-denied" ? 403 :
          error.code === "failed-precondition" ? 412 : 500;
        res.status(statusCode).send(error.message);
        return;
      }
      console.error("[slackBot] error", error);
      const message = error instanceof Error ? error.message : "Unknown error";
      res.status(500).send(message);
    }
  });

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" :
    c === "<" ? "&lt;" :
    c === ">" ? "&gt;" :
    c === "\"" ? "&quot;" : "&#39;"
  );
}

// Remote MCP server (Claude Connector Directory) — stateless Streamable HTTP
// JSON-RPC + WorkOS AuthKit OAuth. Served at patent-search-generator.web.app
// via the hosting:psg rewrites (/api/mcp + the RFC 9728 well-known paths).
export {mcp} from "./mcp";
