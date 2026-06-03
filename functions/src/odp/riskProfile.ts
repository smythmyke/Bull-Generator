/**
 * /v1/risk-profile — DD-1 "Patent Risk Profile" one-shot. Assembles the legal
 * bundle (reused) and turns it into a risk verdict: is this patent in force,
 * battle-tested (survived PTAB), heavily asserted (litigation), and when does
 * it expire? Deterministic signals + a short Gemini narrative.
 *
 * Flat-priced (charged once on a fresh fetch; 24h cache free). Reused by the
 * extension Workflows tab and exposed as an MCP tool + RapidAPI endpoint.
 *
 * Risk is framed from the perspective of someone considering making/selling a
 * product that might read on the patent. NOT legal advice.
 */

import * as admin from "firebase-admin";
import { handleLegalBundleRequest, LegalBundle } from "./legalBundle";
import { getModel } from "../ai";

const CACHE_COLLECTION = "riskProfileCache";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface RiskSignals {
  inForce: boolean | null;
  expirationDate: string;
  challengeCount: number;
  survivedChallenges: boolean | null;
  litigationCount: number;
  currentAssignee: string;
}

interface RiskVerdict {
  riskLabel: "Low" | "Moderate" | "High";
  rationale: string;
  signals: RiskSignals;
}

export interface RiskProfile {
  patentNumber: string;
  generatedAt: string;
  cached: boolean;
  verdict: RiskVerdict;
  legal: LegalBundle;
  disclaimer: string;
}

export interface RiskProfileResult {
  riskProfile?: RiskProfile;
  error?: string;
  code?: "invalid_number" | "not_found" | "rate_limited" | "upstream_error";
}

const DISCLAIMER =
  "Factual public-record reporting (USPTO/PTAB/court dockets) — not legal advice. " +
  "Consult a qualified patent attorney before acting.";

function asRec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}
function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function deriveSignals(b: LegalBundle): RiskSignals {
  const ls = asRec(b.legalStatus);
  const term = asRec(b.term);
  const ch = asRec(b.challenges);
  const lit = asRec(b.litigation);
  const asg = asRec(b.assignments);

  const challenges = Array.isArray(ch.challenges) ? (ch.challenges as Record<string, unknown>[]) : [];
  // "survived" = at least one challenge that was denied institution / terminated
  // without finding claims unpatentable. Heuristic from trialStatusCategory text.
  const survived = challenges.length > 0
    ? challenges.some((c) => {
        const s = String(c.outcome ?? c.trialStatusCategory ?? "").toLowerCase();
        return s.includes("denied") || s.includes("not instituted") || s.includes("dismiss") || s.includes("settled");
      })
    : null;

  return {
    inForce: typeof ls.inForce === "boolean" ? (ls.inForce as boolean) : null,
    expirationDate: String(term.adjustedExpirationDate ?? term.expirationDate ?? ""),
    challengeCount: num(ch.challengeCount) || challenges.length,
    survivedChallenges: survived,
    litigationCount: num(lit.caseCount),
    currentAssignee: String(asg.currentAssignee ?? ""),
  };
}

/** Deterministic baseline label — used as a fallback if the AI call fails. */
function baselineLabel(s: RiskSignals): "Low" | "Moderate" | "High" {
  if (s.inForce === false) return "Low"; // expired/lapsed — limited forward risk
  const asserted = s.litigationCount > 0;
  const attacked = s.challengeCount > 0;
  if (s.litigationCount >= 5 || (asserted && s.survivedChallenges)) return "High";
  if (asserted || attacked) return "Moderate";
  return "Low";
}

