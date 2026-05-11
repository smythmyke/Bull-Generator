/**
 * Patent Dossier endpoint.
 *
 * Fetches a Google Patents XHR response for a given patent number and
 * parses it into the structured PatentDossier shape defined in
 * research/patent-dossier-spec.md.
 *
 * Endpoint: POST /patent-dossier
 *   body: { patentNumber: string }
 *   auth: Bearer (verified in index.ts)
 *   credits: 3 per fresh fetch; 0 on cache hit (24h TTL)
 *
 * Returns every section flagged ✅ GP in the spec. AI summary lives in
 * a separate on-demand endpoint.
 */

import * as admin from "firebase-admin";
import {
  stripHtml,
  extractItemprop,
  extractFirstItemprop,
  extractDatetimeItemprop,
} from "./googlePatentsEnrich";

// ── Types (mirror research/patent-dossier-spec.md §1–§7) ──

export type PatentStatus =
  | "active"
  | "lapsed"
  | "expired"
  | "pending"
  | "unknown";

export interface DossierHeader {
  title: string;
  abstract: string;
  inventors: string[];
  originalAssignee: string;
  currentAssignee: string;
  applicationNumber: string;
  priorityDate: string;
  filingDate: string;
  publicationDate: string;
  grantDate: string;
  anticipatedExpiration: string;
  status: PatentStatus;
  statusLabel: string;
}

export interface DossierLegalStatusRow {
  jurisdiction: string;
  status: string;
  keyDate: string;
}

export interface DossierFamilyMember {
  jurisdiction: string;
  publicationNumber: string;
  type: string;
  status: string;
  date: string;
}

export interface DossierFamily {
  familyId: string;
  members: DossierFamilyMember[];
}

export interface DossierClaim {
  number: number;
  text: string;
  isIndependent: boolean;
  dependsOn?: number;
}

export interface DossierClaims {
  totalCount: number;
  independentNumbers: number[];
  items: DossierClaim[];
}

export interface DossierCitation {
  patentNumber: string;
  title?: string;
  assignee?: string;
  date?: string;
  examinerCited?: boolean;
}

export interface DossierCitations {
  forwardCount: number;
  backwardCount: number;
  forward: DossierCitation[];
  backward: DossierCitation[];
}

export interface DossierCpc {
  code: string;
  label: string;
  primary: boolean;
}

export interface DossierClassification {
  cpcCodes: DossierCpc[];
}

export interface DossierSimilar {
  patentNumber: string;
  title?: string;
  assignee?: string;
}

export interface PatentDossier {
  patentNumber: string;
  fetchedAt: string;
  cached: boolean;
  header: DossierHeader;
  legalStatus: DossierLegalStatusRow[];
  family: DossierFamily;
  claims: DossierClaims;
  citations: DossierCitations;
  classification: DossierClassification;
  similar: DossierSimilar[];
}

// ── Number normalization ──

/**
 * Normalize a user-supplied patent number to the canonical Google Patents form.
 * Accepts: "US 10,867,416 B2", "US10867416B2", "us10867416", "10867416",
 *          "EP3500001B1", etc. Returns the cleaned form ready for the GP URL.
 *
 * If no jurisdiction is provided, assumes US.
 */
export function normalizePatentNumber(input: string): string {
  if (!input || typeof input !== "string") return "";
  // Strip whitespace, commas, slashes, then uppercase
  let cleaned = input.replace(/[\s,/-]/g, "").toUpperCase();
  // If it starts with digits only, assume US
  if (/^\d/.test(cleaned)) cleaned = "US" + cleaned;
  return cleaned;
}

// ── Section parsers ──

const FIXTURE_USER_AGENT =
  "Mozilla/5.0 (compatible; PatentSearchBot/1.0)";

