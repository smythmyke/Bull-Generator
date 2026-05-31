/**
 * PTAB validity-challenge history for a patent — the `/v1/challenges` endpoint
 * (MCP `patent_challenges`). Answers "who challenged this patent's validity, of
 * what type, and what happened."
 *
 * Source: USPTO PTAB Trials API on ODP (same key as the dossier path).
 *   POST https://api.uspto.gov/api/v1/patent/trials/proceedings/search
 *   body: { "q": "patentOwnerData.patentNumber:<digits>" }
 * Verified 2026-05-31. Public-domain data; factual reporting (not a legal
 * opinion) — see PLAN-API-DATA-MIGRATION.md Phase 8a.
 *
 * Trial-level outcome (survived / decided / settled) is structured here via
 * trialStatusCategory. Per-claim rulings live in the Final Written Decision PDF
 * (documents endpoint) and are a separate, AI-parsed premium operation.
 */

import * as admin from "firebase-admin";
import { normalizePatentNumber } from "../patentDossier";
import { toUsPatentDigits, str } from "./util";
import { odpRequest, OdpAuthError, OdpRateLimitedError } from "./odpClient";

const PTAB_SEARCH_URL =
  "https://api.uspto.gov/api/v1/patent/trials/proceedings/search";

export type ChallengeOutcome =
  | "patent_survived"        // institution denied — challenge failed at the gate
  | "final_written_decision" // reached a final decision (see decision doc for per-claim result)
  | "instituted_pending"     // instituted, not yet final
  | "terminated"             // settled / dismissed / withdrawn
  | "other";

export interface PatentChallenge {
  trialNumber: string;          // e.g. "IPR2019-01559"
  type: string;                 // IPR | PGR | CBM | DER
  petitioner: string;           // challenger (real party in interest)
  petitionerCounsel: string;
  patentOwner: string;
  patentOwnerCounsel: string;
  petitionFilingDate: string;
  institutionDecisionDate: string;
  status: string;               // raw trialStatusCategory
  outcome: ChallengeOutcome;    // normalized
}

export interface ChallengesResult {
  patentNumber?: string;
  challengeCount?: number;
  challenges?: PatentChallenge[];
  cached?: boolean;
  error?: string;
  code?: "invalid_number" | "not_found" | "fetch_failed" | "rate_limited";
}

// ── Raw PTAB shapes (only fields we read) ───────────────────────────────

interface PtabParty {
  realPartyInInterestName?: string;
  counselName?: string;
}

interface PtabTrialMeta {
  trialTypeCode?: string;
  petitionFilingDate?: string;
  accordedFilingDate?: string;
  institutionDecisionDate?: string;
  trialStatusCategory?: string;
}

interface PtabProceeding {
  trialNumber?: string;
  trialMetaData?: PtabTrialMeta;
  patentOwnerData?: PtabParty;
  regularPetitionerData?: PtabParty;
}

interface PtabSearchResponse {
  count?: number;
  patentTrialProceedingDataBag?: PtabProceeding[];
}

// ── Outcome normalization ───────────────────────────────────────────────

function classifyOutcome(statusCategory: string): ChallengeOutcome {
  const s = statusCategory.toLowerCase();
  if (s.includes("denied")) return "patent_survived";
  if (s.includes("final written")) return "final_written_decision";
  if (s.includes("terminat") || s.includes("settl") || s.includes("dismiss")) return "terminated";
  if (s.includes("instituted")) return "instituted_pending";
  return "other";
}

function transform(p: PtabProceeding): PatentChallenge | null {
  const trialNumber = str(p.trialNumber);
  if (!trialNumber) return null;
  const tm = p.trialMetaData ?? {};
  const owner = p.patentOwnerData ?? {};
  const pet = p.regularPetitionerData ?? {};
  const status = str(tm.trialStatusCategory);
  return {
    trialNumber,
    type: str(tm.trialTypeCode),
    petitioner: str(pet.realPartyInInterestName),
    petitionerCounsel: str(pet.counselName),
    patentOwner: str(owner.realPartyInInterestName),
    patentOwnerCounsel: str(owner.counselName),
    petitionFilingDate: str(tm.petitionFilingDate) || str(tm.accordedFilingDate),
    institutionDecisionDate: str(tm.institutionDecisionDate),
    status,
    outcome: classifyOutcome(status),
  };
}

// ── Cache (PTAB data changes slowly) ────────────────────────────────────

const CACHE_COLLECTION = "ptabChallengesCache";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

async function readCache(
  db: admin.firestore.Firestore,
  digits: string
): Promise<PatentChallenge[] | null> {
  const snap = await db.collection(CACHE_COLLECTION).doc(digits).get();
  const data = snap.data();
  if (!data) return null;
  const writtenAt = (data.writtenAt as admin.firestore.Timestamp | undefined)?.toMillis() ?? 0;
  if (Date.now() - writtenAt > CACHE_TTL_MS) return null;
  return data.challenges as PatentChallenge[];
}

// ── Handler ─────────────────────────────────────────────────────────────

export async function handleChallengesRequest(
  body: { patentNumber?: string }
): Promise<ChallengesResult> {
  const apiKey = process.env.USPTO_ODP_API_KEY;
  if (!apiKey) return { error: "USPTO ODP API key not configured", code: "fetch_failed" };

  const normalized = normalizePatentNumber(body.patentNumber || "");
  if (!normalized || normalized.length < 5) {
    return { error: "Invalid patent number", code: "invalid_number" };
  }
  const digits = toUsPatentDigits(normalized);
  if (!digits) {
    return {
      error: `Only US patents are supported (v1). '${normalized}' is not a US patent number.`,
      code: "invalid_number",
    };
  }

  const db = admin.firestore();
  const cached = await readCache(db, digits);
  if (cached) {
    return { patentNumber: normalized, challengeCount: cached.length, challenges: cached, cached: true };
  }

  let resp: PtabSearchResponse;
  try {
    const r = await odpRequest(PTAB_SEARCH_URL, apiKey, {
      method: "POST",
      body: { q: `patentOwnerData.patentNumber:${digits}` },
    });
    if (r.status === 404) {
      // PTAB returns 404 when there are no matching proceedings — not an error.
      resp = { patentTrialProceedingDataBag: [] };
    } else {
      resp = (await r.json()) as PtabSearchResponse;
    }
  } catch (e) {
    if (e instanceof OdpAuthError) return { error: "USPTO ODP authentication failed", code: "fetch_failed" };
    if (e instanceof OdpRateLimitedError) {
      return { error: "USPTO ODP is throttling requests. Try again in a minute.", code: "rate_limited" };
    }
    const message = e instanceof Error ? e.message : String(e);
    return { error: `PTAB fetch failed: ${message}`, code: "fetch_failed" };
  }

  const challenges = (resp.patentTrialProceedingDataBag ?? [])
    .map(transform)
    .filter((c): c is PatentChallenge => c !== null)
    .sort((a, b) => (b.petitionFilingDate || "").localeCompare(a.petitionFilingDate || ""));

  // Write-through cache; don't block on failure.
  db.collection(CACHE_COLLECTION).doc(digits).set({
    challenges,
    writtenAt: admin.firestore.FieldValue.serverTimestamp(),
  }).catch((e) => console.warn(`[PTAB] Cache write failed for ${digits}:`, e));

  return { patentNumber: normalized, challengeCount: challenges.length, challenges, cached: false };
}
