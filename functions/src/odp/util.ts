/**
 * Shared pure helpers for the ODP-backed API/MCP modules (dossier, ptab,
 * legal-status, assignments). No I/O, no Firestore — just normalization.
 */

/** Coerce an unknown JSON value to a string ("" if not a string). */
export function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** First string of an array (or the value itself if scalar). */
export function firstStr(v: unknown): string {
  return Array.isArray(v) ? str(v[0]) : str(v);
}

/**
 * Extract bare US patent digits from a normalized number, or null if it isn't
 * a US patent. `normalizePatentNumber` yields e.g. "US10867416B2" / "US10000000";
 * ODP's patentNumber field is digits only.
 */
export function toUsPatentDigits(normalized: string): string | null {
  const us = normalized.match(/^US(\d{6,8})(?:[A-Z]\d?)?$/);
  if (us) return us[1];
  const bare = normalized.match(/^(\d{6,8})$/);
  return bare ? bare[1] : null;
}

/** US utility term ≈ earliest of filing/priority + 20 years (YYYY-MM-DD). */
export function computeExpiration(filingDate: string, priorityDate: string): string {
  const base = filingDate || priorityDate;
  if (!base) return "";
  const d = new Date(base);
  if (Number.isNaN(d.getTime())) return "";
  d.setFullYear(d.getFullYear() + 20);
  return d.toISOString().slice(0, 10);
}
