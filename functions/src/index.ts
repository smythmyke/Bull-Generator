import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import cors from "cors";
import {handleAIRequest} from "./ai";
import {handleCreditRequest, useCredit, FREE_ENDPOINTS} from "./credits";
import {handleWebhookEvent} from "./stripe";
import {createEouHandler} from "./eou";
import {handleAdminRequest} from "./admin";
import {handlePatentDossierRequest, handleDossierSummaryRequest} from "./patentDossier";
import {handleClaimChartRequest} from "./claimChart";
import {handleProsecutionHistoryRequest, handleOdpDocumentRequest} from "./usptoOdp";
import {handleOfficeActionAnalysisRequest} from "./officeActionAnalyzer";
import {handleExaminerStatsRequest} from "./examinerStats";

const DOSSIER_CREDIT_COST = 3;
const OA_ANALYSIS_CREDIT_COST = 1;

admin.initializeApp();

const corsHandler = cors({origin: true});

// Rate limiting map: userId -> { count, resetTime }
const rateLimits = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT = 100; // requests per hour
const RATE_WINDOW = 60 * 60 * 1000; // 1 hour

function checkRateLimit(userId: string): boolean {
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

async function verifyAuth(
  req: functions.https.Request
): Promise<admin.auth.DecodedIdToken> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "Missing or invalid Authorization header"
    );
  }

  const idToken = authHeader.split("Bearer ")[1];
  try {
    return await admin.auth().verifyIdToken(idToken);
  } catch {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "Invalid or expired token"
    );
  }
}

