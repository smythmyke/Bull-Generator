import { saveAs } from 'file-saver';
import type { IdsBundle, IdsReference } from '../idsGenerator';

const HEADERS = [
  'Cite #',
  'Patent Number',
  'Issue/Pub Date',
  'Patentee/Applicant',
  'Title',
  'Examiner Cited',
  'OA Cited',
  'OA Short Name(s)',
];

function csvCell(value: string | undefined): string {
  if (value === undefined || value === null) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function rowToCsv(ref: IdsReference, idx: number): string {
  const examinerCited = ref.sources.includes('examiner-cited') ? 'Y' : '';
  const oaCited = ref.sources.includes('oa-cited') ? 'Y' : '';
  const oaNames = ref.oaShortNames?.join('; ') ?? '';
  return [
    String(idx + 1),
    ref.patentNumber,
    ref.date ?? '',
    ref.assignee ?? '',
    ref.title ?? '',
    examinerCited,
    oaCited,
    oaNames,
  ].map(csvCell).join(',');
}

export function buildIdsCsv(bundle: IdsBundle): string {
  const lines = [HEADERS.map(csvCell).join(',')];
  bundle.references.forEach((ref, idx) => {
    lines.push(rowToCsv(ref, idx));
  });
  return lines.join('\r\n');
}

export function downloadIdsCsv(bundle: IdsBundle): void {
  const csv = buildIdsCsv(bundle);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  saveAs(blob, `IDS-${bundle.patentNumber}.csv`);
}
