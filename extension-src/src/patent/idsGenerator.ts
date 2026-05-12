import type {
  DossierCitation,
  OfficeActionAnalysis,
} from '../services/apiService';

export type IdsReferenceSource =
  | 'backward'          // Dossier backward citation, not examiner-flagged
  | 'examiner-cited'    // Dossier backward citation flagged examiner-cited
  | 'oa-cited';         // Pulled from an analyzed Office Action's citedArt

export interface IdsReference {
  patentNumber: string;        // display form, e.g. "US 7,123,456 B2"
  normalizedNumber: string;    // dedupe key, e.g. "US7123456"
  title?: string;
  assignee?: string;
  date?: string;               // issue/publication date
  sources: IdsReferenceSource[]; // merged when a ref shows up in multiple places
  oaShortNames?: string[];     // examiner shorthand (e.g. "Smith") when source includes oa-cited
}

export interface IdsBundle {
  patentNumber: string;        // the dossier patent the IDS is for
  applicationNumber?: string;  // when known (from prosecution history)
  generatedAt: string;
  references: IdsReference[];
  counts: {
    total: number;
    fromBackward: number;
    fromExaminerCited: number;
    fromOaCited: number;
    analyzedOaCount: number;   // how many OAs were merged
  };
}

// ── Normalization ─────────────────────────────────────────────────────────

// Strip whitespace, hyphens, commas, slashes, and trailing kind codes
// for dedupe keys. "US 7,123,456 B2" → "US7123456".
// We deliberately preserve the original string for display.
const KIND_CODE_RX = /[A-Z]\d?$/;

export function normalizePatentNumber(raw: string): string {
  const upper = raw.toUpperCase().replace(/[\s,\-/.()]/g, '');
  // Drop trailing kind code if present (B1, B2, A1, A, P, S, etc.)
  if (KIND_CODE_RX.test(upper)) {
    return upper.replace(KIND_CODE_RX, '');
  }
  return upper;
}

// Heuristic — treat "Smith" / "Jones et al." / short surnames as non-patent.
// IDS forms require real publication numbers; examiner shorthand alone is unusable.
export function isLikelyPatentNumber(raw: string): boolean {
  const s = raw.trim();
  if (!s) return false;
  // Must contain at least 4 digits to be a patent number
  return /\d{4,}/.test(s);
}

// ── Merge ─────────────────────────────────────────────────────────────────

export interface BuildIdsBundleInput {
  patentNumber: string;
  applicationNumber?: string;
  backward: DossierCitation[];
  oaAnalyses: OfficeActionAnalysis[];
}

export function buildIdsBundle(input: BuildIdsBundleInput): IdsBundle {
  const map = new Map<string, IdsReference>();

  // 1. Backward citations (always present from dossier)
  for (const c of input.backward) {
    if (!isLikelyPatentNumber(c.patentNumber)) continue;
    const key = normalizePatentNumber(c.patentNumber);
    if (!key) continue;
    const source: IdsReferenceSource = c.examinerCited
      ? 'examiner-cited'
      : 'backward';
    const existing = map.get(key);
    if (existing) {
      if (!existing.sources.includes(source)) existing.sources.push(source);
      // Backfill any missing display metadata
      if (!existing.title && c.title) existing.title = c.title;
      if (!existing.assignee && c.assignee) existing.assignee = c.assignee;
      if (!existing.date && c.date) existing.date = c.date;
    } else {
      map.set(key, {
        patentNumber: c.patentNumber,
        normalizedNumber: key,
        title: c.title,
        assignee: c.assignee,
        date: c.date,
        sources: [source],
      });
    }
  }

  // 2. OA-cited art (only when user has analyzed Office Actions for this app)
  for (const analysis of input.oaAnalyses) {
    for (const art of analysis.citedArt) {
      if (!isLikelyPatentNumber(art.patentNumber)) continue;
      const key = normalizePatentNumber(art.patentNumber);
      if (!key) continue;
      const existing = map.get(key);
      if (existing) {
        if (!existing.sources.includes('oa-cited')) existing.sources.push('oa-cited');
        if (art.shortName) {
          existing.oaShortNames = existing.oaShortNames ?? [];
          if (!existing.oaShortNames.includes(art.shortName)) {
            existing.oaShortNames.push(art.shortName);
          }
        }
      } else {
        map.set(key, {
          patentNumber: art.patentNumber,
          normalizedNumber: key,
          sources: ['oa-cited'],
          oaShortNames: art.shortName ? [art.shortName] : undefined,
        });
      }
    }
  }

  // Sort: examiner-cited first (most prosecution-relevant), then by patent number desc
  const references = Array.from(map.values()).sort((a, b) => {
    const aExam = a.sources.includes('examiner-cited') ? 0 : 1;
    const bExam = b.sources.includes('examiner-cited') ? 0 : 1;
    if (aExam !== bExam) return aExam - bExam;
    return b.normalizedNumber.localeCompare(a.normalizedNumber);
  });

  const counts = {
    total: references.length,
    fromBackward: references.filter((r) => r.sources.includes('backward')).length,
    fromExaminerCited: references.filter((r) => r.sources.includes('examiner-cited')).length,
    fromOaCited: references.filter((r) => r.sources.includes('oa-cited')).length,
    analyzedOaCount: input.oaAnalyses.length,
  };

  return {
    patentNumber: input.patentNumber,
    applicationNumber: input.applicationNumber,
    generatedAt: new Date().toISOString(),
    references,
    counts,
  };
}
