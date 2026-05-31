/**
 * Parser for USPTO grant full-text XML (`us-patent-grant`, DTD v4.x).
 *
 * The ODP biblio response embeds `grantDocumentMetaData.fileLocationURI`
 * pointing at this XML, which carries the data the file-wrapper JSON does not:
 * abstract, claims (full text), and the backward citation list. We parse it
 * with regex — same pragmatic approach as the Google Patents HTML parser in
 * `patentDossier.ts` — to stay dependency-free.
 *
 * This module is part of the ODP-backed API/MCP data path ONLY. The browser
 * extension's Google Patents path (`patentDossier.ts`) does not use it.
 */

import type { DossierClaim, DossierCitation } from "../patentDossier";

export interface ParsedGrantXml {
  abstract: string;
  claims: DossierClaim[];
  /** Backward (cited-by) references parsed from <us-references-cited>. */
  backwardCitations: DossierCitation[];
}

// ── Tag / entity helpers ───────────────────────────────────────────────

const ENTITY_PAIRS: [RegExp, string][] = [
  [/&amp;/g, "&"],
  [/&lt;/g, "<"],
  [/&gt;/g, ">"],
  [/&quot;/g, "\""],
  [/&#x2019;/g, "'"],
  [/&#x201[cd];/g, "\""],
  [/&#39;/g, "'"],
  [/&nbsp;/g, " "],
];

function decodeEntities(text: string): string {
  let out = text;
  for (const [pat, rep] of ENTITY_PAIRS) out = out.replace(pat, rep);
  return out;
}

function stripTags(xml: string): string {
  return decodeEntities(xml.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

// ── Abstract ───────────────────────────────────────────────────────────

function parseAbstract(xml: string): string {
  const m = xml.match(/<abstract\b[^>]*>([\s\S]*?)<\/abstract>/i);
  return m ? stripTags(m[1]) : "";
}

// ── Claims ─────────────────────────────────────────────────────────────

/**
 * Each <claim id="CLM-00002" num="00002"> ... </claim> block. A claim is
 * dependent if its text references another claim via <claim-ref idref="CLM-...">;
 * the referenced number becomes `dependsOn`. Independent claims have no such ref.
 */
function parseClaims(xml: string): DossierClaim[] {
  const claimsBlock = xml.match(/<claims\b[^>]*>([\s\S]*?)<\/claims>/i);
  if (!claimsBlock) return [];

  const out: DossierClaim[] = [];
  const claimRe = /<claim\s+([^>]*?)>([\s\S]*?)<\/claim>/gi;
  let m: RegExpExecArray | null;
  while ((m = claimRe.exec(claimsBlock[1])) !== null) {
    const attrs = m[1];
    const inner = m[2];

    const numMatch = attrs.match(/\bnum="0*(\d+)"/i);
    if (!numMatch) continue;
    const number = parseInt(numMatch[1], 10);
    if (!Number.isFinite(number)) continue;

    // Dependency: first <claim-ref idref="CLM-000NN"> in the body.
    const refMatch = inner.match(/<claim-ref\b[^>]*idref="CLM-0*(\d+)"/i);
    const dependsOn = refMatch ? parseInt(refMatch[1], 10) : undefined;
    const isIndependent = dependsOn === undefined;

    const text = stripTags(inner);
    if (!text) continue;

    out.push({
      number,
      text,
      isIndependent,
      ...(dependsOn !== undefined ? { dependsOn } : {}),
    });
  }
  out.sort((a, b) => a.number - b.number);
  return out;
}

// ── Backward citations ─────────────────────────────────────────────────

/**
 * <us-references-cited> holds <us-citation> entries. Each is either a <patcit>
 * (patent reference, with a <doc-number>) or an <nplcit> (non-patent literature,
 * which we skip — no patent number to key on). A sibling <category> of
 * "cited by examiner" sets the examinerCited flag.
 */
function parseBackwardCitations(xml: string): DossierCitation[] {
  const block = xml.match(
    /<(?:us-references-cited|references-cited)\b[^>]*>([\s\S]*?)<\/(?:us-references-cited|references-cited)>/i
  );
  if (!block) return [];

  const out: DossierCitation[] = [];
  const seen = new Set<string>();
  const citationRe = /<(?:us-citation|citation)\b[^>]*>([\s\S]*?)<\/(?:us-citation|citation)>/gi;
  let m: RegExpExecArray | null;
  while ((m = citationRe.exec(block[1])) !== null) {
    const entry = m[1];
    const patcit = entry.match(/<patcit\b[^>]*>([\s\S]*?)<\/patcit>/i);
    if (!patcit) continue; // NPL citation — no patent number, skip

    const country = (patcit[1].match(/<country>([^<]*)<\/country>/i)?.[1] || "").trim();
    const docNumber = (patcit[1].match(/<doc-number>([^<]*)<\/doc-number>/i)?.[1] || "").trim();
    if (!docNumber) continue;

    const patentNumber = `${country}${docNumber}`;
    if (seen.has(patentNumber)) continue;
    seen.add(patentNumber);

    const category = (entry.match(/<category>([^<]*)<\/category>/i)?.[1] || "").toLowerCase();
    const rawDate = (patcit[1].match(/<date>(\d{8})<\/date>/i)?.[1] || "").trim();
    const date = rawDate.length === 8
      ? `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`
      : undefined;

    out.push({
      patentNumber,
      ...(date ? { date } : {}),
      examinerCited: category.includes("examiner"),
    });
  }
  return out;
}

// ── Entry point ────────────────────────────────────────────────────────

export function parseGrantXml(xml: string): ParsedGrantXml {
  return {
    abstract: parseAbstract(xml),
    claims: parseClaims(xml),
    backwardCitations: parseBackwardCitations(xml),
  };
}
