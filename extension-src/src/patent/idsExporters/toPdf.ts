import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { saveAs } from 'file-saver';
import type { IdsBundle, IdsReference } from '../idsGenerator';

function sanitizeForPdf(text: string | undefined): string {
  if (!text) return '';
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/—/g, '--')
    .replace(/–/g, '-');
}

function truncate(text: string | undefined, max: number): string {
  if (!text) return '';
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

function examinerInitials(ref: IdsReference): string {
  return ref.sources.includes('examiner-cited') ? '*' : '';
}

function refRow(ref: IdsReference, idx: number): string[] {
  return [
    String(idx + 1),                               // Cite #
    examinerInitials(ref),                         // Examiner cited indicator
    sanitizeForPdf(ref.patentNumber),              // Document number
    sanitizeForPdf(ref.date),                      // Issue date
    truncate(sanitizeForPdf(ref.assignee), 40),    // Patentee
    truncate(sanitizeForPdf(ref.title), 60),       // Title (not on real SB/08 but useful)
  ];
}

export function exportIdsPdf(bundle: IdsBundle): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 14;

  // Header — mimics SB/08 top-of-form
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.text('INFORMATION DISCLOSURE STATEMENT', pageWidth / 2, y, { align: 'center' });
  y += 5;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('(Substitute for Form PTO/SB/08)', pageWidth / 2, y, { align: 'center' });
  y += 7;

  // Application info table
  autoTable(doc, {
    startY: y,
    head: [['Application Number', 'Reference Patent', 'Generated']],
    body: [[
      bundle.applicationNumber ?? '(not provided)',
      bundle.patentNumber,
      new Date(bundle.generatedAt).toLocaleString(),
    ]],
    theme: 'grid',
    headStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontSize: 8 },
    bodyStyles: { fontSize: 8 },
    margin: { left: 12, right: 12 },
  });
  y = (doc as any).lastAutoTable.finalY + 6;

  // References table
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('U.S. PATENT DOCUMENTS', 12, y);
  y += 4;

  autoTable(doc, {
    startY: y,
    head: [[
      'Cite\nNo.',
      'Exam.\nInitial*',
      'Document Number',
      'Issue Date',
      'Name of Patentee or Applicant',
      'Title (added — not on standard form)',
    ]],
    body: bundle.references.map(refRow),
    theme: 'grid',
    headStyles: {
      fillColor: [60, 60, 60],
      textColor: [255, 255, 255],
      fontSize: 7,
      halign: 'center',
    },
    bodyStyles: { fontSize: 7 },
    columnStyles: {
      0: { cellWidth: 12, halign: 'center' },
      1: { cellWidth: 14, halign: 'center' },
      2: { cellWidth: 36 },
      3: { cellWidth: 22, halign: 'center' },
      4: { cellWidth: 44 },
      5: { cellWidth: 'auto' },
    },
    margin: { left: 12, right: 12 },
  });
  y = (doc as any).lastAutoTable.finalY + 6;

  // Legend + disclaimer
  if (y > doc.internal.pageSize.getHeight() - 50) {
    doc.addPage();
    y = 14;
  }

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.text(
    '* Examiner Initial column shows references the USPTO examiner previously cited against this patent.',
    12,
    y,
  );
  y += 4;

  const counts = bundle.counts;
  const sourceSummary = [
    `Total references: ${counts.total}`,
    `From backward citations: ${counts.fromBackward}`,
    `Examiner-cited (Google Patents): ${counts.fromExaminerCited}`,
    `From Office Action analyses: ${counts.fromOaCited}${counts.analyzedOaCount ? ` (${counts.analyzedOaCount} OA${counts.analyzedOaCount === 1 ? '' : 's'} analyzed)` : ''}`,
  ];
  for (const line of sourceSummary) {
    doc.text(line, 12, y);
    y += 4;
  }
  y += 4;

  doc.setFont('helvetica', 'bold');
  doc.setTextColor(120, 30, 30);
  doc.text('DISCLAIMER', 12, y);
  y += 4;
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(0);
  const disclaimer = doc.splitTextToSize(
    'This document was machine-generated from public citation data. It is not legal advice and is not an attested or signed IDS submission. Always have a registered patent attorney or agent review and sign an IDS before filing with the USPTO. Verify each cited reference against the original source before filing.',
    pageWidth - 24,
  );
  doc.text(disclaimer, 12, y);

  saveAs(doc.output('blob'), `IDS-${bundle.patentNumber}.pdf`);
}
