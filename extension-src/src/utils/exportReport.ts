import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, HeadingLevel, WidthType, AlignmentType, BorderStyle, ShadingType, TableLayoutType } from 'docx';
import { saveAs } from 'file-saver';

// ── Shared Types ──

export interface SearchReportData {
  query: string;
  date: string;
  mode: string;
  strategy?: string;
  totalQueries: number;
  uniqueResults: number;
  totalDurationMs?: number;
  searchLog: {
    round: number;
    label: string;
    query: string;
    resultCount: number;
    durationMs?: number;
    relaxationSteps?: { action: string; detail: string; query: string; resultCount: number }[];
  }[];
  traceability: {
    rank: number;
    patentId: string;
    title: string;
    score: number;
    sources: string[];
    sourceQueries: string[];
  }[];
  sourceAttribution: { source: string; label: string; count: number }[];
}

export interface ExaminerReportData {
  query: string;
  date: string;
  concepts: { name: string; synonyms: string[] }[];
  conceptCoverage: {
    patentId: string;
    conceptsCovered: { conceptName: string; coverage: 'full' | 'partial' | 'none'; evidence: string }[];
  }[];
  section102: {
    patentId: string;
    coveragePercent: number;
    reasoning: string;
    title?: string;
  }[];
  section103: {
    primary: { patentId: string; conceptsContributed: string[]; reasoning: string };
    secondary: { patentId: string; conceptsContributed: string[]; reasoning: string }[];
    combinedCoverage: number;
    combinationReasoning: string;
    fieldOverlap: string;
  }[];
  patentTitles: Record<string, string>;
}

// ── Helpers ──

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function truncateText(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.substring(0, max - 3) + '...';
}

function sanitizeForPDF(text: string): string {
  // jsPDF doesn't handle some unicode well
  return text.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/\u2014/g, '--').replace(/\u2013/g, '-');
}

// ── PDF: Search Report ──