// AI proxy endpoints
export const ai = functions.runWith({ timeoutSeconds: 300, memory: "512MB" }).https.onRequest((req, res) => {
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
      const decodedToken = await verifyAuth(req);

      // Route based on path
      const path = req.path;

      // Admin endpoints
      if (path.startsWith("/admin/")) {
        const result = await handleAdminRequest(path, req.body, decodedToken);
        res.status(200).json({data: result});
        return;
      }

      // Credit endpoints (balance, use, checkout, packs, history)
      if (path.startsWith("/credits/")) {
        const result = await handleCreditRequest(path, req.body, decodedToken);
        res.status(200).json({data: result});
        return;
      }

      // Patent Dossier endpoint — separate from AI proxy. Credits deducted
      // only on a fresh fetch (cache hits are free for the caller).
      if (path === "/patent-dossier") {
        const db = admin.firestore();
        if (!checkRateLimit(decodedToken.uid)) {
          res.status(429).json({error: "Rate limit exceeded. Try again in an hour."});
          return;
        }
        const result = await handlePatentDossierRequest(req.body);
        if (result.error) {
          const statusCode = result.code === "invalid_number" ? 400 :
            result.code === "not_found" ? 404 :
            result.code === "rate_limited" ? 429 : 502;
          res.status(statusCode).json({error: result.error, code: result.code});
          return;
        }
        // Only charge when we actually fetched fresh data
        if (result.dossier && !result.dossier.cached) {
          const deductResult = await useCredit(
            db,
            decodedToken.uid,
            `dossier:${result.dossier.patentNumber}`,
            DOSSIER_CREDIT_COST
          );
          res.status(200).json({data: result.dossier, credits: deductResult});
        } else {
          res.status(200).json({data: result.dossier});
        }
        return;
      }

      // Claim Chart § 12 — bundled with the 3-credit dossier fetch, free.
      // Merges dossier claims + OA-cited art into per-claim element chart.
      if (path === "/claim-chart") {
        if (!checkRateLimit(decodedToken.uid)) {
          res.status(429).json({error: "Rate limit exceeded. Try again in an hour."});
          return;
        }
        const result = await handleClaimChartRequest(req.body);
        if (result.error) {
          const statusCode = result.code === "invalid_input" ? 400 : 502;
          res.status(statusCode).json({error: result.error, code: result.code});
          return;
        }
        res.status(200).json({data: result.chart});
        return;
      }

      // Dossier AI summary — bundled with the 3-credit dossier fetch, so this
      // endpoint is free to call. Rate-limited like other writes.
      if (path === "/dossier-summary") {
        if (!checkRateLimit(decodedToken.uid)) {
          res.status(429).json({error: "Rate limit exceeded. Try again in an hour."});
          return;
        }
        const result = await handleDossierSummaryRequest(req.body);
        if (result.error) {
          const statusCode = result.code === "invalid_number" ? 400 :
            result.code === "not_found" ? 404 :
            result.code === "rate_limited" ? 429 : 502;
          res.status(statusCode).json({error: result.error, code: result.code});
          return;
        }
        res.status(200).json({data: result.summary});
        return;
      }

      // USPTO ODP prosecution history — free, lazy-loaded from the dossier.
      // Future AI-heavy slices (OA analyzer) will charge separately.
      if (path === "/prosecution-history") {
        if (!checkRateLimit(decodedToken.uid)) {
          res.status(429).json({error: "Rate limit exceeded. Try again in an hour."});
          return;
        }
        const result = await handleProsecutionHistoryRequest(req.body);
        if (result.error) {
          const statusCode =
            result.code === "invalid_number" ? 400 :
            result.code === "out_of_coverage" ? 404 :
            result.code === "not_found" ? 404 :
            result.code === "no_api_key" ? 503 : 502;
          res.status(statusCode).json({error: result.error, code: result.code});
          return;
        }
        res.status(200).json({data: result.history});
        return;
      }

      // Office Action analyzer — fetches the OA PDF, Gemini-summarizes into
      // rejections + cited art + suggested arguments. First 5 analyses per
      // application are free; subsequent fresh analyses cost 1 credit each.
      if (path === "/oa-analyze") {
        const db = admin.firestore();
        if (!checkRateLimit(decodedToken.uid)) {
          res.status(429).json({error: "Rate limit exceeded. Try again in an hour."});
          return;
        }
        const result = await handleOfficeActionAnalysisRequest(req.body, decodedToken.uid);
        if (result.error) {
          const statusCode =
            result.code === "invalid_input" ? 400 :
            result.code === "not_found" ? 404 :
            result.code === "no_api_key" ? 503 :
            result.code === "ai_failed" ? 502 : 502;
          res.status(statusCode).json({error: result.error, code: result.code});
          return;
        }
        const payload = { analysis: result.analysis, quota: result.quota };
        if (result.billed) {
          const deductResult = await useCredit(
            db,
            decodedToken.uid,
            `oa:${result.analysis!.documentId}`,
            OA_ANALYSIS_CREDIT_COST
          );
          res.status(200).json({data: payload, credits: deductResult});
        } else {
          res.status(200).json({data: payload});
        }
        return;
      }

      // Examiner stats — examiner identity + aggregate stats (allowance rate,
      // avg pendency) from USPTO ODP. Free, auto-loaded with the dossier.
      if (path === "/examiner-stats") {
        if (!checkRateLimit(decodedToken.uid)) {
          res.status(429).json({error: "Rate limit exceeded. Try again in an hour."});
          return;
        }
        const result = await handleExaminerStatsRequest(req.body);
        if (result.error) {
          const statusCode =
            result.code === "invalid_input" ? 400 :
            result.code === "not_found" ? 404 :
            result.code === "no_examiner" ? 404 :
            result.code === "no_api_key" ? 503 : 502;
          res.status(statusCode).json({error: result.error, code: result.code});
          return;
        }
        res.status(200).json({data: result.stats});
        return;
      }

      // USPTO ODP PDF proxy — streams a file-wrapper PDF back to the browser
      // (ODP URLs require X-API-KEY, so direct <a href> wouldn't work).
      if (path === "/odp-document") {
        if (!checkRateLimit(decodedToken.uid)) {
          res.status(429).json({error: "Rate limit exceeded. Try again in an hour."});
          return;
        }
        const result = await handleOdpDocumentRequest(req.body);
        if (result.error) {
          const statusCode =
            result.code === "invalid_input" ? 400 :
            result.code === "not_found" ? 404 :
            result.code === "no_api_key" ? 503 :
            result.code === "too_large" ? 413 : 502;
          res.status(statusCode).json({error: result.error, code: result.code});
          return;
        }
        res.set("Content-Type", result.contentType || "application/pdf");
        res.set("Content-Disposition", `inline; filename="${result.filename}"`);
        res.status(200).send(result.buffer);
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
        if (!checkRateLimit(decodedToken.uid)) {
          res.status(429).json({error: "Rate limit exceeded. Try again in an hour."});
          return;
        }
        const deductResult = await useCredit(db, decodedToken.uid, `ai:${path}`, creditCost);
        const result = await handleAIRequest(path, req.body);
        res.status(200).json({data: result, credits: deductResult});
      } else {
        // Free endpoint or zero-cost search (quick depth)
        const result = await handleAIRequest(path, req.body);
        res.status(200).json({data: result});
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
        return;
      }
      console.error("AI request error:", error);
      const message = error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({error: message});
    }
  });
});

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
      const decodedToken = await verifyAuth(req);
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
