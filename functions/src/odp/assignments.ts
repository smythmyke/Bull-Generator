/**
 * Patent chain of title — the `/v1/assignments` endpoint
 * (MCP `patent_assignments`). Answers "who owns this patent now, and what's the
 * recorded transfer history?"
 *
 * Derived from the ODP file wrapper's `assignmentBag` (same fetch as the
 * dossier): recorded conveyances with reel/frame, assignor/assignee, dates.
 * US-only, public-domain. See PLAN-API-DATA-MIGRATION.md Phase 7.
 */

import * as admin from "firebase-admin";
import { normalizePatentNumber } from "../patentDossier";
import { toUsPatentDigits, str } from "./util";
import { searchByPatentNumber, OdpAuthError, OdpRateLimitedError } from "./odpClient";

export interface AssignmentParty {
  name: string;
  executionDate?: string;
}

export interface PatentAssignment {
  reelFrame: string;
  conveyanceText: string;        // e.g. "ASSIGNMENT OF ASSIGNOR'S INTEREST"
  recordedDate: string;
  assignors: AssignmentParty[];  // who transferred the rights
  assignees: string[];           // who received them
}

export interface AssignmentsResult {
  patentNumber?: string;
  currentAssignee?: string;      // most-recently recorded assignee
  assignmentCount?: number;
  assignments?: PatentAssignment[];
  cached?: boolean;
  error?: string;
  code?: "invalid_number" | "not_found" | "fetch_failed" | "rate_limited";
}

function assigneeName(o: Record<string, unknown>): string {
  return str(o.assigneeNameText) || str(o.nameLineOneText) || str(o.organizationName);
}

function parseAssignment(raw: Record<string, unknown>): PatentAssignment {
  const assignorBag = Array.isArray(raw.assignorBag) ? raw.assignorBag : [];
  const assigneeBag = Array.isArray(raw.assigneeBag) ? raw.assigneeBag : [];
  return {
    reelFrame: str(raw.reelAndFrameNumber),
    conveyanceText: str(raw.conveyanceText),
    recordedDate: str(raw.assignmentRecordedDate) || str(raw.assignmentReceivedDate),
    assignors: (assignorBag as Array<Record<string, unknown>>)
      .map((a) => ({
        name: str(a.assignorName) || str(a.nameLineOneText),
        ...(str(a.executionDate) ? { executionDate: str(a.executionDate) } : {}),
      }))
      .filter((a) => a.name),
    assignees: (assigneeBag as Array<Record<string, unknown>>)
      .map(assigneeName)
      .filter(Boolean),
  };
}

const CACHE_COLLECTION = "assignmentsCache";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

async function readCache(
  db: admin.firestore.Firestore,
  digits: string
): Promise<AssignmentsResult | null> {
  const snap = await db.collection(CACHE_COLLECTION).doc(digits).get();
  const data = snap.data();
  if (!data) return null;
  const writtenAt = (data.writtenAt as admin.firestore.Timestamp | undefined)?.toMillis() ?? 0;
  if (Date.now() - writtenAt > CACHE_TTL_MS) return null;
  return { ...(data.result as AssignmentsResult), cached: true };
}

export async function handleAssignmentsRequest(
  body: { patentNumber?: string }
): Promise<AssignmentsResult> {
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

  const bag = Array.isArray(wrapper.assignmentBag) ? wrapper.assignmentBag : [];
  // ODP returns assignments newest-first; preserve that order.
  const assignments = bag.map(parseAssignment).filter((a) => a.reelFrame || a.assignees.length);
  const currentAssignee = assignments[0]?.assignees[0] || "";

  const result: AssignmentsResult = {
    patentNumber: normalized,
    currentAssignee,
    assignmentCount: assignments.length,
    assignments,
    cached: false,
  };

  db.collection(CACHE_COLLECTION).doc(digits).set({
    result: { ...result, cached: false },
    writtenAt: admin.firestore.FieldValue.serverTimestamp(),
  }).catch((e) => console.warn(`[Assignments] Cache write failed for ${digits}:`, e));

  return result;
}