export function exportSearchReportPDF(data: SearchReportData): void {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 15;

  // Header
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('Patent Search Report', pageWidth / 2, y, { align: 'center' });
  y += 8;

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100);
  doc.text(`Generated: ${data.date}`, pageWidth / 2, y, { align: 'center' });
  y += 6;

  // Metadata
  doc.setFontSize(10);
  doc.setTextColor(0);
  doc.setFont('helvetica', 'bold');
  doc.text('Search Mode:', 14, y);
  doc.setFont('helvetica', 'normal');
  doc.text(`${data.mode}${data.strategy ? ` / ${data.strategy}` : ''}`, 48, y);
  y += 5;

  doc.setFont('helvetica', 'bold');
  doc.text('Query:', 14, y);
  doc.setFont('helvetica', 'normal');
  const queryLines = doc.splitTextToSize(sanitizeForPDF(data.query), pageWidth - 50);
  doc.text(queryLines, 32, y);
  y += queryLines.length * 4 + 4;

  // Summary table
  autoTable(doc, {
    startY: y,
    head: [['Queries Executed', 'Unique Results', 'Total Duration']],
    body: [[
      String(data.totalQueries),
      String(data.uniqueResults),
      data.totalDurationMs ? formatDuration(data.totalDurationMs) : 'N/A',
    ]],
    theme: 'grid',
    headStyles: { fillColor: [59, 130, 246], fontSize: 9 },
    bodyStyles: { fontSize: 9, halign: 'center' },
    margin: { left: 14, right: 14 },
    tableWidth: 120,
  });
  y = (doc as any).lastAutoTable.finalY + 8;

  // Section: Query Execution Log
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('Query Execution Log', 14, y);
  y += 6;

  const rounds = [...new Set(data.searchLog.map(e => e.round))].sort();
  for (const roundNum of rounds) {
    const entries = data.searchLog.filter(e => e.round === roundNum);
    const roundColor: [number, number, number] = roundNum === 1 ? [59, 130, 246] : roundNum === 2 ? [217, 119, 6] : [220, 38, 38];

    autoTable(doc, {
      startY: y,
      head: [[`Round ${roundNum}`, 'Query', 'Results', 'Duration']],
      body: entries.map(e => [
        e.label,
        truncateText(sanitizeForPDF(e.query), 120),
        String(e.resultCount),
        e.durationMs ? formatDuration(e.durationMs) : '-',
      ]),
      theme: 'grid',
      headStyles: { fillColor: roundColor, fontSize: 8 },
      bodyStyles: { fontSize: 7 },
      columnStyles: {
        0: { cellWidth: 30 },
        1: { cellWidth: 'auto' },
        2: { cellWidth: 20, halign: 'center' },
        3: { cellWidth: 22, halign: 'center' },
      },
      margin: { left: 14, right: 14 },
    });
    y = (doc as any).lastAutoTable.finalY + 4;
  }

  // Section: Source Traceability
  if (data.traceability.length > 0) {
    // Check if we need a new page
    if (y > doc.internal.pageSize.getHeight() - 40) {
      doc.addPage();
      y = 15;
    }

    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('Source Traceability', 14, y);
    y += 6;

    autoTable(doc, {
      startY: y,
      head: [['Rank', 'Patent ID', 'Title', 'Score', 'Found By']],
      body: data.traceability.map(t => [
        `#${t.rank}`,
        t.patentId,
        truncateText(sanitizeForPDF(t.title), 60),
        t.score.toFixed(1),
        t.sources.join(', '),
      ]),
      theme: 'grid',
      headStyles: { fillColor: [16, 185, 129], fontSize: 8 },
      bodyStyles: { fontSize: 7 },
      columnStyles: {
        0: { cellWidth: 14, halign: 'center' },
        1: { cellWidth: 36 },
        2: { cellWidth: 'auto' },
        3: { cellWidth: 16, halign: 'center' },
        4: { cellWidth: 50 },
      },
      margin: { left: 14, right: 14 },
    });
    y = (doc as any).lastAutoTable.finalY + 4;
  }

  // Source Attribution Summary
  if (data.sourceAttribution.length > 0) {
    if (y > doc.internal.pageSize.getHeight() - 30) {
      doc.addPage();
      y = 15;
    }

    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('Source Attribution Summary', 14, y);
    y += 6;

    autoTable(doc, {
      startY: y,
      head: [['Source', 'Patent Count']],
      body: data.sourceAttribution.map(s => [s.label, String(s.count)]),
      theme: 'grid',
      headStyles: { fillColor: [107, 114, 128], fontSize: 8 },
      bodyStyles: { fontSize: 8 },
      margin: { left: 14, right: 14 },
      tableWidth: 100,
    });
  }

  // Footer
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(150);
    doc.text('Generated by Patent Search Generator', 14, doc.internal.pageSize.getHeight() - 7);
    doc.text(`Page ${i} of ${pageCount}`, pageWidth - 14, doc.internal.pageSize.getHeight() - 7, { align: 'right' });
  }

  doc.save(`Patent-Search-Report-${data.date.replace(/[/\s:,]/g, '-')}.pdf`);
}

// ── PDF: Examiner's Report ──