async function aiVerdict(patentNumber: string, s: RiskSignals): Promise<{ riskLabel: "Low" | "Moderate" | "High"; rationale: string }> {
  const facts = [
    `In force: ${s.inForce === null ? "unknown" : s.inForce ? "yes" : "no (expired/lapsed)"}`,
    `Expiration: ${s.expirationDate || "unknown"}`,
    `PTAB validity challenges: ${s.challengeCount}${s.challengeCount > 0 ? ` (survived/denied at least one: ${s.survivedChallenges ? "yes" : "no/unclear"})` : ""}`,
    `District-court infringement suits on record: ${s.litigationCount}`,
    `Current assignee: ${s.currentAssignee || "unknown"}`,
  ].join("; ");

  const prompt =
    `You are a patent risk analyst. Given these public-record facts about US patent ${patentNumber}, ` +
    `return ONLY a JSON object {"riskLabel":"Low|Moderate|High","rationale":"2-3 sentence plain-English explanation"}. ` +
    `Risk is from the perspective of a party considering making/selling a product that might read on this patent: ` +
    `an in-force, heavily-litigated patent that has survived validity challenges is HIGH risk; an expired or never-asserted patent is LOW. ` +
    `Be factual, cite the numbers, no legal advice. Facts: ${facts}.`;

  const result = await getModel().generateContent({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
  });
  const parsed = JSON.parse(result.response.text()) as { riskLabel?: string; rationale?: string };
  const label = parsed.riskLabel === "Low" || parsed.riskLabel === "Moderate" || parsed.riskLabel === "High"
    ? parsed.riskLabel
    : baselineLabel(s);
  return { riskLabel: label, rationale: String(parsed.rationale || "").trim() || fallbackRationale(s) };
}

function fallbackRationale(s: RiskSignals): string {
  const parts: string[] = [];
  parts.push(s.inForce === false ? "The patent appears expired or lapsed." : "The patent appears in force.");
  if (s.litigationCount > 0) parts.push(`It has ${s.litigationCount} district-court suit(s) on record.`);
  else parts.push("No district-court suits are on record.");
  if (s.challengeCount > 0) parts.push(`It faced ${s.challengeCount} PTAB challenge(s).`);
  return parts.join(" ");
}

async function readCache(db: admin.firestore.Firestore, key: string): Promise<RiskProfile | null> {
  const snap = await db.collection(CACHE_COLLECTION).doc(key).get();
  if (!snap.exists) return null;
  const data = snap.data();
  if (!data) return null;
  const writtenAt = (data.writtenAt as admin.firestore.Timestamp | undefined)?.toMillis() ?? 0;
  if (Date.now() - writtenAt > CACHE_TTL_MS) return null;
  return { ...(data.profile as RiskProfile), cached: true };
}

async function writeCache(db: admin.firestore.Firestore, key: string, profile: RiskProfile): Promise<void> {
  await db.collection(CACHE_COLLECTION).doc(key).set({
    profile,
    writtenAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

export async function handleRiskProfileRequest(
  body: { patentNumber?: string }
): Promise<RiskProfileResult> {
  const patentNumber = typeof body.patentNumber === "string" ? body.patentNumber.trim() : "";
  const key = patentNumber.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!key) return { error: "patentNumber is required", code: "invalid_number" };

  const db = admin.firestore();
  const hit = await readCache(db, key);
  if (hit) return { riskProfile: hit };

  const bundleResult = await handleLegalBundleRequest({ patentNumber });
  if (bundleResult.error || !bundleResult.bundle) {
    return { error: bundleResult.error || "Failed to assemble legal data", code: bundleResult.code };
  }
  const bundle = bundleResult.bundle;
  const signals = deriveSignals(bundle);

  let verdict: RiskVerdict;
  try {
    const ai = await aiVerdict(bundle.patentNumber, signals);
    verdict = { riskLabel: ai.riskLabel, rationale: ai.rationale, signals };
  } catch (e) {
    console.warn(`[risk-profile] AI verdict failed for ${key}, using baseline:`, e);
    verdict = { riskLabel: baselineLabel(signals), rationale: fallbackRationale(signals), signals };
  }

  const profile: RiskProfile = {
    patentNumber: bundle.patentNumber,
    generatedAt: new Date().toISOString(),
    cached: false,
    verdict,
    legal: bundle,
    disclaimer: DISCLAIMER,
  };

  writeCache(db, key, profile).catch((e) =>
    console.warn(`[risk-profile] cache write failed for ${key}:`, e)
  );

  return { riskProfile: profile };
}
