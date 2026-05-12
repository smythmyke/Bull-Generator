import {
  Document,
  Packer,
  Paragraph,
  Table,
  TableRow,
  TableCell,
  TextRun,
  HeadingLevel,
  WidthType,
  AlignmentType,
  BorderStyle,
} from 'docx';
import { saveAs } from 'file-saver';
import type { IdsBundle, IdsReference } from '../idsGenerator';

function cell(text: string, opts: { bold?: boolean; width?: number } = {}): TableCell {
  return new TableCell({
    width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
    children: [
      new Paragraph({
        children: [new TextRun({ text, bold: opts.bold, size: 16 })],
      }),
    ],
  });
}

function refRow(ref: IdsReference, idx: number): TableRow {
  return new TableRow({
    children: [
      cell(String(idx + 1)),
      cell(ref.sources.includes('examiner-cited') ? '*' : ''),
      cell(ref.patentNumber),
      cell(ref.date ?? ''),
      cell(ref.assignee ?? ''),
      cell(ref.title ?? ''),
    ],
  });
}

export async function exportIdsDocx(bundle: IdsBundle): Promise<void> {
  const children: (Paragraph | Table)[] = [];

  children.push(
    new Paragraph({
      children: [new TextRun({ text: 'INFORMATION DISCLOSURE STATEMENT', bold: true, size: 28 })],
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 100 },
    }),
  );
  children.push(
    new Paragraph({
      children: [new TextRun({ text: '(Substitute for Form PTO/SB/08)', italics: true, size: 18 })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 300 },
    }),
  );

  // Application info
  children.push(
    new Paragraph({
      children: [
        new TextRun({ text: 'Application Number: ', bold: true, size: 20 }),
        new TextRun({ text: bundle.applicationNumber ?? '(not provided)', size: 20 }),
      ],
    }),
  );
  children.push(
    new Paragraph({
      children: [
        new TextRun({ text: 'Reference Patent: ', bold: true, size: 20 }),
        new TextRun({ text: bundle.patentNumber, size: 20 }),
      ],
    }),
  );
  children.push(
    new Paragraph({
      children: [
        new TextRun({ text: 'Generated: ', bold: true, size: 20 }),
        new TextRun({ text: new Date(bundle.generatedAt).toLocaleString(), size: 20 }),
      ],
      spacing: { after: 300 },
    }),
  );

  // Section heading
  children.push(
    new Paragraph({
      children: [new TextRun({ text: 'U.S. PATENT DOCUMENTS', bold: true, size: 22 })],
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 150 },
    }),
  );

  // Header row
  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      cell('Cite #', { bold: true, width: 7 }),
      cell('Exam.*', { bold: true, width: 7 }),
      cell('Document Number', { bold: true, width: 20 }),
      cell('Issue Date', { bold: true, width: 13 }),
      cell('Name of Patentee or Applicant', { bold: true, width: 25 }),
      cell('Title', { bold: true, width: 28 }),
    ],
  });

  const refTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [headerRow, ...bundle.references.map(refRow)],
  });
  children.push(refTable);

  // Footnotes
  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: '* Examiner Initial column shows references the USPTO examiner previously cited against this patent.',
          italics: true,
          size: 16,
          color: '666666',
        }),
      ],
      spacing: { before: 200, after: 100 },
    }),
  );

  const c = bundle.counts;
  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: `Total references: ${c.total} · Backward: ${c.fromBackward} · Examiner-cited: ${c.fromExaminerCited} · From OA analyses: ${c.fromOaCited}${c.analyzedOaCount ? ` (${c.analyzedOaCount} OA${c.analyzedOaCount === 1 ? '' : 's'})` : ''}`,
          size: 16,
          color: '666666',
        }),
      ],
      spacing: { after: 200 },
    }),
  );

  children.push(
    new Paragraph({
      children: [new TextRun({ text: 'DISCLAIMER', bold: true, color: '8B1A1A', size: 18 })],
      spacing: { before: 200, after: 50 },
    }),
  );
  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: 'This document was machine-generated from public citation data. It is not legal advice and is not an attested or signed IDS submission. Always have a registered patent attorney or agent review and sign an IDS before filing with the USPTO. Verify each cited reference against the original source before filing.',
          size: 16,
        }),
      ],
    }),
  );

  const document = new Document({
    sections: [{ properties: {}, children }],
  });

  const blob = await Packer.toBlob(document);
  saveAs(blob, `IDS-${bundle.patentNumber}.docx`);
}
