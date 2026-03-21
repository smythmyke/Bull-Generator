import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import cors from "cors";
import {handleAIRequest} from "./ai";
import {handleCreditRequest, useCredit, FREE_ENDPOINTS} from "./credits";
import {handleWebhookEvent} from "./stripe";
import {createEouHandler} from "./eou";

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
export const ai = functions.https.onRequest((req, res) => {
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

      // Credit endpoints (balance, use, checkout, packs, history)
      if (path.startsWith("/credits/")) {
        const result = await handleCreditRequest(path, req.body, decodedToken);
        res.status(200).json({data: result});
        return;
      }

      // AI endpoints — deduct credits server-side BEFORE processing
      const db = admin.firestore();

      if (!FREE_ENDPOINTS.has(path)) {
        // Rate limit only paid endpoints (free endpoints like synonyms/definitions are exempt)
        if (!checkRateLimit(decodedToken.uid)) {
          res.status(429).json({error: "Rate limit exceeded. Try again in an hour."});
          return;
        }
        // Paid endpoint: deduct 1 credit per AI call, server-side
        const deductResult = await useCredit(db, decodedToken.uid, `ai:${path}`, 1);
        const result = await handleAIRequest(path, req.body);
        res.status(200).json({data: result, credits: deductResult});
      } else {
        // Free endpoint (synonyms, definitions): no credit deduction, no rate limit
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
