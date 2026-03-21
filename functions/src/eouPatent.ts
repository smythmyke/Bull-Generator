/**
 * Patent fetching for EOU analysis.
 *
 * Adapted from googlePatentsEnrich.ts but returns ALL claims
 * (independent and dependent) so the user can select which to analyze.
 * Also extracts patent title and assignee for the UI.
 */

export interface PatentClaim {
  claimNumber: number;
  text: string;
  isIndependent: boolean;
}

export interface PatentData {
  publicationNumber: string;
  title: string;
  assignee: string;
  filingDate: string;
  priorityDate: string;
  grantDate: string;
  claims: PatentClaim[];
  totalClaimCount: number;
  cpcCodes: string[];
  abstract: string;
}

// ── HTML Parsing Helpers ──

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

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

function extractFirstItemprop(html: string, prop: string): string {
  const vals = extractItemprop(html, prop);
  return vals[0] || "";
}

function extractDatetimeItemprop(html: string, prop: string): string {
  const match = html.match(
    new RegExp(`itemprop="${prop}"[^>]*datetime="([^"]*)"`, "i")
  );
  return match?.[1] || "";
}

// ── Claim Parsing ──

const DEPENDENT_PATTERN =
  /\b(?:of claim|according to claim|as (?:set forth|defined|recited|claimed) in claim|claim \d+ wherein)\b/i;

function parseClaims(html: string): { claims: PatentClaim[]; total: number } {
  const claimsSection = html.match(
    /itemprop="claims"[\s\S]*?<\/section>/i
  );
  if (!claimsSection) return {claims: [], total: 0};

  const section = claimsSection[0];

  const countMatch = section.match(/itemprop="count"[^>]*>(\d+)/);
  const total = countMatch ? parseInt(countMatch[1], 10) : 0;

  const claims: PatentClaim[] = [];
  const claimPattern = /itemprop="num"[^>]*>(\d+)<\/span>\s*\.\s*([\s\S]*?)(?=<div[^>]*itemprop="num"|<\/section>)/gi;
  let match;
  while ((match = claimPattern.exec(section)) !== null) {
    const num = parseInt(match[1], 10);
    const text = stripHtml(match[2]).substring(0, 5000);
    if (!isNaN(num) && text) {
      claims.push({
        claimNumber: num,
        text,
        isIndependent: !DEPENDENT_PATTERN.test(text),
      });
    }
  }

  return {claims, total: total || claims.length};
}

function parseCpcCodes(html: string): string[] {
  const classSection = html.match(
    /itemprop="classifications"([\s\S]*?)(?=<section|itemprop="claims"|itemprop="description"|$)/i
  );
  if (!classSection) return [];

  const codes = extractItemprop(classSection[1], "Code");
  const seen = new Set<string>();
  const result: string[] = [];
  for (const code of codes) {
    if (/^[A-H]\d{2}[A-Z]\d/.test(code) && !seen.has(code)) {
      seen.add(code);
      result.push(code);
    }
  }
  return result;
}

function parseAbstract(html: string): string {
  const abstractSection = html.match(
    /itemprop="abstract"[\s\S]*?<\/section>/i
  );
  if (!abstractSection) return "";
  return stripHtml(abstractSection[0]).substring(0, 2000);
}

// ── Patent Number Normalization ──

/**
 * Normalize user input to Google Patents format.
 * Accepts: "10123456", "US10123456B2", "US 10,123,456", "US10,123,456B2"
 * Returns: "US10123456B2" (or best guess)
 */
export function normalizePatentNumber(input: string): string {
  let cleaned = input.trim().toUpperCase().replace(/[,\s]/g, "");

  // If no country prefix, assume US
  if (/^\d/.test(cleaned)) {
    cleaned = "US" + cleaned;
  }

  // If no kind code, try B2 (granted utility patent)
  if (/^US\d+$/.test(cleaned)) {
    cleaned = cleaned + "B2";
  }

  return cleaned;
}

// ── Main Handler ──

export async function handlePatentFetch(
  body: Record<string, unknown>
): Promise<PatentData> {
  const rawNumber = body.patentNumber as string;
  if (!rawNumber || typeof rawNumber !== "string") {
    throw new Error("patentNumber is required");
  }

  const patentId = normalizePatentNumber(rawNumber);
  console.log(`[EOU-Patent] Fetching patent: ${patentId} (input: ${rawNumber})`);

  const url = `https://patents.google.com/xhr/result?id=patent/${patentId}/en`;

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; PatentSearchBot/1.0)",
      "Accept": "text/html",
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    // If B2 fails, try B1 (some patents only have B1 kind code)
    if (patentId.endsWith("B2")) {
      const altId = patentId.replace(/B2$/, "B1");
      console.log(`[EOU-Patent] B2 failed, trying ${altId}`);
      const altResponse = await fetch(
        `https://patents.google.com/xhr/result?id=patent/${altId}/en`,
        {
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; PatentSearchBot/1.0)",
            "Accept": "text/html",
          },
          signal: AbortSignal.timeout(15000),
        }
      );
      if (!altResponse.ok) {
        throw new Error(`Patent not found: ${rawNumber} (tried ${patentId} and ${altId})`);
      }
      const altHtml = await altResponse.text();
      return parsePatentHtml(altHtml, altId);
    }
    throw new Error(`Patent not found: ${rawNumber} (HTTP ${response.status})`);
  }

  const html = await response.text();
  return parsePatentHtml(html, patentId);
}

function parsePatentHtml(html: string, patentId: string): PatentData {
  if (!html || html.length < 500) {
    throw new Error(`Empty response for patent ${patentId}`);
  }

  const {claims, total} = parseClaims(html);
  const title = extractFirstItemprop(html, "title") || "Unknown Title";
  const assignee = extractFirstItemprop(html, "assigneeOriginal") ||
    extractFirstItemprop(html, "assigneeCurrent") || "";
  const publicationNumber = extractFirstItemprop(html, "publicationNumber") || patentId;

  console.log(
    `[EOU-Patent] Parsed ${patentId}: "${title}", ${claims.length} claims ` +
    `(${claims.filter((c) => c.isIndependent).length} independent), assignee: ${assignee}`
  );

  return {
    publicationNumber,
    title,
    assignee,
    filingDate: extractDatetimeItemprop(html, "filingDate"),
    priorityDate: extractDatetimeItemprop(html, "priorityDate"),
    grantDate: extractDatetimeItemprop(html, "publicationDate"),
    claims,
    totalClaimCount: total,
    cpcCodes: parseCpcCodes(html),
    abstract: parseAbstract(html),
  };
}
