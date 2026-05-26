import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import cors from "cors";
import {handleAIRequest} from "./ai";
import {handleCreditRequest, useCredit, FREE_ENDPOINTS} from "./credits";
import {handleWebhookEvent} from "./stripe";
import {createEouHandler} from "./eou";
import {handleAdminRequest} from "./admin";
import {
  handlePatentDossierRequest,
  handleDossierSummaryRequest,
  handleSimilarRequest,
  handleCitationsRequest,
  handleFamilyRequest,
} from "./patentDossier";
import {handleClaimChartRequest} from "./claimChart";
import {handleProsecutionHistoryRequest, handleOdpDocumentRequest} from "./usptoOdp";
import {handleOfficeActionAnalysisRequest} from "./officeActionAnalyzer";
import {handleExaminerStatsRequest} from "./examinerStats";
import {
  AuthContext,
  resolveAuth,
  asDecodedIdToken,
  hasScope,
} from "./auth";
import {handleKeysRequest} from "./keys";
import {checkApiKeyRateLimit, logApiUsage} from "./apiRateLimit";
import {handleCpcRequest} from "./cpc";
import {handleSearchExecuteRequest, handleSearchQueryRequest} from "./searchExecute";

const DOSSIER_CREDIT_COST = 3;
const OA_ANALYSIS_CREDIT_COST = 1;

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
  if (path === "/cpc") return "dossier";
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
export const ai = functions.runWith({ timeoutSeconds: 300, memory: "512MB" }).https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    if (req.method !== "POST" && req.method !== "GET" && req.method !== "DELETE") {
      res.status(405).json({error: "Method not allowed"});
      return;
    }

    let ctx: AuthContext | null = null;

    try {
      ctx = await resolveAuth(req);
      const decodedToken = asDecodedIdToken(ctx);
      const path = normalizePath(req.path);

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
        const result = await handlePatentDossierRequest(req.body);
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
            DOSSIER_CREDIT_COST
          );
          res.status(200).json({data: result.dossier, credits: deductResult});
          await logApiUsageIfKey(ctx, { creditsUsed: DOSSIER_CREDIT_COST });
        } else {
          res.status(200).json({data: result.dossier});
          await logApiUsageIfKey(ctx);
        }
        return;
      }

      // Claim Chart § 12 — bundled with the 3-credit dossier fetch, free.
      // Merges dossier claims + OA-cited art into per-claim element chart.
      if (path === "/claim-chart") {
        const rl = await checkRateLimitFor(ctx);
        if (rl) { sendRateLimit(res, rl.retryAfterSeconds); return; }
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
        const result = await handleDossierSummaryRequest(req.body);
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
        const result = await handleSimilarRequest(req.body);
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
        const result = await handleCitationsRequest(req.body);
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
        const result = await handleFamilyRequest(req.body);
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

      // Patent search — `mode: "execute"` runs the search against Google
      // Patents server-side and returns ranked hits; `mode: "optimize"`
      // returns just the optimized Boolean query string for manual paste.
      // 1 credit either way (covers AI work).
      if (path === "/search-execute" || path === "/search-query") {
        const db = admin.firestore();
        const rl = await checkRateLimitFor(ctx);
        if (rl) { sendRateLimit(res, rl.retryAfterSeconds); return; }
        const isExecute = path === "/search-execute";
        const result = isExecute
          ? await handleSearchExecuteRequest(req.body)
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
        const deductResult = await useCredit(db, ctx.uid, `search:${isExecute ? "execute" : "query"}`, 1);
        res.status(200).json({data: result, credits: deductResult});
        await logApiUsageIfKey(ctx, { creditsUsed: 1 });
        return;
      }

      // CPC classification lookup. Free. v1.0 uses curated static dataset;
      // full USPTO scheme planned for v1.1.
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
            OA_ANALYSIS_CREDIT_COST
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
        const deductResult = await useCredit(db, ctx.uid, `ai:${path}`, creditCost);
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
