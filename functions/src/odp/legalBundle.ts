/**
 * /v1/legal-bundle — one call that assembles the full per-patent "legal
 * intelligence" layer by fanning out the nine net-new ODP/PTAB/litigation
 * endpoints in parallel, so the extension (and API/MCP/RapidAPI) can load and
 * bill the whole bundle as a single unit instead of nine round-trips.
 *
 * Caching: 24h in `legalBundleCache` (separate collection). Cache hit → free.
 * Credits are charged by the dispatcher in index.ts only on a fresh fetch
 * (mirrors /patent-dossier). Each slice degrades independently — one upstream
 * failure returns `{error}` for that slice without sinking the whole bundle.
 *
 * Not included: company-litigation (keyed by company, not patent).
 */

import * as admin from "firebase-admin";
import { handleLegalStatusRequest } from "./legalStatus";
import { handleChallengesRequest } from "./ptab";
import { handleAssignmentsRequest } from "./assignments";
import {
  handleTermRequest,
  handleProsecutionTimelineRequest,
  handleAttorneyRequest,
  handleEntityStatusRequest,
  handlePregrantPubRequest,
} from "./enrichment";
import { handleLitigationRequest } from "../litigation";

const CACHE_COLLECTION = "legalBundleCache";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface SliceError {
  error: string;
  code: string;
}

export interface LegalBundle {
  patentNumber: string;
  generatedAt: string;
  cached: boolean;
  legalStatus: unknown;
  term: unknown;
  challenges: unknown;
  litigation: unknown;
  assignments: unknown;
  prosecutionTimeline: unknown;
  attorney: unknown;
  entityStatus: unknown;
  pregrant: unknown;
}

export interface LegalBundleResult {
  bundle?: LegalBundle;
  error?: string;
  code?: "invalid_number" | "not_found" | "rate_limited" | "upstream_error";
}

function cacheKey(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

async function readCache(
  db: admin.firestore.Firestore,
  key: string
): Promise<LegalBundle | null> {
  const snap = await db.collection(CACHE_COLLECTION).doc(key).get();
  if (!snap.exists) return null;
  const data = snap.data();
  if (!data) return null;
  const writtenAt = (data.writtenAt as admin.firestore.Timestamp | undefined)?.toMillis() ?? 0;
  if (Date.now() - writtenAt > CACHE_TTL_MS) return null;
  return { ...(data.bundle as LegalBundle), cached: true };
}

async function writeCache(
  db: admin.firestore.Firestore,
  key: string,
  bundle: LegalBundle
): Promise<void> {
  await db.collection(CACHE_COLLECTION).doc(key).set({
    bundle,
    writtenAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

/** Run a slice handler, converting a thrown error into an inline slice error. */
async function settle<T>(p: Promise<T>): Promise<T | SliceError> {
  try {
    return await p;
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e), code: "upstream_error" };
  }
}

export async function handleLegalBundleRequest(
  body: { patentNumber?: string }
): Promise<LegalBundleResult> {
  const patentNumber = typeof body.patentNumber === "string" ? body.patentNumber.trim() : "";
  const key = cacheKey(patentNumber);
  if (!key) return { error: "patentNumber is required", code: "invalid_number" };

  const db = admin.firestore();
  const hit = await readCache(db, key);
  if (hit) return { bundle: hit };

  const arg = { patentNumber };
  const [
    legalStatus,
    term,
    challenges,
    litigation,
    assignments,
    prosecutionTimeline,
    attorney,
    entityStatus,
    pregrant,
  ] = await Promise.all([
    settle(handleLegalStatusRequest(arg)),
    settle(handleTermRequest(arg)),
    settle(handleChallengesRequest(arg)),
    settle(handleLitigationRequest(arg)),
    settle(handleAssignmentsRequest(arg)),
    settle(handleProsecutionTimelineRequest(arg)),
    settle(handleAttorneyRequest(arg)),
    settle(handleEntityStatusRequest(arg)),
    settle(handlePregrantPubRequest(arg)),
  ]);

  // Existence gate: the ODP file-wrapper lookup (legal-status) decides validity.
  // A bad number / missing wrapper fails the whole bundle (so it isn't charged)
  // instead of returning nine slice errors.
  const ls = legalStatus as { error?: string; code?: string; patentNumber?: string };
  if (ls.code === "invalid_number" || ls.code === "not_found") {
    return { error: ls.error || "Patent not found", code: ls.code as "invalid_number" | "not_found" };
  }

  const bundle: LegalBundle = {
    patentNumber: ls.patentNumber || patentNumber,
    generatedAt: new Date().toISOString(),
    cached: false,
    legalStatus,
    term,
    challenges,
    litigation,
    assignments,
    prosecutionTimeline,
    attorney,
    entityStatus,
    pregrant,
  };

  writeCache(db, key, bundle).catch((e) =>
    console.warn(`[legal-bundle] cache write failed for ${key}:`, e)
  );

  return { bundle };
}
