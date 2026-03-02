import {BigQuery} from "@google-cloud/bigquery";

// Lazy singleton — uses Application Default Credentials (auto from firebase-admin)
let bqClient: BigQuery | null = null;

function getBigQuery(): BigQuery {
  if (!bqClient) {
    bqClient = new BigQuery();
  }
  return bqClient;
}

// ── Types ──

interface ParsedClaim {
  claimNumber: number;
  text: string;
}

export interface EnrichedPatentData {
  publicationNumber: string;
  originalId: string;
  independentClaims: ParsedClaim[];
  totalClaimCount: number;
  descriptionSnippet: string;
  backwardCitations: { citedPublicationNumber: string; citationType: string; phase: string }[];
  backwardCitationCount: number;
  cpcDetails: { code: string; inventive: boolean; first: boolean }[];
  familyId: string;
  priorityDate: string;
  filingDate: string;
  grantDate: string;
  entityStatus: string;
  enrichedVia: "bigquery";
}

// ── Helpers ──

/**
 * Convert Google Patents ID to BigQuery publication_number format.
 * e.g. US7654321B2 → US-7654321-B2
 */
export function convertToBigQueryFormat(id: string): string {
  const match = id.match(/^([A-Z]{2})(\d+)([A-Z]\d?)$/);
  if (match) {
    return `${match[1]}-${match[2]}-${match[3]}`;
  }
  // Already formatted or unrecognized — return as-is
  return id;
}

/**
 * Parse raw claims text into independent claims.
 * Filters out dependent claims (those referencing another claim).
 */
export function parseIndependentClaims(
  claimsText: string,
  maxClaims = 3
): ParsedClaim[] {
  if (!claimsText || claimsText.trim().length === 0) {
    return [];
  }

  // Split on claim number boundaries: "1. ", "2. ", etc.
  const claimParts = claimsText.split(/\n\s*(\d+)\.\s+/);

  const allClaims: ParsedClaim[] = [];

  // claimParts alternates: [preamble, "1", claim1Text, "2", claim2Text, ...]
  for (let i = 1; i < claimParts.length - 1; i += 2) {
    const claimNumber = parseInt(claimParts[i], 10);
    const text = claimParts[i + 1]?.trim();
    if (!text || isNaN(claimNumber)) continue;
    allClaims.push({claimNumber, text});
  }

  // If splitting didn't work, treat entire text as claim 1
  if (allClaims.length === 0) {
    return [{claimNumber: 1, text: claimsText.substring(0, 3000).trim()}];
  }

  // Filter out dependent claims
  const dependentPattern = /\b(?:of claim|according to claim|as (?:set forth|defined|recited|claimed) in claim|claim \d+ wherein)\b/i;
  const independents = allClaims.filter((c) => !dependentPattern.test(c.text));

  // If no independent claims parsed (unusual), fall back to claim 1
  if (independents.length === 0) {
    return [{
      claimNumber: allClaims[0].claimNumber,
      text: allClaims[0].text.substring(0, 3000),
    }];
  }

  return independents
    .slice(0, maxClaims)
    .map((c) => ({
      claimNumber: c.claimNumber,
      text: c.text.substring(0, 3000),
    }));
}

// ── Main handler ──