export function exportExaminerReportPDF(data: ExaminerReportData): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 15;

  // Header
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('Prior Art Analysis Report', pageWidth / 2, y, { align: 'center' });
  y += 8;

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100);
  doc.text(`Generated: ${data.date}`, pageWidth / 2, y, { align: 'center' });
  y += 8;

  // Query
  doc.setFontSize(10);
  doc.setTextColor(0);
  doc.setFont('helvetica', 'bold');
  doc.text('Invention Description:', 14, y);
  y += 5;
  doc.setFont('helvetica', 'normal');
  const queryLines = doc.splitTextToSize(sanitizeForPDF(data.query), pageWidth - 28);
  doc.text(queryLines, 14, y);
  y += queryLines.length * 4 + 4;

  // Concepts — derive from coverage data if concepts array is empty
  let conceptList = data.concepts;
  if (conceptList.length === 0 && data.conceptCoverage.length > 0) {
    const nameSet = new Set<string>();
    for (const pc of data.conceptCoverage) {
      for (const cc of pc.conceptsCovered) {
        nameSet.add(cc.conceptName);
      }
    }
    conceptList = Array.from(nameSet).map(name => ({ name, synonyms: [] }));
  }

  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('Concepts Analyzed', 14, y);
  y += 6;

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  for (const concept of conceptList) {
    doc.setFont('helvetica', 'bold');
    doc.text(`- ${concept.name}`, 18, y);
    if (concept.synonyms.length > 0) {
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100);
      const synText = ` (${concept.synonyms.join(', ')})`;
      doc.text(truncateText(synText, 80), 18 + doc.getTextWidth(`- ${concept.name}`), y);
      doc.setTextColor(0);
    }
    y += 4.5;
  }
  y += 4;

  // Concept Coverage Matrix
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('Concept Coverage Matrix', 14, y);
  y += 6;

  // Derive concept names from concepts list, or fall back to coverage data
  let conceptNames = data.concepts.map(c => c.name);
  if (conceptNames.length === 0 && data.conceptCoverage.length > 0) {
    const nameSet = new Set<string>();
    for (const pc of data.conceptCoverage) {
      for (const cc of pc.conceptsCovered) {
        nameSet.add(cc.conceptName);
      }
    }
    conceptNames = Array.from(nameSet);
  }
  const coverageHead = ['Patent ID', ...conceptNames.map(n => truncateText(n, 12))];
  const coverageBody = data.conceptCoverage.map(pc => {
    const row = [pc.patentId];
    for (const cName of conceptNames) {
      const item = pc.conceptsCovered.find(c => c.conceptName === cName);
      const cov = item?.coverage || 'none';
      row.push(cov === 'full' ? 'FULL' : cov === 'partial' ? 'PARTIAL' : '-');
    }
    return row;
  });

  autoTable(doc, {
    startY: y,
    head: [coverageHead],
    body: coverageBody,
    theme: 'grid',
    headStyles: { fillColor: [71, 85, 105], fontSize: 7 },
    bodyStyles: { fontSize: 7, halign: 'center' },
    columnStyles: { 0: { halign: 'left', cellWidth: 32 } },
    margin: { left: 14, right: 14 },
    didParseCell: (hookData: any) => {
      if (hookData.section === 'body' && hookData.column.index > 0) {
        const val = hookData.cell.raw;
        if (val === 'FULL') {
          hookData.cell.styles.fillColor = [220, 252, 231]; // green-100
          hookData.cell.styles.textColor = [22, 101, 52];
        } else if (val === 'PARTIAL') {
          hookData.cell.styles.fillColor = [254, 249, 195]; // yellow-100
          hookData.cell.styles.textColor = [133, 77, 14];
        } else {
          hookData.cell.styles.fillColor = [254, 226, 226]; // red-100
          hookData.cell.styles.textColor = [153, 27, 27];
        }
      }
    },
  });
  y = (doc as any).lastAutoTable.finalY + 8;

  // Section 102
  if (y > doc.internal.pageSize.getHeight() - 40) {
    doc.addPage();
    y = 15;
  }

  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('Section 102 -- Anticipation', 14, y);
  y += 6;

  doc.setFontSize(9);
  if (data.section102.length === 0) {
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(22, 101, 52);
    doc.text('No single patent anticipates all concepts. Favorable for patentability under 35 USC 102.', 14, y);
    doc.setTextColor(0);
    y += 8;
  } else {
    for (const candidate of data.section102) {
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(153, 27, 27);
      doc.text(`${candidate.patentId} (${candidate.coveragePercent}% coverage)`, 14, y);
      y += 4;
      if (candidate.title) {
        doc.setFont('helvetica', 'italic');
        doc.setTextColor(100);
        doc.text(truncateText(candidate.title, 90), 18, y);
        y += 4;
      }
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(0);
      const reasonLines = doc.splitTextToSize(sanitizeForPDF(candidate.reasoning), pageWidth - 32);
      doc.text(reasonLines, 18, y);
      y += reasonLines.length * 4 + 4;
    }
  }

  // Section 103
  if (y > doc.internal.pageSize.getHeight() - 40) {
    doc.addPage();
    y = 15;
  }

  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(0);
  doc.text('Section 103 -- Obviousness Combinations', 14, y);
  y += 6;

  doc.setFontSize(9);
  if (data.section103.length === 0) {
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(22, 101, 52);
    doc.text('No obvious combinations found among the analyzed patents.', 14, y);
    doc.setTextColor(0);
    y += 8;
  } else {
    for (let i = 0; i < data.section103.length; i++) {
      const combo = data.section103[i];

      if (y > doc.internal.pageSize.getHeight() - 50) {
        doc.addPage();
        y = 15;
      }

      doc.setFont('helvetica', 'bold');
      doc.setTextColor(0);
      doc.text(`Combination ${i + 1} (${combo.combinedCoverage}% combined coverage)`, 14, y);
      y += 5;

      // Primary
      doc.setFontSize(8);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(59, 130, 246);
      doc.text('PRIMARY:', 18, y);
      doc.setTextColor(0);
      doc.setFont('helvetica', 'normal');
      doc.text(`${combo.primary.patentId} -- ${combo.primary.conceptsContributed.join(', ')}`, 42, y);
      y += 4;
      const primaryLines = doc.splitTextToSize(sanitizeForPDF(combo.primary.reasoning), pageWidth - 42);
      doc.text(primaryLines, 22, y);
      y += primaryLines.length * 3.5 + 2;

      // Secondary
      for (const sec of combo.secondary) {
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(217, 119, 6);
        doc.text('SECONDARY:', 18, y);
        doc.setTextColor(0);
        doc.setFont('helvetica', 'normal');
        doc.text(`${sec.patentId} -- ${sec.conceptsContributed.join(', ')}`, 48, y);
        y += 4;
        const secLines = doc.splitTextToSize(sanitizeForPDF(sec.reasoning), pageWidth - 42);
        doc.text(secLines, 22, y);
        y += secLines.length * 3.5 + 2;
      }

      // Motivation
      doc.setFont('helvetica', 'italic');
      doc.setTextColor(100);
      const motivLines = doc.splitTextToSize(`Motivation: ${sanitizeForPDF(combo.combinationReasoning)}`, pageWidth - 32);
      doc.text(motivLines, 18, y);
      y += motivLines.length * 3.5 + 2;

      if (combo.fieldOverlap) {
        doc.text(`Field: ${combo.fieldOverlap}`, 18, y);
        y += 4;
      }
      doc.setTextColor(0);
      y += 4;
    }
  }

  // Footer
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(150);
    doc.text('Generated by Patent Search Generator', 14, doc.internal.pageSize.getHeight() - 7);
    doc.text(`Page ${i} of ${pageCount}`, pageWidth - 14, doc.internal.pageSize.getHeight() - 7, { align: 'right' });
  }

  doc.save(`Prior-Art-Analysis-${data.date.replace(/[/\s:,]/g, '-')}.pdf`);
}