const ENTITY_DECODE_PAIRS: [RegExp, string][] = [
  [/&amp;/g, "&"],
  [/&lt;/g, "<"],
  [/&gt;/g, ">"],
  [/&quot;/g, "\""],
  [/&#39;/g, "'"],
  [/&nbsp;/g, " "],
];

function decodeEntities(text: string): string {
  let out = text;
  for (const [pat, rep] of ENTITY_DECODE_PAIRS) out = out.replace(pat, rep);
  return out;
}

function parseTitle(html: string): string {
  return decodeEntities(extractFirstItemprop(html, "title")).trim();
}

/** Abstract lives inside <section itemprop="abstract"> with an inner content div. */
function parseAbstract(html: string): string {
  const section = html.match(/itemprop="abstract"[\s\S]*?<\/section>/i);
  if (!section) return "";
  // The actual abstract text is wrapped in a custom <abstract> element
  const inner = section[0].match(/<abstract[^>]*>([\s\S]*?)<\/abstract>/i);
  const raw = inner ? inner[1] : section[0];
  return stripHtml(raw);
}

function parseInventors(html: string): string[] {
  return extractItemprop(html, "inventor")
    .map((v) => decodeEntities(v))
    .filter(Boolean);
}

function parseAssignees(
  html: string
): { original: string; current: string } {
  // assigneeCurrent is wrapped in a more complex block — strip tags from a window
  const currentMatch = html.match(
    /itemprop="assigneeCurrent"[^>]*>([\s\S]*?)<\/dd>/i
  );
  const current = currentMatch ? stripHtml(currentMatch[1]) : "";
  const original = decodeEntities(extractFirstItemprop(html, "assigneeOriginal"));
  return {
    original: original || current,
    current: current || original,
  };
}

function parseApplicationNumber(html: string): string {
  return extractFirstItemprop(html, "applicationNumber");
}

function parseStatus(
  html: string
): { status: PatentStatus; statusLabel: string } {
  // legalStatusIfi container contains a <span itemprop="status">VALUE</span>
  const block = html.match(
    /itemprop="legalStatusIfi"[\s\S]*?itemprop="status"[^>]*>([^<]+)/i
  );
  const raw = (block?.[1] || extractFirstItemprop(html, "legalStatus") || "")
    .trim();
  const lowered = raw.toLowerCase();
  let status: PatentStatus = "unknown";
  if (lowered.includes("active")) status = "active";
  else if (lowered.includes("expired")) status = "expired";
  else if (
    lowered.includes("lapsed") ||
    lowered.includes("abandon") ||
    lowered.includes("withdrawn") ||
    lowered.includes("ceased")
  ) status = "lapsed";
  else if (lowered.includes("pending") || lowered.includes("published"))
    status = "pending";
  return { status, statusLabel: raw || "Unknown" };
}

/** Anticipated expiration = priority date + 20 years (utility patents). */
function anticipatedExpiration(priorityDate: string): string {
  if (!priorityDate || !/^\d{4}-\d{2}-\d{2}$/.test(priorityDate)) return "";
  const [y, m, d] = priorityDate.split("-").map(Number);
  return `${y + 20}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Each top-level <ul itemprop="classifications"> is one CPC hierarchy.
 * We want the leaf node (most specific, marked with <meta itemprop="Leaf">),
 * and we mark the one with <meta itemprop="FirstCode"> as primary.
 */
function parseClassifications(html: string): DossierCpc[] {
  const results: DossierCpc[] = [];
  const seen = new Set<string>();

  // Each top-level <ul itemprop="classifications"> is one CPC hierarchy whose
  // last <li> is the leaf (most specific code). We walk each <li> in document
  // order; an <li> with itemprop="Leaf" yields a result row, scoped to its
  // own block via a lookahead at the next <li> or </ul>.
  const ulPattern =
    /<ul[^>]*itemprop="classifications"[\s\S]*?<\/ul>/gi;
  let ulMatch;
  while ((ulMatch = ulPattern.exec(html)) !== null) {
    const ul = ulMatch[0];
    const liPattern =
      /<li[^>]*itemprop="classifications"[^>]*>([\s\S]*?)(?=<li[^>]*itemprop="classifications"|<\/ul>)/gi;
    let liMatch;
    while ((liMatch = liPattern.exec(ul)) !== null) {
      const liContent = liMatch[1];
      if (!/itemprop="Leaf"/i.test(liContent)) continue;
      const codeMatch = liContent.match(/itemprop="Code"[^>]*>([^<]+)/i);
      const labelMatch = liContent.match(/itemprop="Description"[^>]*>([^<]+)/i);
      const code = codeMatch?.[1]?.trim();
      if (!code || seen.has(code)) continue;
      seen.add(code);
      const isPrimary = /itemprop="FirstCode"/i.test(liContent);
      results.push({
        code,
        label: decodeEntities(labelMatch?.[1]?.trim() || ""),
        primary: isPrimary,
      });
    }
  }

  // Sort: primary first, then alpha by code
  results.sort((a, b) => {
    if (a.primary && !b.primary) return -1;
    if (!a.primary && b.primary) return 1;
    return a.code.localeCompare(b.code);
  });

  return results;
}

/**
 * Parse the docdbFamily table — each <tr itemprop="docdbFamily">.
 * Falls back to directAssociations if docdbFamily empty.
 */
function parseFamily(html: string): DossierFamily {
  const members: DossierFamilyMember[] = [];

  const rowPattern =
    /<tr[^>]*itemprop="docdbFamily"[\s\S]*?<\/tr>/gi;
  let row;
  while ((row = rowPattern.exec(html)) !== null) {
    const pubNum = row[0].match(
      /itemprop="publicationNumber"[^>]*>([^<]+)/i
    )?.[1]?.trim();
    if (!pubNum) continue;
    const pubDate = row[0].match(
      /itemprop="publicationDate"[^>]*>([^<]+)/i
    )?.[1]?.trim() || "";
    members.push({
      jurisdiction: pubNum.replace(/^([A-Z]{2}).*/, "$1"),
      publicationNumber: pubNum,
      type: pubNum.replace(/^[A-Z]{2}\d+/, "") || "",
      status: "",
      date: pubDate,
    });
  }

  // The current publication isn't listed in docdbFamily (that table covers
  // OTHER family members). Add the current publication so the family list
  // always contains every member, with the current one first.
  const headerPubNum = extractFirstItemprop(html, "publicationNumber");
  if (headerPubNum && !members.some((m) => m.publicationNumber === headerPubNum)) {
    members.unshift({
      jurisdiction: headerPubNum.replace(/^([A-Z]{2}).*/, "$1"),
      publicationNumber: headerPubNum,
      type: headerPubNum.replace(/^[A-Z]{2}\d+/, "") || "",
      status: "",
      date: extractDatetimeItemprop(html, "publicationDate"),
    });
  }

  // Family id — try the page-level "family" itemprop or fall back to first member
  const familyId = extractFirstItemprop(html, "id") || "";

  return { familyId, members };
}

/**
 * Parse the claims section. GP's XHR claim markup uses:
 *   <div id="CLM-00001" num="00001" class="claim">
 *     <div class="claim-text">1. <text…></div>
 *     ...
 *   </div>
 * Dependents reference parents via <claim-ref idref="CLM-00001">claim 1</claim-ref>.
 */
function parseClaimsTree(html: string): DossierClaims {
  const sectionMatch = html.match(
    /<section[^>]*itemprop="claims"[\s\S]*?<\/section>/i
  );
  if (!sectionMatch) {
    return { totalCount: 0, independentNumbers: [], items: [] };
  }
  const section = sectionMatch[0];

  const countMatch = section.match(/itemprop="count"[^>]*>(\d+)/);
  const total = countMatch ? parseInt(countMatch[1], 10) : 0;

  // Match each <div id="CLM-NNNNN" ...> block up to the next CLM-* or end of section.
  const claimPattern =
    /<div\s+id="CLM-(\d+)"[^>]*num="\d+"[^>]*class="claim"[^>]*>([\s\S]*?)(?=<div\s+id="CLM-\d+"|<\/section>)/gi;

  const items: DossierClaim[] = [];
  let match;
  while ((match = claimPattern.exec(section)) !== null) {
    const number = parseInt(match[1], 10);
    const body = match[2];
    if (isNaN(number)) continue;

    // Extract the dependency reference BEFORE stripping HTML
    const refMatch = body.match(/<claim-ref\s+idref="CLM-(\d+)"/i);
    const dependsOn = refMatch ? parseInt(refMatch[1], 10) : undefined;

    const text = stripHtml(body).substring(0, 5000);
    if (!text) continue;

    items.push({
      number,
      text,
      isIndependent: dependsOn === undefined,
      ...(dependsOn !== undefined ? { dependsOn } : {}),
    });
  }

  const independentNumbers = items
    .filter((c) => c.isIndependent)
    .map((c) => c.number);

  return {
    totalCount: total || items.length,
    independentNumbers,
    items,
  };
}

function parseCitationRow(rowHtml: string): DossierCitation | null {
  const pubNum = rowHtml.match(
    /itemprop="publicationNumber"[^>]*>([^<]+)/i
  )?.[1]?.trim();
  if (!pubNum) return null;
  const title = rowHtml.match(/itemprop="title"[^>]*>([^<]+)/i)?.[1]?.trim();
  const assignee = rowHtml.match(
    /itemprop="assigneeOriginal"[^>]*>([^<]+)/i
  )?.[1]?.trim();
  const date = rowHtml.match(
    /itemprop="publicationDate"[^>]*>([^<]+)/i
  )?.[1]?.trim();
  const examinerCited = /itemprop="examinerCited"/i.test(rowHtml);
  return {
    patentNumber: pubNum,
    ...(title ? { title: decodeEntities(title) } : {}),
    ...(assignee ? { assignee: decodeEntities(assignee) } : {}),
    ...(date ? { date } : {}),
    ...(examinerCited ? { examinerCited: true } : {}),
  };
}

function parseCitations(html: string): DossierCitations {
  const forward: DossierCitation[] = [];
  const backward: DossierCitation[] = [];

  const forwardPattern =
    /<tr[^>]*itemprop="forwardReferencesOrig"[\s\S]*?<\/tr>/gi;
  let row;
  while ((row = forwardPattern.exec(html)) !== null) {
    const parsed = parseCitationRow(row[0]);
    if (parsed) forward.push(parsed);
  }

  const backwardPattern =
    /<tr[^>]*itemprop="backwardReferencesOrig"[\s\S]*?<\/tr>/gi;
  while ((row = backwardPattern.exec(html)) !== null) {
    const parsed = parseCitationRow(row[0]);
    if (parsed) backward.push(parsed);
  }

  return {
    forwardCount: forward.length,
    backwardCount: backward.length,
    forward,
    backward,
  };
}

function parseSimilar(html: string, selfPubNum: string): DossierSimilar[] {
  const items: DossierSimilar[] = [];
  const rowPattern =
    /<tr[^>]*itemprop="similarDocuments"[\s\S]*?<\/tr>/gi;
  let row;
  while ((row = rowPattern.exec(html)) !== null) {
    const pubNum = row[0].match(
      /itemprop="publicationNumber"[^>]*>([^<]+)/i
    )?.[1]?.trim();
    if (!pubNum || pubNum === selfPubNum) continue;
    const title = row[0].match(/itemprop="title"[^>]*>([^<]+)/i)?.[1]?.trim();
    items.push({
      patentNumber: pubNum,
      ...(title ? { title: decodeEntities(title) } : {}),
    });
  }
  return items;
}

// ── Fetch + compose ──

async function fetchPatentHtml(patentNumber: string): Promise<string> {
  const url = `https://patents.google.com/xhr/result?id=patent/${patentNumber}/en`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": FIXTURE_USER_AGENT,
      "Accept": "text/html",
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching ${patentNumber}`);
  }
  const html = await response.text();
  if (!html || html.length < 500) {
    throw new Error(`Empty/short response for ${patentNumber}: ${html.length} bytes`);
  }
  return html;
}

export function buildDossierFromHtml(
  patentNumber: string,
  html: string
): PatentDossier {
  const priorityDate = extractDatetimeItemprop(html, "priorityDate");
  const filingDate = extractDatetimeItemprop(html, "filingDate");
  const publicationDate = extractDatetimeItemprop(html, "publicationDate");
  const { status, statusLabel } = parseStatus(html);
  const { original, current } = parseAssignees(html);

  const header: DossierHeader = {
    title: parseTitle(html),
    abstract: parseAbstract(html),
    inventors: parseInventors(html),
    originalAssignee: original,
    currentAssignee: current,
    applicationNumber: parseApplicationNumber(html),
    priorityDate,
    filingDate,
    publicationDate,
    grantDate: publicationDate,
    anticipatedExpiration: anticipatedExpiration(priorityDate),
    status,
    statusLabel,
  };

  const family = parseFamily(html);

  return {
    patentNumber,
    fetchedAt: new Date().toISOString(),
    cached: false,
    header,
    legalStatus: [
      {
        jurisdiction: patentNumber.replace(/^([A-Z]{2}).*/, "$1"),
        status: statusLabel,
        keyDate: publicationDate,
      },
    ],
    family,
    claims: parseClaimsTree(html),
    citations: parseCitations(html),
    classification: { cpcCodes: parseClassifications(html) },
    similar: parseSimilar(html, extractFirstItemprop(html, "publicationNumber")),
  };
}

// ── Cache layer ──

const CACHE_COLLECTION = "dossierCache";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

async function readCache(
  db: admin.firestore.Firestore,
  patentNumber: string
): Promise<PatentDossier | null> {
  const snap = await db.collection(CACHE_COLLECTION).doc(patentNumber).get();
  if (!snap.exists) return null;
  const data = snap.data();
  if (!data) return null;
  const writtenAt = (data.writtenAt as admin.firestore.Timestamp | undefined)?.toMillis() ?? 0;
  if (Date.now() - writtenAt > CACHE_TTL_MS) return null;
  return { ...(data.dossier as PatentDossier), cached: true };
}

async function writeCache(
  db: admin.firestore.Firestore,
  patentNumber: string,
  dossier: PatentDossier
): Promise<void> {
  await db.collection(CACHE_COLLECTION).doc(patentNumber).set({
    dossier,
    writtenAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

// ── Request handler ──

export interface PatentDossierRequest {
  patentNumber?: string;
}

export interface PatentDossierResult {
  dossier?: PatentDossier;
  error?: string;
  code?: "invalid_number" | "fetch_failed" | "parse_failed" | "not_found";
}

export async function handlePatentDossierRequest(
  body: PatentDossierRequest
): Promise<PatentDossierResult> {
  const normalized = normalizePatentNumber(body.patentNumber || "");
  if (!normalized || normalized.length < 5) {
    return { error: "Invalid patent number", code: "invalid_number" };
  }

  const db = admin.firestore();
  const cached = await readCache(db, normalized);
  if (cached) return { dossier: cached };

  let html: string;
  try {
    html = await fetchPatentHtml(normalized);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { error: `Fetch failed: ${message}`, code: "fetch_failed" };
  }

  let dossier: PatentDossier;
  try {
    dossier = buildDossierFromHtml(normalized, html);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { error: `Parse failed: ${message}`, code: "parse_failed" };
  }

  if (!dossier.header.title && !dossier.header.applicationNumber) {
    return { error: `Patent not found: ${normalized}`, code: "not_found" };
  }

  // Write-through cache; don't block on failure
  writeCache(db, normalized, dossier).catch((e) => {
    console.warn(`[Dossier] Cache write failed for ${normalized}:`, e);
  });

  return { dossier };
}
