/**
 * Google Patents XHR-based enrichment.
 *
 * Replaces BigQuery enrichment (~$7.44/call due to full 1.19 TB table scan)
 * with free server-side fetches to Google Patents' XHR endpoint.
 *
 * Endpoint: https://patents.google.com/xhr/result?id=patent/{ID}/en
 * Returns structured HTML with itemprop attributes for claims, citations,
 * CPC codes, family data, dates, and more.
 */

// ── Types (same interface as bigquery.ts for drop-in replacement) ──

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
  enrichedVia: "google-patents";
}

// ── HTML Parsing Helpers ──

/** Strip HTML tags, collapse whitespace */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extract all values for a given itemprop from HTML.
 * Returns the text content between the itemprop tag and its closing tag.
 */
function extractItemprop(html: string, prop: string): string[] {
  const results: string[] = [];
  const pattern = new RegExp(
    `itemprop="${prop}"[^>]*>([^<]*)`,
    "gi"
  );
  let match;
  while ((match = pattern.exec(html)) !== null) {
    const val = match[1].trim();
    if (val) results.push(val);
  }
  return results;
}

/** Extract a single itemprop value */
function extractFirstItemprop(html: string, prop: string): string {
  const vals = extractItemprop(html, prop);
  return vals[0] || "";
}

/**
 * Extract datetime attribute from itemprop tags.
 * e.g. <time itemprop="priorityDate" datetime="2017-10-23">
 */
function extractDatetimeItemprop(html: string, prop: string): string {
  const match = html.match(
    new RegExp(`itemprop="${prop}"[^>]*datetime="([^"]*)"`, "i")
  );
  return match?.[1] || "";
}

/**
 * Parse claims from the Google Patents HTML claims section.
 * Claims are structured as numbered divs with itemprop="num" and claim text.
 */
function parseClaims(html: string): { all: ParsedClaim[]; total: number } {
  // Find the claims section
  const claimsSection = html.match(
    /itemprop="claims"[\s\S]*?<\/section>/i
  );
  if (!claimsSection) return {all: [], total: 0};

  const section = claimsSection[0];

  // Get total count from <span itemprop="count">N</span>
  const countMatch = section.match(/itemprop="count"[^>]*>(\d+)/);
  const total = countMatch ? parseInt(countMatch[1], 10) : 0;

  // Parse individual claims: itemprop="num">N followed by claim text
  const claims: ParsedClaim[] = [];
  const claimPattern = /itemprop="num"[^>]*>(\d+)<\/span>\s*\.\s*([\s\S]*?)(?=<div[^>]*itemprop="num"|<\/section>)/gi;
  let match;
  while ((match = claimPattern.exec(section)) !== null) {
    const num = parseInt(match[1], 10);
    const text = stripHtml(match[2]).substring(0, 3000);
    if (!isNaN(num) && text) {
      claims.push({claimNumber: num, text});
    }
  }

  return {all: claims, total: total || claims.length};
}

/** Filter to independent claims only (same logic as bigquery.ts) */
function filterIndependentClaims(claims: ParsedClaim[], maxClaims = 3): ParsedClaim[] {
  if (claims.length === 0) return [];

  const dependentPattern =
    /\b(?:of claim|according to claim|as (?:set forth|defined|recited|claimed) in claim|claim \d+ wherein)\b/i;
  const independents = claims.filter((c) => !dependentPattern.test(c.text));

  if (independents.length === 0) {
    return [{
      claimNumber: claims[0].claimNumber,
      text: claims[0].text.substring(0, 3000),
    }];
  }

  return independents.slice(0, maxClaims);
}

/**
 * Extract backward citations from HTML.
 * Located in the backwardReferencesOrig section.
 */
function parseBackwardCitations(
  html: string
): { citedPublicationNumber: string; citationType: string; phase: string }[] {
  // Find backward references section (use backwardReferencesOrig for full list)
  const backSection = html.match(
    /itemprop="backwardReferencesOrig"([\s\S]*?)(?=itemprop="forwardReferences"|itemprop="forwardReferencesOrig"|$)/i
  );
  if (!backSection) return [];

  const section = backSection[1];
  const pubNums = extractItemprop(section, "publicationNumber");

  // Check if each citation was examiner-cited
  const examinerFlags = extractItemprop(section, "examinerCited");

  return pubNums.map((pubNum, i) => ({
    citedPublicationNumber: pubNum,
    citationType: "BACKWARD",
    phase: examinerFlags[i] === "true" ? "SEA" : "APP",
  }));
}

/**
 * Extract CPC codes from the classifications section.
 * Parses itemprop="Code" values, identifying first/inventive from context.
 */
function parseCpcCodes(
  html: string
): { code: string; inventive: boolean; first: boolean }[] {
  // Find classifications section
  const classSection = html.match(
    /itemprop="classifications"([\s\S]*?)(?=<section|itemprop="claims"|itemprop="description"|$)/i
  );
  if (!classSection) return [];

  const section = classSection[1];
  const results: { code: string; inventive: boolean; first: boolean }[] = [];
  const seen = new Set<string>();

  // CPC codes appear as itemprop="Code" — filter to CPC-format codes (e.g., A45F5/10)
  const codes = extractItemprop(section, "Code");
  let isFirst = true;
  for (const code of codes) {
    // Only include full CPC codes (section + class + subclass + group)
    if (/^[A-H]\d{2}[A-Z]\d/.test(code) && !seen.has(code)) {
      seen.add(code);
      results.push({code, inventive: false, first: isFirst});
      isFirst = false;
    }
  }

  return results;
}