export async function enrichFromBigQuery(
  body: Record<string, unknown>
): Promise<object> {
  const publicationNumbers = body.publicationNumbers as string[];

  if (!publicationNumbers || !Array.isArray(publicationNumbers) || publicationNumbers.length === 0) {
    return {enriched: [], errors: ["No publication numbers provided"]};
  }

  if (publicationNumbers.length > 25) {
    return {enriched: [], errors: ["Maximum 25 publication numbers per request"]};
  }

  const bq = getBigQuery();

  // Convert IDs to BigQuery format
  const idMap = new Map<string, string>(); // bqId → originalId
  const bqIds: string[] = [];
  for (const id of publicationNumbers) {
    const bqId = convertToBigQueryFormat(id);
    idMap.set(bqId, id);
    bqIds.push(bqId);
  }

  const query = `
    SELECT
      publication_number,
      family_id,
      filing_date,
      grant_date,
      priority_date,
      entity_status,
      claims_localized,
      description_localized,
      citation,
      cpc
    FROM \`patents-public-data.patents.publications\`
    WHERE publication_number IN UNNEST(@pubNumbers)
  `;

  try {
    const [rows] = await bq.query({
      query,
      params: {pubNumbers: bqIds},
      location: "US",
    });

    const enriched: EnrichedPatentData[] = [];
    const errors: string[] = [];

    for (const row of rows) {
      try {
        const pubNumber = row.publication_number as string;
        const originalId = idMap.get(pubNumber) || pubNumber;

        // Parse claims
        const claimsLocalized = row.claims_localized as Array<{text: string; language: string}> | null;
        const claimsText = claimsLocalized?.find((c: {language: string}) => c.language === "en")?.text || claimsLocalized?.[0]?.text || "";
        const independentClaims = parseIndependentClaims(claimsText);

        // Count total claims
        const allClaimsSplit = claimsText.split(/\n\s*\d+\.\s+/).filter(Boolean);
        const totalClaimCount = allClaimsSplit.length > 0 ? allClaimsSplit.length : (claimsText.length > 0 ? 1 : 0);

        // Description snippet
        const descLocalized = row.description_localized as Array<{text: string; language: string}> | null;
        const descText = descLocalized?.find((d: {language: string}) => d.language === "en")?.text || descLocalized?.[0]?.text || "";
        const descriptionSnippet = descText.substring(0, 3000);

        // Backward citations
        const citations = row.citation as Array<{
          publication_number: string;
          type: string;
          category: string;
          filing_date: number;
        }> | null;
        const backwardCitations = (citations || [])
          .filter((c: {type: string}) => c.type !== "FORWARD")
          .map((c: {publication_number: string; type: string; category: string}) => ({
            citedPublicationNumber: c.publication_number || "",
            citationType: c.type || "BACKWARD",
            phase: c.category || "",
          }));

        // CPC details
        const cpcRaw = row.cpc as Array<{
          code: string;
          inventive: boolean;
          first: boolean;
        }> | null;
        const cpcDetails = (cpcRaw || []).map((c: {code: string; inventive: boolean; first: boolean}) => ({
          code: c.code || "",
          inventive: c.inventive || false,
          first: c.first || false,
        }));

        // Dates — BigQuery returns these as integers (YYYYMMDD)
        const formatDate = (d: number | null): string => {
          if (!d) return "";
          const s = String(d);
          if (s.length === 8) {
            return `${s.substring(0, 4)}-${s.substring(4, 6)}-${s.substring(6, 8)}`;
          }
          return s;
        };

        // Priority date — array of dates, take earliest
        const priorityDates = row.priority_date as Array<{date: number}> | number | null;
        let priorityDate = "";
        if (Array.isArray(priorityDates) && priorityDates.length > 0) {
          const earliest = priorityDates
            .map((pd: {date: number}) => pd.date)
            .filter(Boolean)
            .sort()[0];
          priorityDate = formatDate(earliest);
        } else if (typeof priorityDates === "number") {
          priorityDate = formatDate(priorityDates);
        }

        enriched.push({
          publicationNumber: pubNumber,
          originalId,
          independentClaims,
          totalClaimCount,
          descriptionSnippet,
          backwardCitations,
          backwardCitationCount: backwardCitations.length,
          cpcDetails,
          familyId: String(row.family_id || ""),
          priorityDate,
          filingDate: formatDate(row.filing_date as number | null),
          grantDate: formatDate(row.grant_date as number | null),
          entityStatus: (row.entity_status as string) || "",
          enrichedVia: "bigquery",
        });
      } catch (rowErr) {
        errors.push(`Failed to parse row ${row.publication_number}: ${rowErr}`);
      }
    }

    return {enriched, errors};
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {enriched: [], errors: [`BigQuery query failed: ${message}`]};
  }
}
