/**
 * Patent in-force / legal status — the `/v1/legal-status` endpoint
 * (MCP `patent_legal_status`). Answers "is this patent still alive, and how
 * long is it enforceable?"
 *
 * Derived from the ODP file wrapper (same fetch as the dossier): application
 * status + the maintenance-fee events in `eventDataBag`. US-only, public-domain.
 * Screening-grade — see PLAN-API-DATA-MIGRATION.md Phase 7.
 */

import * as admin from "firebase-admin";
import { normalizePatentNumber } from "../patentDossier";
import { toUsPatentDigits, str, computeExpiration } from "./util";
import {
  searchByPatentNumber,
  OdpAuthError,
  OdpRateLimitedError,
  type OdpEvent,
} from "./odpClient";

export interface MaintenanceEvent {
  date: string;
  code: string;
  description: string;
}

export interface LegalStatusResult {
  patentNumber?: string;
  inForce?: boolean | null;
  statusLabel?: string;             // raw USPTO application status
  grantDate?: string;
  anticipatedExpiration?: string;
  lastMaintenancePayment?: string;  // date of most recent maintenance-fee payment
  maintenanceEvents?: MaintenanceEvent[];
  lapseOrExpirationEvent?: MaintenanceEvent | null;
  cached?: boolean;
  error?: string;
  code?: "invalid_number" | "not_found" | "fetch_failed" | "rate_limited";
}

function isMaintenance(e: OdpEvent): boolean {
  const code = str(e.eventCode);
  const desc = str(e.eventDescriptionText).toLowerCase();
  return /^M15/.test(code) || desc.includes("maintenance fee");
}

function isLapseOrExpiry(e: OdpEvent): boolean {
  const desc = str(e.eventDescriptionText).toLowerCase();
  return desc.includes("expir") || desc.includes("abandon") ||
    desc.includes("lapse") || str(e.eventCode).toUpperCase() === "EXP.";
}

function toEvent(e: OdpEvent): MaintenanceEvent {
  return { date: str(e.eventDate), code: str(e.eventCode), description: str(e.eventDescriptionText) };
}

const CACHE_COLLECTION = "legalStatusCache";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

async function readCache(
  db: admin.firestore.Firestore,
  digits: string
): Promise<LegalStatusResult | null> {
  const snap = await db.collection(CACHE_COLLECTION).doc(digits).get();
  const data = snap.data();
  if (!data) return null;
  const writtenAt = (data.writtenAt as admin.firestore.Timestamp | undefined)?.toMillis() ?? 0;
  if (Date.now() - writtenAt > CACHE_TTL_MS) return null;
  return { ...(data.result as LegalStatusResult), cached: true };
}

export async function handleLegalStatusRequest(
  body: { patentNumber?: string }
): Promise<LegalStatusResult> {
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
  if (cached) return { ...cached, patentNumber: normalized };

  let wrapper;
  try {
    wrapper = await searchByPatentNumber(digits, apiKey);
  } catch (e) {
    if (e instanceof OdpAuthError) return { error: "USPTO ODP authentication failed", code: "fetch_failed" };
    if (e instanceof OdpRateLimitedError) {
      return { error: "USPTO ODP is throttling requests. Try again in a minute.", code: "rate_limited" };
    }
    const message = e instanceof Error ? e.message : String(e);
    return { error: `Fetch failed: ${message}`, code: "fetch_failed" };
  }
  if (!wrapper) {
    return {
      error: `No US patent ${digits} found in USPTO ODP (may pre-date 2001 coverage or not exist).`,
      code: "not_found",
    };
  }

  const md = (wrapper.applicationMetaData ?? {}) as Record<string, unknown>;
  const statusLabel = str(md.applicationStatusDescriptionText);
  const grantDate = str(md.grantDate);
  const expiration = computeExpiration(str(md.filingDate), str(md.effectiveFilingDate) || str(md.filingDate));

  const events = wrapper.eventDataBag ?? [];
  const maintenanceEvents = events.filter(isMaintenance).map(toEvent)
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const lapseEvent = events.find(isLapseOrExpiry);
  const lapseOrExpirationEvent = lapseEvent ? toEvent(lapseEvent) : null;

  const today = new Date().toISOString().slice(0, 10);
  let inForce: boolean | null;
  if (!/patent/i.test(statusLabel)) inForce = false;          // pending / abandoned — not an in-force patent
  else if (lapseOrExpirationEvent) inForce = false;            // lapsed for non-payment / expired
  else if (expiration && expiration < today) inForce = false;  // 20-year term ended
  else if (statusLabel) inForce = true;
  else inForce = null;                                         // unknown

  const result: LegalStatusResult = {
    patentNumber: normalized,
    inForce,
    statusLabel,
    grantDate,
    anticipatedExpiration: expiration,
    lastMaintenancePayment: maintenanceEvents[0]?.date || "",
    maintenanceEvents,
    lapseOrExpirationEvent,
    cached: false,
  };

  db.collection(CACHE_COLLECTION).doc(digits).set({
    result: { ...result, cached: false },
    writtenAt: admin.firestore.FieldValue.serverTimestamp(),
  }).catch((e) => console.warn(`[LegalStatus] Cache write failed for ${digits}:`, e));

  return result;
}