// ── DOCX: Search Report ──

export async function exportSearchReportDOCX(data: SearchReportData): Promise<void> {
  const sections: Paragraph[] = [];

  // Title
  sections.push(new Paragraph({
    children: [new TextRun({ text: 'Patent Search Report', bold: true, size: 36 })],
    heading: HeadingLevel.TITLE,
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
  }));

  // Date
  sections.push(new Paragraph({
    children: [new TextRun({ text: `Generated: ${data.date}`, color: '666666', size: 18 })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 300 },
  }));

  // Metadata
  sections.push(new Paragraph({
    children: [
      new TextRun({ text: 'Search Mode: ', bold: true, size: 20 }),
      new TextRun({ text: `${data.mode}${data.strategy ? ` / ${data.strategy}` : ''}`, size: 20 }),
    ],
    spacing: { after: 100 },
  }));

  sections.push(new Paragraph({
    children: [
      new TextRun({ text: 'Query: ', bold: true, size: 20 }),
      new TextRun({ text: data.query, size: 20 }),
    ],
    spacing: { after: 200 },
  }));

  // Summary
  sections.push(new Paragraph({
    children: [new TextRun({ text: 'Summary', bold: true, size: 26 })],
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 200, after: 100 },
  }));

  const summaryTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    rows: [
      new TableRow({
        children: ['Queries Executed', 'Unique Results', 'Total Duration'].map(h =>
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, size: 18, color: 'FFFFFF' })], alignment: AlignmentType.CENTER })],
            shading: { type: ShadingType.SOLID, color: '3B82F6' },
            width: { size: 33, type: WidthType.PERCENTAGE },
          })
        ),
      }),
      new TableRow({
        children: [
          String(data.totalQueries),
          String(data.uniqueResults),
          data.totalDurationMs ? formatDuration(data.totalDurationMs) : 'N/A',
        ].map(v =>
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: v, size: 18 })], alignment: AlignmentType.CENTER })],
            width: { size: 33, type: WidthType.PERCENTAGE },
          })
        ),
      }),
    ],
  });
  sections.push(new Paragraph({ children: [] })); // spacer
  sections.push(new Paragraph({ children: [new TextRun({ text: '' })] }));

  // Query Execution Log
  sections.push(new Paragraph({
    children: [new TextRun({ text: 'Query Execution Log', bold: true, size: 26 })],
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 300, after: 100 },
  }));

  const rounds = [...new Set(data.searchLog.map(e => e.round))].sort();
  const logRows: TableRow[] = [
    new TableRow({
      children: ['Round', 'Label', 'Query', 'Results', 'Duration'].map(h =>
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, size: 16, color: 'FFFFFF' })], alignment: AlignmentType.CENTER })],
          shading: { type: ShadingType.SOLID, color: '475569' },
        })
      ),
    }),
  ];

  for (const roundNum of rounds) {
    const entries = data.searchLog.filter(e => e.round === roundNum);
    for (const entry of entries) {
      const roundColor = roundNum === 1 ? 'DBEAFE' : roundNum === 2 ? 'FEF3C7' : 'FEE2E2';
      logRows.push(new TableRow({
        children: [
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: `R${roundNum}`, bold: true, size: 16 })], alignment: AlignmentType.CENTER })],
            shading: { type: ShadingType.SOLID, color: roundColor },
            width: { size: 8, type: WidthType.PERCENTAGE },
          }),
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: entry.label, size: 16 })] })],
            width: { size: 14, type: WidthType.PERCENTAGE },
          }),
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: truncateText(entry.query, 200), size: 14, font: 'Courier New' })] })],
            width: { size: 54, type: WidthType.PERCENTAGE },
          }),
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: String(entry.resultCount), size: 16 })], alignment: AlignmentType.CENTER })],
            width: { size: 10, type: WidthType.PERCENTAGE },
          }),
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: entry.durationMs ? formatDuration(entry.durationMs) : '-', size: 16 })], alignment: AlignmentType.CENTER })],
            width: { size: 14, type: WidthType.PERCENTAGE },
          }),
        ],
      }));
    }
  }

  const logTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    rows: logRows,
  });

  // Source Traceability
  const traceRows: TableRow[] = [
    new TableRow({
      children: ['Rank', 'Patent ID', 'Title', 'Score', 'Found By'].map(h =>
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, size: 16, color: 'FFFFFF' })], alignment: AlignmentType.CENTER })],
          shading: { type: ShadingType.SOLID, color: '10B981' },
        })
      ),
    }),
  ];

  for (const t of data.traceability) {
    traceRows.push(new TableRow({
      children: [
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: `#${t.rank}`, bold: true, size: 16 })], alignment: AlignmentType.CENTER })],
          width: { size: 7, type: WidthType.PERCENTAGE },
        }),
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: t.patentId, size: 14, font: 'Courier New' })] })],
          width: { size: 18, type: WidthType.PERCENTAGE },
        }),
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: truncateText(t.title, 60), size: 14 })] })],
          width: { size: 35, type: WidthType.PERCENTAGE },
        }),
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: t.score.toFixed(1), size: 16 })], alignment: AlignmentType.CENTER })],
          width: { size: 8, type: WidthType.PERCENTAGE },
        }),
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: t.sources.join(', '), size: 14 })] })],
          width: { size: 32, type: WidthType.PERCENTAGE },
        }),
      ],
    }));
  }

  const traceTable = data.traceability.length > 0 ? new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    rows: traceRows,
  }) : null;

  // Build document
  const children: (Paragraph | Table)[] = [...sections, summaryTable, ...sections.slice(0, 0)];

  // Reconstruct properly
  const docChildren: (Paragraph | Table)[] = [];
  // Title + date + metadata + summary heading
  docChildren.push(sections[0], sections[1], sections[2], sections[3], sections[4]);
  docChildren.push(summaryTable);
  docChildren.push(sections[5]); // Query Execution Log heading
  docChildren.push(logTable);

  if (traceTable) {
    docChildren.push(new Paragraph({
      children: [new TextRun({ text: 'Source Traceability', bold: true, size: 26 })],
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 300, after: 100 },
    }));
    docChildren.push(traceTable);
  }

  // Source Attribution
  if (data.sourceAttribution.length > 0) {
    docChildren.push(new Paragraph({
      children: [new TextRun({ text: 'Source Attribution Summary', bold: true, size: 26 })],
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 300, after: 100 },
    }));
    for (const s of data.sourceAttribution) {
      docChildren.push(new Paragraph({
        children: [
          new TextRun({ text: `${s.label}: `, bold: true, size: 18 }),
          new TextRun({ text: `${s.count} patents`, size: 18 }),
        ],
        spacing: { after: 50 },
      }));
    }
  }

  // Footer
  docChildren.push(new Paragraph({
    children: [new TextRun({ text: 'Generated by Patent Search Generator', color: '999999', size: 14, italics: true })],
    spacing: { before: 400 },
    alignment: AlignmentType.CENTER,
  }));

  const document = new Document({
    sections: [{
      properties: {},
      children: docChildren,
    }],
  });

  const blob = await Packer.toBlob(document);
  saveAs(blob, `Patent-Search-Report-${data.date.replace(/[/\s:,]/g, '-')}.docx`);
}

