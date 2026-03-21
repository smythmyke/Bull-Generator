/**
 * EOU (Evidence of Use) Cloud Function router.
 *
 * Separate endpoint from the Bull-Generator `ai` function.
 * Handles patent fetching, claim decomposition, and evidence evaluation.
 *
 * All endpoints require Firebase Auth (Bearer token).
 * Billing is handled by a gate check — pricing model TBD.
 */

import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import {handlePatentFetch} from "./eouPatent";
import {handleDecompose, handleEvaluate} from "./eouAi";

// ── Billing Gate ──

async function checkBillingGate(
  _uid: string,
  _action: string
): Promise<void> {
  // TODO: Implement billing check when pricing model is decided.
  // For now, all authenticated users can use EOU endpoints.
  // Future options: per-search flat rate, per-claim, subscription.
}

// ── Rate Limiting ──

const rateLimits = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT = 50;
const RATE_WINDOW = 60 * 60 * 1000;

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

// ── Route Handler ──

export async function handleEouRequest(
  path: string,
  body: Record<string, unknown>
): Promise<unknown> {
  switch (path) {
  case "/patent":
    return handlePatentFetch(body);

  case "/decompose":
    return handleDecompose(body);

  case "/evaluate":
    return handleEvaluate(body);

  default:
    throw new functions.https.HttpsError(
      "not-found",
      `Unknown EOU endpoint: ${path}`
    );
  }
}

// Endpoints that don't need billing (free lookups)
const FREE_EOU_ENDPOINTS = new Set(["/patent"]);

// ── Exported Handler Factory ──

export function createEouHandler() {
  return async (
    req: functions.https.Request,
    res: functions.Response,
    decodedToken: admin.auth.DecodedIdToken
  ): Promise<void> => {
    const path = req.path;

    // Rate limit
    if (!checkRateLimit(decodedToken.uid)) {
      res.status(429).json({error: "Rate limit exceeded. Try again in an hour."});
      return;
    }

    // Billing gate (skip for free endpoints)
    if (!FREE_EOU_ENDPOINTS.has(path)) {
      await checkBillingGate(decodedToken.uid, `eou:${path}`);
    }

    const result = await handleEouRequest(path, req.body);
    res.status(200).json({data: result});
  };
}