/** Extract description snippet from itemprop="description" */
function parseDescriptionSnippet(html: string): string {
  const descSection = html.match(
    /itemprop="description"[\s\S]*?<\/section>/i
  );
  if (!descSection) return "";

  // Get the text content, limited to first 3000 chars
  const text = stripHtml(descSection[0]);
  return text.substring(0, 3000);
}

/** Extract family ID — look for itemprop="family" section containing itemprop="id" */
function parseFamilyId(html: string): string {
  const familySection = html.match(
    /itemprop="family"[\s\S]{0,2000}?itemprop="id"[^>]*>([^<]*)/i
  );
  return familySection?.[1]?.trim() || "";
}

/** Determine legal/entity status from itemprop="legalStatus" or "legalStatusCat" */
function parseLegalStatus(html: string): string {
  return extractFirstItemprop(html, "legalStatusCat") ||
    extractFirstItemprop(html, "legalStatus") ||
    "";
}

// ── Fetch + Parse a Single Patent ──

async function fetchAndParsePatent(
  patentId: string
): Promise<EnrichedPatentData | null> {
  const url = `https://patents.google.com/xhr/result?id=patent/${patentId}/en`;

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; PatentSearchBot/1.0)",
      "Accept": "text/html",
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    console.warn(`[GP-Enrich] HTTP ${response.status} for ${patentId}`);
    return null;
  }

  const html = await response.text();
  if (!html || html.length < 500) {
    console.warn(`[GP-Enrich] Empty/short response for ${patentId}: ${html.length} bytes`);
    return null;
  }

  // Parse all fields
  const {all: allClaims, total: totalClaimCount} = parseClaims(html);
  const independentClaims = filterIndependentClaims(allClaims);
  const descriptionSnippet = parseDescriptionSnippet(html);
  const backwardCitations = parseBackwardCitations(html);
  const cpcDetails = parseCpcCodes(html);
  const familyId = parseFamilyId(html);
  const priorityDate = extractDatetimeItemprop(html, "priorityDate");
  const filingDate = extractDatetimeItemprop(html, "filingDate");
  const grantDate = extractDatetimeItemprop(html, "publicationDate");
  const entityStatus = parseLegalStatus(html);

  // Get the publication number as Google Patents reports it
  const publicationNumber = extractFirstItemprop(html, "publicationNumber") || patentId;

  return {
    publicationNumber,
    originalId: patentId,
    independentClaims,
    totalClaimCount,
    descriptionSnippet,
    backwardCitations,
    backwardCitationCount: backwardCitations.length,
    cpcDetails,
    familyId,
    priorityDate,
    filingDate,
    grantDate,
    entityStatus,
    enrichedVia: "google-patents",
  };
}

// ── Main Handler (drop-in replacement for enrichFromBigQuery) ──

export async function enrichFromGooglePatents(
  body: Record<string, unknown>
): Promise<object> {
  const publicationNumbers = body.publicationNumbers as string[];

  if (!publicationNumbers || !Array.isArray(publicationNumbers) || publicationNumbers.length === 0) {
    return {enriched: [], errors: ["No publication numbers provided"]};
  }

  if (publicationNumbers.length > 25) {
    return {enriched: [], errors: ["Maximum 25 publication numbers per request"]};
  }

  console.log(`[GP-Enrich] Enriching ${publicationNumbers.length} patents via Google Patents XHR`);
  const startTime = Date.now();

  const enriched: EnrichedPatentData[] = [];
  const errors: string[] = [];

  // Fetch in parallel with concurrency limit of 5
  const BATCH_SIZE = 5;
  for (let i = 0; i < publicationNumbers.length; i += BATCH_SIZE) {
    const batch = publicationNumbers.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((id) => fetchAndParsePatent(id))
    );

    for (let j = 0; j < results.length; j++) {
      const result = results[j];
      const patentId = batch[j];
      if (result.status === "fulfilled" && result.value) {
        enriched.push(result.value);
        console.log(
          `[GP-Enrich]   ${patentId}: ${result.value.independentClaims.length} indep claims ` +
          `(${result.value.totalClaimCount} total), ${result.value.backwardCitationCount} citations, ` +
          `${result.value.cpcDetails.length} CPCs, family=${result.value.familyId}`
        );
      } else {
        const reason = result.status === "rejected"
          ? (result.reason instanceof Error ? result.reason.message : String(result.reason))
          : "No data returned";
        errors.push(`Failed to enrich ${patentId}: ${reason}`);
        console.warn(`[GP-Enrich]   ${patentId}: FAILED — ${reason}`);
      }
    }
  }

  const duration = Date.now() - startTime;
  console.log(
    `[GP-Enrich] === SUMMARY: ${enriched.length}/${publicationNumbers.length} patents enriched ` +
    `in ${duration}ms (${errors.length} errors) ===`
  );

  return {enriched, errors};
}