// ── DOCX: Examiner's Report ──

export async function exportExaminerReportDOCX(data: ExaminerReportData): Promise<void> {
  const docChildren: (Paragraph | Table)[] = [];

  // Title
  docChildren.push(new Paragraph({
    children: [new TextRun({ text: 'Prior Art Analysis Report', bold: true, size: 36 })],
    heading: HeadingLevel.TITLE,
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
  }));

  docChildren.push(new Paragraph({
    children: [new TextRun({ text: `Generated: ${data.date}`, color: '666666', size: 18 })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 300 },
  }));

  // Invention Description
  docChildren.push(new Paragraph({
    children: [
      new TextRun({ text: 'Invention Description: ', bold: true, size: 20 }),
      new TextRun({ text: data.query, size: 20 }),
    ],
    spacing: { after: 200 },
  }));

  // Concepts
  docChildren.push(new Paragraph({
    children: [new TextRun({ text: 'Concepts Analyzed', bold: true, size: 26 })],
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 200, after: 100 },
  }));

  // Derive concept list from coverage data if concepts array is empty
  let docConceptList = data.concepts;
  if (docConceptList.length === 0 && data.conceptCoverage.length > 0) {
    const nameSet = new Set<string>();
    for (const pc of data.conceptCoverage) {
      for (const cc of pc.conceptsCovered) {
        nameSet.add(cc.conceptName);
      }
    }
    docConceptList = Array.from(nameSet).map(name => ({ name, synonyms: [] }));
  }

  for (const concept of docConceptList) {
    docChildren.push(new Paragraph({
      children: [
        new TextRun({ text: `${concept.name}`, bold: true, size: 18 }),
        ...(concept.synonyms.length > 0 ? [new TextRun({ text: ` (${concept.synonyms.join(', ')})`, size: 18, color: '666666' })] : []),
      ],
      bullet: { level: 0 },
      spacing: { after: 50 },
    }));
  }

  // Coverage Matrix
  docChildren.push(new Paragraph({
    children: [new TextRun({ text: 'Concept Coverage Matrix', bold: true, size: 26 })],
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 300, after: 100 },
  }));

  const conceptNames = docConceptList.map(c => c.name);
  const matrixHeader = new TableRow({
    children: [
      new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text: 'Patent ID', bold: true, size: 14, color: 'FFFFFF' })] })],
        shading: { type: ShadingType.SOLID, color: '475569' },
      }),
      ...conceptNames.map(name => new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text: truncateText(name, 15), bold: true, size: 14, color: 'FFFFFF' })], alignment: AlignmentType.CENTER })],
        shading: { type: ShadingType.SOLID, color: '475569' },
      })),
    ],
  });

  const matrixRows = data.conceptCoverage.map(pc => {
    return new TableRow({
      children: [
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: pc.patentId, size: 14, font: 'Courier New' })] })],
        }),
        ...conceptNames.map(cName => {
          const item = pc.conceptsCovered.find(c => c.conceptName === cName);
          const cov = item?.coverage || 'none';
          const bgColor = cov === 'full' ? 'DCFCE7' : cov === 'partial' ? 'FEF9C3' : 'FEE2E2';
          const textColor = cov === 'full' ? '166534' : cov === 'partial' ? '854D0E' : '991B1B';
          const symbol = cov === 'full' ? 'FULL' : cov === 'partial' ? 'PARTIAL' : '-';
          return new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: symbol, size: 14, color: textColor, bold: true })], alignment: AlignmentType.CENTER })],
            shading: { type: ShadingType.SOLID, color: bgColor },
          });
        }),
      ],
    });
  });

  const matrixTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [matrixHeader, ...matrixRows],
  });
  docChildren.push(matrixTable);

  // Section 102
  docChildren.push(new Paragraph({
    children: [new TextRun({ text: 'Section 102 -- Anticipation', bold: true, size: 26 })],
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 300, after: 100 },
  }));

  if (data.section102.length === 0) {
    docChildren.push(new Paragraph({
      children: [new TextRun({ text: 'No single patent anticipates all concepts. Favorable for patentability under 35 USC 102.', size: 18, color: '166534' })],
      spacing: { after: 200 },
    }));
  } else {
    for (const candidate of data.section102) {
      docChildren.push(new Paragraph({
        children: [
          new TextRun({ text: `${candidate.patentId}`, bold: true, size: 20, color: '991B1B' }),
          new TextRun({ text: ` (${candidate.coveragePercent}% coverage)`, size: 18, color: '991B1B' }),
        ],
        spacing: { after: 50 },
      }));
      if (candidate.title) {
        docChildren.push(new Paragraph({
          children: [new TextRun({ text: candidate.title, italics: true, size: 18, color: '666666' })],
          spacing: { after: 50 },
        }));
      }
      docChildren.push(new Paragraph({
        children: [new TextRun({ text: candidate.reasoning, size: 18 })],
        spacing: { after: 150 },
      }));
    }
  }

  // Section 103
  docChildren.push(new Paragraph({
    children: [new TextRun({ text: 'Section 103 -- Obviousness Combinations', bold: true, size: 26 })],
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 300, after: 100 },
  }));

  if (data.section103.length === 0) {
    docChildren.push(new Paragraph({
      children: [new TextRun({ text: 'No obvious combinations found among the analyzed patents.', size: 18, color: '166534' })],
      spacing: { after: 200 },
    }));
  } else {
    for (let i = 0; i < data.section103.length; i++) {
      const combo = data.section103[i];

      docChildren.push(new Paragraph({
        children: [new TextRun({ text: `Combination ${i + 1} (${combo.combinedCoverage}% combined coverage)`, bold: true, size: 22 })],
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 200, after: 100 },
      }));

      // Primary
      docChildren.push(new Paragraph({
        children: [
          new TextRun({ text: 'PRIMARY: ', bold: true, size: 18, color: '3B82F6' }),
          new TextRun({ text: combo.primary.patentId, bold: true, size: 18 }),
          new TextRun({ text: ` -- ${combo.primary.conceptsContributed.join(', ')}`, size: 18 }),
        ],
        spacing: { after: 50 },
      }));
      docChildren.push(new Paragraph({
        children: [new TextRun({ text: combo.primary.reasoning, size: 18 })],
        spacing: { after: 100 },
      }));

      // Secondary
      for (const sec of combo.secondary) {
        docChildren.push(new Paragraph({
          children: [
            new TextRun({ text: 'SECONDARY: ', bold: true, size: 18, color: 'D97706' }),
            new TextRun({ text: sec.patentId, bold: true, size: 18 }),
            new TextRun({ text: ` -- ${sec.conceptsContributed.join(', ')}`, size: 18 }),
          ],
          spacing: { after: 50 },
        }));
        docChildren.push(new Paragraph({
          children: [new TextRun({ text: sec.reasoning, size: 18 })],
          spacing: { after: 100 },
        }));
      }

      // Motivation
      docChildren.push(new Paragraph({
        children: [
          new TextRun({ text: 'Motivation to combine: ', bold: true, italics: true, size: 18 }),
          new TextRun({ text: combo.combinationReasoning, italics: true, size: 18 }),
        ],
        spacing: { after: 50 },
      }));

      if (combo.fieldOverlap) {
        docChildren.push(new Paragraph({
          children: [
            new TextRun({ text: 'Field: ', bold: true, size: 18 }),
            new TextRun({ text: combo.fieldOverlap, size: 18 }),
          ],
          spacing: { after: 100 },
        }));
      }
    }
  }

  // Footer
  docChildren.push(new Paragraph({
    children: [new TextRun({ text: 'Generated by Patent Search Generator', color: '999999', size: 14, italics: true })],
    spacing: { before: 400 },
    alignment: AlignmentType.CENTER,
  }));

  const document = new Document({
    sections: [{
      properties: {},
      children: docChildren,
    }],
  });

  const blob = await Packer.toBlob(document);
  saveAs(blob, `Prior-Art-Analysis-${data.date.replace(/[/\s:,]/g, '-')}.docx`);
}
