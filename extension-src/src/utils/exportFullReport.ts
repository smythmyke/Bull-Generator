import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, HeadingLevel, WidthType, AlignmentType, BorderStyle, ShadingType, TableLayoutType } from 'docx';
import { saveAs } from 'file-saver';
import { FullReportData } from './fullReportData';

// ── Helpers ──

function sanitize(text: string): string {
  return (text || '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2014/g, '--')
    .replace(/\u2013/g, '-');
}

function truncate(text: string, max: number): string {
  if (!text) return '';
  if (text.length <= max) return text;
  return text.substring(0, max - 3) + '...';
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// Colors
const PRIMARY = [30, 58, 95] as [number, number, number];    // #1e3a5f
const ACCENT = [37, 99, 235] as [number, number, number];    // #2563eb
const GREEN = [22, 163, 74] as [number, number, number];     // #16a34a
const AMBER = [202, 138, 4] as [number, number, number];     // #ca8a04
const RED = [220, 38, 38] as [number, number, number];       // #dc2626
const MUTED = [100, 116, 139] as [number, number, number];   // #64748b
const BORDER_GRAY = [226, 232, 240] as [number, number, number];

const DISCLAIMER_TEXT = [
  'Not Legal Advice. This report is for informational and research purposes only. It does not constitute legal advice and no attorney-client relationship is formed. The tool operators are not acting as patent attorneys or agents.',
  'AI-Generated Content. This report was generated using artificial intelligence (Gemini). AI may produce inaccurate or fabricated content ("hallucinations"). All patent citations, claim interpretations, and legal analyses must be independently verified against original patent documents.',
  'Search Limitations. Automated patent searching may miss relevant references including unpublished applications, trade secrets, non-patent literature, and foreign-language documents. This search is not a substitute for a comprehensive professional patent search.',
  'No Guarantee of Patentability. The assessments in this report are preliminary and based on limited data. A patent examiner or court may reach different conclusions. Favorable findings do not guarantee patent grant or validity.',
  'Limitation of Liability. This report is provided "as is" without warranty of any kind. The tool operators accept no liability for any damages arising from reliance on this report.',
  'Professional Consultation Required. Users are strongly advised to consult a registered patent attorney or agent for formal patentability opinions, freedom-to-operate analyses, or prosecution strategy.',
];

// ══════════════════════════════════════════════════════════════════
//  PDF EXPORT
// ══════════════════════════════════════════════════════════════════

export function exportFullReportPDF(data: FullReportData): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pw = doc.internal.pageSize.getWidth();
  const ph = doc.internal.pageSize.getHeight();
  const margin = 16;
  const contentWidth = pw - margin * 2;
  let y = 20;

  // ── Reusable helpers ──

  function checkPage(needed: number) {
    if (y + needed > ph - 20) {
      doc.addPage();
      y = 20;
    }
  }

  function sectionHeading(num: number, title: string) {
    checkPage(20);
    // Number circle
    doc.setFillColor(...PRIMARY);
    doc.circle(margin + 4, y - 1, 4, 'F');
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(255, 255, 255);
    doc.text(String(num), margin + 4, y + 0.5, { align: 'center' });
    // Title
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...PRIMARY);
    doc.text(title, margin + 12, y + 1);
    y += 4;
    // Underline
    doc.setDrawColor(...BORDER_GRAY);
    doc.setLineWidth(0.5);
    doc.line(margin, y, pw - margin, y);
    y += 6;
  }

  function introBox(text: string) {
    checkPage(20);
    const lines = doc.splitTextToSize(sanitize(text), contentWidth - 12);
    const boxH = lines.length * 3.5 + 6;
    // Background
    doc.setFillColor(241, 245, 249); // #f1f5f9
    doc.rect(margin, y, contentWidth, boxH, 'F');
    // Left accent border
    doc.setFillColor(...ACCENT);
    doc.rect(margin, y, 1.2, boxH, 'F');
    // Text
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...MUTED);
    doc.text(lines, margin + 5, y + 4);
    y += boxH + 4;
  }

  function narrative(text: string) {
    checkPage(15);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(30, 41, 59); // #1e293b
    const lines = doc.splitTextToSize(sanitize(text), contentWidth);
    for (const line of lines) {
      checkPage(5);
      doc.text(line, margin, y);
      y += 3.8;
    }
    y += 3;
  }

  // ── Report Header ──

  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...PRIMARY);
  doc.text('Patent Search Report', pw / 2, y, { align: 'center' });
  y += 6;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...MUTED);
  doc.text('Patentability / Prior Art Search Analysis', pw / 2, y, { align: 'center' });
  y += 4;
  // Separator
  doc.setDrawColor(...PRIMARY);
  doc.setLineWidth(0.8);
  doc.line(margin, y, pw - margin, y);
  y += 6;

  // Metadata table
  const metaItems: [string, string][] = [
    ['Subject Matter', truncate(sanitize(data.query), 200)],
    ['Report Date', data.date],
    ['Search Strategy', `${data.methodology.strategy || 'Standard'} (${data.methodology.mode})`],
    ['References Analyzed', `${data.references.length} patents in detail`],
  ];

  doc.setFillColor(248, 250, 252); // #f8fafc
  doc.setDrawColor(...BORDER_GRAY);
  const metaH = metaItems.length * 5 + 4;
  doc.roundedRect(margin, y, contentWidth, metaH, 2, 2, 'FD');
  let metaY = y + 4;
  for (const [label, value] of metaItems) {
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...MUTED);
    doc.text(label, margin + 4, metaY);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(30, 41, 59);
    const valLines = doc.splitTextToSize(value, contentWidth - 48);
    doc.text(valLines[0] || '', margin + 42, metaY);
    metaY += 5;
  }
  y += metaH + 8;

  // ══ Section 1: Invention Summary ══
  sectionHeading(1, 'Invention Summary');
  introBox('This section presents the tool\'s interpretation of the invention, broken down into discrete technical features with importance levels.');

  narrative(data.inventionSummary.narrative);

  // Feature list
  if (data.inventionSummary.features.length > 0) {
    checkPage(10);
    for (const feat of data.inventionSummary.features) {
      checkPage(12);
      // Feature ID badge
      doc.setFillColor(...ACCENT);
      doc.roundedRect(margin + 2, y - 2.5, 8, 4, 1, 1, 'F');
      doc.setFontSize(7);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(255, 255, 255);
      doc.text(feat.id, margin + 6, y, { align: 'center' });

      // Importance badge
      const impColor = feat.importance === 'high' ? RED : feat.importance === 'medium' ? AMBER : MUTED;
      doc.setFontSize(7);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...impColor);
      const impLabel = feat.importance === 'high' ? '[HIGH]' : feat.importance === 'medium' ? '[MED]' : '[LOW]';
      doc.text(impLabel, margin + 13, y);

      // Feature name + description
      doc.setFontSize(8.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 41, 59);
      doc.text(feat.name, margin + 26, y);
      y += 4;

      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...MUTED);
      const descLines = doc.splitTextToSize(sanitize(feat.description), contentWidth - 14);
      for (const line of descLines) {
        checkPage(4);
        doc.text(line, margin + 6, y);
        y += 3.5;
      }
      y += 2;
    }
    y += 3;
  }

  // ══ Section 2: Search Methodology ══
  sectionHeading(2, 'Search Methodology');
  introBox('This section documents the databases searched, boolean strings used, classification codes applied, and the multi-round search process.');

  // Method summary table
  const methodRows: string[][] = [
    ['Search Mode', data.methodology.mode],
    ['Strategy', data.methodology.strategy || 'Standard'],
    ['Depth', data.methodology.depth || 'N/A'],
    ['Total Queries', String(data.methodology.totalQueries)],
    ['Unique Results', String(data.methodology.uniqueResults)],
    ['Total Duration', data.methodology.totalDurationMs ? formatDuration(data.methodology.totalDurationMs) : 'N/A'],
  ];

  autoTable(doc, {
    startY: y,
    head: [['Parameter', 'Details']],
    body: methodRows,
    theme: 'grid',
    headStyles: { fillColor: PRIMARY, fontSize: 8, textColor: [255, 255, 255] },
    bodyStyles: { fontSize: 8 },
    columnStyles: { 0: { cellWidth: 40, fontStyle: 'bold' } },
    margin: { left: margin, right: margin },
    tableWidth: contentWidth,
  });
  y = (doc as any).lastAutoTable.finalY + 6;

  // Search log
  if (data.methodology.searchLog.length > 0) {
    checkPage(20);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...PRIMARY);
    doc.text('Search Strings Executed', margin, y);
    y += 5;

    autoTable(doc, {
      startY: y,
      head: [['Round', 'Label', 'Query', 'Results']],
      body: data.methodology.searchLog.map(e => [
        `R${e.round}`,
        e.label,
        truncate(sanitize(e.query), 100),
        String(e.resultCount),
      ]),
      theme: 'grid',
      headStyles: { fillColor: [71, 85, 105], fontSize: 7, textColor: [255, 255, 255] },
      bodyStyles: { fontSize: 6.5 },
      columnStyles: {
        0: { cellWidth: 12, halign: 'center' },
        1: { cellWidth: 28 },
        2: { cellWidth: 'auto', font: 'courier' },
        3: { cellWidth: 16, halign: 'center' },
      },
      margin: { left: margin, right: margin },
    });
    y = (doc as any).lastAutoTable.finalY + 6;
  }

  // ══ Section 3: Prior Art References ══
  sectionHeading(3, 'Prior Art References');
  introBox('References are categorized using EPO relevance categories: X (particularly relevant alone), Y (relevant in combination), A (technological background).');

  // EPO category legend
  checkPage(10);
  doc.setFontSize(7);
  const legendItems: [string, typeof RED, string][] = [
    ['X', RED, 'Particularly relevant taken alone'],
    ['Y', AMBER, 'Particularly relevant in combination'],
    ['A', GREEN, 'Technological background'],
  ];
  let lx = margin;
  for (const [cat, color, desc] of legendItems) {
    doc.setFillColor(...color);
    doc.roundedRect(lx, y - 2.5, 6, 4, 1, 1, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(255, 255, 255);
    doc.text(cat, lx + 3, y, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...MUTED);
    doc.text(desc, lx + 8, y);
    lx += 58;
  }
  y += 6;

  // References table
  const refRows = data.references.map(r => {
    const catColor = r.epoCategory === 'X' ? 'FEF2F2' : r.epoCategory === 'Y' ? 'FFFBEB' : 'F0FDF4';
    return [r.epoCategory, r.patentId, truncate(r.title, 60), r.assignee || '', truncate(r.abstract || '', 80)];
  });

  autoTable(doc, {
    startY: y,
    head: [['Cat.', 'Document', 'Title', 'Assignee', 'Relevance']],
    body: refRows,
    theme: 'grid',
    headStyles: { fillColor: PRIMARY, fontSize: 7, textColor: [255, 255, 255] },
    bodyStyles: { fontSize: 7 },
    columnStyles: {
      0: { cellWidth: 10, halign: 'center', fontStyle: 'bold' },
      1: { cellWidth: 30, font: 'courier' },
      2: { cellWidth: 40 },
      3: { cellWidth: 30 },
      4: { cellWidth: 'auto' },
    },
    margin: { left: margin, right: margin },
    didParseCell: (hookData: any) => {
      if (hookData.section === 'body' && hookData.column.index === 0) {
        const cat = hookData.cell.raw;
        if (cat === 'X') {
          hookData.cell.styles.textColor = RED;
          hookData.cell.styles.fillColor = [254, 242, 242];
        } else if (cat === 'Y') {
          hookData.cell.styles.textColor = AMBER;
          hookData.cell.styles.fillColor = [255, 251, 235];
        } else {
          hookData.cell.styles.textColor = GREEN;
          hookData.cell.styles.fillColor = [240, 253, 244];
        }
      }
    },
  });
  y = (doc as any).lastAutoTable.finalY + 6;

  // ══ Section 4: Concept Coverage Matrix ══
  sectionHeading(4, 'Concept Coverage Matrix');
  introBox('Shows how well each prior art reference discloses the invention\'s key concepts. Green checkmark = full, yellow tilde = partial, red X = none.');

  const covConcepts = data.concepts.map(c => c.name);
  const covHead = ['Reference', ...covConcepts.map(n => truncate(n, 14))];

  const covBody = data.conceptCoverage.map(pc => {
    const cells = [truncate(pc.patentId, 18)];
    for (const cn of covConcepts) {
      const item = pc.conceptsCovered.find(c => c.conceptName === cn);
      const cov = item?.coverage || 'none';
      cells.push(cov === 'full' ? 'Y' : cov === 'partial' ? '~' : 'X');
    }
    return cells;
  });

  autoTable(doc, {
    startY: y,
    head: [covHead],
    body: covBody,
    theme: 'grid',
    headStyles: { fillColor: PRIMARY, fontSize: 6.5, textColor: [255, 255, 255], halign: 'center' },
    bodyStyles: { fontSize: 7, halign: 'center' },
    columnStyles: { 0: { halign: 'left', font: 'courier', cellWidth: 30 } },
    margin: { left: margin, right: margin },
    didParseCell: (hookData: any) => {
      if (hookData.section === 'body' && hookData.column.index > 0) {
        const val = hookData.cell.raw;
        if (val === 'Y') {
          hookData.cell.styles.textColor = GREEN;
          hookData.cell.styles.fillColor = [220, 252, 231];
          hookData.cell.styles.fontStyle = 'bold';
        } else if (val === '~') {
          hookData.cell.styles.textColor = AMBER;
          hookData.cell.styles.fillColor = [254, 249, 195];
          hookData.cell.styles.fontStyle = 'bold';
        } else if (val === 'X') {
          hookData.cell.styles.textColor = [204, 204, 204];
        }
      }
    },
  });
  y = (doc as any).lastAutoTable.finalY + 6;

  // ══ Section 5: Detailed Element Mapping (Claim Charts) ══
  sectionHeading(5, 'Detailed Element Mapping');
  introBox('Element-by-element mapping showing how each X/Y reference discloses the invention\'s features, with specific citations to claims and paragraphs.');

  for (const chart of data.claimCharts) {
    checkPage(25);
    // Reference sub-heading
    const catColor = chart.epoCategory === 'X' ? RED : AMBER;
    doc.setFillColor(...catColor);
    doc.roundedRect(margin, y - 2.5, 6, 4, 1, 1, 'F');
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(255, 255, 255);
    doc.text(chart.epoCategory, margin + 3, y, { align: 'center' });

    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...PRIMARY);
    const chartTitle = `${chart.patentId} -- ${truncate(data.patentTitles[chart.patentId] || '', 60)}`;
    doc.text(chartTitle, margin + 9, y);
    y += 5;

    // Narrative intro
    if (chart.narrativeIntro) {
      narrative(chart.narrativeIntro);
    }

    // Claim chart table
    const chartBody = chart.elements.map(el => [
      `${el.featureId} -- ${el.featureName}\n${sanitize(truncate(el.priorArtDisclosure, 200))}`,
      `${el.sourceRef}\n\n${sanitize(truncate(el.coverageExplanation, 200))}`,
    ]);

    autoTable(doc, {
      startY: y,
      head: [['Invention Feature', 'Prior Art Disclosure']],
      body: chartBody,
      theme: 'grid',
      headStyles: { fillColor: PRIMARY, fontSize: 8, textColor: [255, 255, 255] },
      bodyStyles: { fontSize: 7, cellPadding: 3 },
      columnStyles: {
        0: { cellWidth: contentWidth * 0.45 },
        1: { cellWidth: contentWidth * 0.55 },
      },
      margin: { left: margin, right: margin },
      didParseCell: (hookData: any) => {
        if (hookData.section === 'body' && hookData.column.index === 1) {
          const text = hookData.cell.raw as string;
          if (text.includes('FULLY DISCLOSED')) {
            hookData.cell.styles.textColor = GREEN;
          } else if (text.includes('PARTIALLY DISCLOSED')) {
            hookData.cell.styles.textColor = AMBER;
          } else if (text.includes('NOT DISCLOSED')) {
            hookData.cell.styles.textColor = RED;
          }
        }
      },
    });
    y = (doc as any).lastAutoTable.finalY + 8;
  }

  // ══ Section 6: Section 102 — Anticipation Analysis ══
  sectionHeading(6, 'Section 102 -- Anticipation Analysis');
  introBox('Under 35 U.S.C. 102, a patent claim is anticipated if every element is found in a single prior art reference.');

  checkPage(20);
  if (data.section102.length === 0) {
    // Green box — no anticipation
    doc.setFillColor(240, 253, 244); // #f0fdf4
    doc.setDrawColor(187, 247, 208); // #bbf7d0
    const boxH = 16;
    doc.roundedRect(margin, y, contentWidth, boxH, 2, 2, 'FD');
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...GREEN);
    doc.text('No Single Reference Anticipates All Elements', margin + 4, y + 6);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...MUTED);
    doc.text('The invention is likely novel under 35 U.S.C. 102.', margin + 4, y + 12);
    y += boxH + 6;
  } else {
    // Red box — anticipation found
    doc.setFillColor(254, 242, 242); // #fef2f2
    doc.setDrawColor(254, 202, 202); // #fecaca
    const h = 10 + data.section102.length * 12;
    doc.roundedRect(margin, y, contentWidth, h, 2, 2, 'FD');
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...RED);
    doc.text('Potential Anticipation Found', margin + 4, y + 6);
    y += 10;
    for (const cand of data.section102) {
      doc.setFontSize(8);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 41, 59);
      doc.text(`${cand.patentId} (${cand.coveragePercent}% coverage)`, margin + 6, y);
      y += 3.5;
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...MUTED);
      const rLines = doc.splitTextToSize(sanitize(cand.reasoning), contentWidth - 14);
      doc.text(rLines.slice(0, 2), margin + 6, y);
      y += rLines.slice(0, 2).length * 3.5 + 3;
    }
    y += 4;
  }

  // ══ Section 7: Section 103 — Obviousness Analysis ══
  sectionHeading(7, 'Section 103 -- Obviousness Analysis');
  introBox('Under 35 U.S.C. 103, a claim is obvious if its subject matter as a whole would have been obvious to a person having ordinary skill in the art, considering differences between the prior art and the claimed invention.');

  if (data.section103.length === 0) {
    checkPage(16);
    doc.setFillColor(240, 253, 244);
    doc.setDrawColor(187, 247, 208);
    doc.roundedRect(margin, y, contentWidth, 14, 2, 2, 'FD');
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...GREEN);
    doc.text('No Obvious Combinations Identified', margin + 4, y + 6);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...MUTED);
    doc.text('The AI did not identify threatening combinations among the analyzed patents.', margin + 4, y + 11);
    y += 20;
  } else {
    for (let i = 0; i < data.section103.length; i++) {
      const combo = data.section103[i];
      checkPage(35);

      // Amber box
      doc.setFillColor(255, 251, 235); // #fffbeb
      doc.setDrawColor(253, 230, 138); // #fde68a

      // Calculate approximate height
      const comboH = 40 + combo.secondary.length * 12;
      doc.roundedRect(margin, y, contentWidth, comboH, 2, 2, 'FD');

      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...PRIMARY);
      doc.text(`Combination ${i + 1} -- ${combo.combinedCoverage}% Combined Coverage`, margin + 4, y + 6);
      y += 10;

      // Primary
      doc.setFillColor(219, 234, 254); // #dbeafe
      doc.roundedRect(margin + 4, y - 2, 18, 4, 1, 1, 'F');
      doc.setFontSize(7);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(29, 78, 216);
      doc.text('PRIMARY', margin + 13, y, { align: 'center' });
      doc.setFontSize(8);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 41, 59);
      doc.text(`${combo.primary.patentId} -- ${truncate(data.patentTitles[combo.primary.patentId] || '', 50)}`, margin + 25, y);
      y += 4;
      doc.setFontSize(7);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...MUTED);
      doc.text(`Concepts: ${combo.primary.conceptsContributed.join(', ')}`, margin + 8, y);
      y += 5;

      // Secondary references
      for (const sec of combo.secondary) {
        checkPage(12);
        doc.setFillColor(254, 243, 199); // #fef3c7
        doc.roundedRect(margin + 4, y - 2, 22, 4, 1, 1, 'F');
        doc.setFontSize(7);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(146, 64, 14);
        doc.text('SECONDARY', margin + 15, y, { align: 'center' });
        doc.setFontSize(8);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(30, 41, 59);
        doc.text(`${sec.patentId} -- ${truncate(data.patentTitles[sec.patentId] || '', 50)}`, margin + 29, y);
        y += 4;
        doc.setFontSize(7);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...MUTED);
        doc.text(`Concepts: ${sec.conceptsContributed.join(', ')}`, margin + 8, y);
        y += 5;
      }

      // Motivation
      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 41, 59);
      doc.text('Motivation to combine:', margin + 4, y);
      y += 3.5;
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...MUTED);
      const motLines = doc.splitTextToSize(sanitize(combo.combinationReasoning), contentWidth - 12);
      doc.text(motLines.slice(0, 3), margin + 4, y);
      y += motLines.slice(0, 3).length * 3 + 6;
    }
  }

  // ══ Section 8: Conclusion & Recommendations ══
  sectionHeading(8, 'Conclusion & Recommendations');
  introBox('This section synthesizes the findings from the prior art analysis and provides an overall patentability assessment with actionable recommendations.');

  checkPage(30);
  // Conclusion box
  doc.setDrawColor(...PRIMARY);
  doc.setLineWidth(0.6);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(margin, y, contentWidth, 4, 2, 2, 'FD'); // will expand

  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...PRIMARY);
  doc.text('Overall Patentability Assessment', margin + 4, y + 5);
  y += 10;

  // Risk badge
  const riskColor = data.conclusion.overallRisk === 'high' ? RED : data.conclusion.overallRisk === 'moderate' ? AMBER : GREEN;
  doc.setFillColor(...riskColor);
  doc.roundedRect(margin + 4, y - 2.5, 22, 5, 1.5, 1.5, 'F');
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(255, 255, 255);
  doc.text(`${data.conclusion.overallRisk.toUpperCase()} RISK`, margin + 15, y + 0.5, { align: 'center' });
  y += 7;

  // Novelty
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30, 41, 59);
  doc.text('Novelty (35 U.S.C. 102):', margin + 4, y);
  y += 4;
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...MUTED);
  const novLines = doc.splitTextToSize(sanitize(data.conclusion.noveltyAssessment), contentWidth - 10);
  for (const line of novLines) {
    checkPage(4);
    doc.text(line, margin + 4, y);
    y += 3.5;
  }
  y += 3;

  // Obviousness
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30, 41, 59);
  doc.text('Non-Obviousness (35 U.S.C. 103):', margin + 4, y);
  y += 4;
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...MUTED);
  const obvLines = doc.splitTextToSize(sanitize(data.conclusion.obviousnessAssessment), contentWidth - 10);
  for (const line of obvLines) {
    checkPage(4);
    doc.text(line, margin + 4, y);
    y += 3.5;
  }
  y += 3;

  // Recommendations
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30, 41, 59);
  doc.text('Recommendations:', margin + 4, y);
  y += 5;

  for (const rec of data.conclusion.recommendations) {
    checkPage(8);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...MUTED);
    const recLines = doc.splitTextToSize(`\u2022 ${sanitize(rec)}`, contentWidth - 12);
    for (const line of recLines) {
      checkPage(4);
      doc.text(line, margin + 6, y);
      y += 3.5;
    }
    y += 2;
  }
  y += 6;

  // ── Disclaimer Footer ──
  checkPage(60);
  doc.setDrawColor(...PRIMARY);
  doc.setLineWidth(0.6);
  doc.line(margin, y, pw - margin, y);
  y += 4;

  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...PRIMARY);
  doc.text('Patent Search Generator', pw / 2, y, { align: 'center' });
  y += 3;
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...MUTED);
  doc.text('AI-Assisted Patent Search and Analysis', pw / 2, y, { align: 'center' });
  y += 6;

  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30, 41, 59);
  doc.text('IMPORTANT DISCLAIMERS', margin + 4, y);
  y += 4;

  for (const disc of DISCLAIMER_TEXT) {
    checkPage(12);
    doc.setFontSize(6.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...MUTED);
    const dLines = doc.splitTextToSize(sanitize(disc), contentWidth - 10);
    for (const line of dLines) {
      checkPage(3);
      doc.text(line, margin + 4, y);
      y += 2.8;
    }
    y += 2;
  }

  // ── Page numbers ──
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(150);
    doc.text('Patent Search Generator', margin, ph - 7);
    doc.text(`Page ${i} of ${pageCount}`, pw - margin, ph - 7, { align: 'right' });
  }

  doc.save(`Full-Patent-Search-Report-${data.date.replace(/[/\s:,]/g, '-')}.pdf`);
}

// ══════════════════════════════════════════════════════════════════
//  DOCX EXPORT
// ══════════════════════════════════════════════════════════════════

function docxSectionHeading(num: number, title: string): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({ text: `${num}. `, bold: true, size: 28, color: '1E3A5F' }),
      new TextRun({ text: title, bold: true, size: 28, color: '1E3A5F' }),
    ],
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 400, after: 100 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' } },
  });
}

function docxIntroBox(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, size: 16, color: '64748B', italics: true })],
    spacing: { after: 200 },
    border: { left: { style: BorderStyle.SINGLE, size: 12, color: '2563EB' } },
    indent: { left: 200 },
    shading: { type: ShadingType.SOLID, color: 'F1F5F9' },
  });
}

function docxNarrative(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, size: 18, color: '1E293B' })],
    spacing: { after: 200 },
  });
}

function makeHeaderCell(text: string, color: string = '1E3A5F'): TableCell {
  return new TableCell({
    children: [new Paragraph({
      children: [new TextRun({ text, bold: true, size: 16, color: 'FFFFFF' })],
      alignment: AlignmentType.CENTER,
    })],
    shading: { type: ShadingType.SOLID, color },
  });
}

function makeCell(text: string, opts?: { bold?: boolean; color?: string; size?: number; font?: string; align?: typeof AlignmentType[keyof typeof AlignmentType]; shading?: string }): TableCell {
  return new TableCell({
    children: [new Paragraph({
      children: [new TextRun({
        text,
        bold: opts?.bold,
        size: opts?.size || 16,
        color: opts?.color || '1E293B',
        font: opts?.font,
      })],
      alignment: opts?.align || AlignmentType.LEFT,
    })],
    ...(opts?.shading ? { shading: { type: ShadingType.SOLID, color: opts.shading } } : {}),
  });
}

export async function exportFullReportDOCX(data: FullReportData): Promise<void> {
  const children: (Paragraph | Table)[] = [];

  // ── Title ──
  children.push(new Paragraph({
    children: [new TextRun({ text: 'Patent Search Report', bold: true, size: 40, color: '1E3A5F' })],
    heading: HeadingLevel.TITLE,
    alignment: AlignmentType.CENTER,
    spacing: { after: 100 },
  }));
  children.push(new Paragraph({
    children: [new TextRun({ text: 'Patentability / Prior Art Search Analysis', size: 20, color: '64748B' })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 300 },
  }));

  // Metadata
  const metaRows: [string, string][] = [
    ['Subject Matter', truncate(data.query, 300)],
    ['Report Date', data.date],
    ['Search Strategy', `${data.methodology.strategy || 'Standard'} (${data.methodology.mode})`],
    ['References Analyzed', `${data.references.length} patents in detail`],
  ];
  for (const [label, value] of metaRows) {
    children.push(new Paragraph({
      children: [
        new TextRun({ text: `${label}: `, bold: true, size: 18, color: '64748B' }),
        new TextRun({ text: value, size: 18, color: '1E293B' }),
      ],
      spacing: { after: 60 },
    }));
  }
  children.push(new Paragraph({ children: [], spacing: { after: 200 } }));

  // ══ Section 1: Invention Summary ══
  children.push(docxSectionHeading(1, 'Invention Summary'));
  children.push(docxIntroBox('This section presents the tool\'s interpretation of the invention, broken down into discrete technical features with importance levels.'));
  children.push(docxNarrative(data.inventionSummary.narrative));

  for (const feat of data.inventionSummary.features) {
    const impColor = feat.importance === 'high' ? 'DC2626' : feat.importance === 'medium' ? 'CA8A04' : '64748B';
    const impLabel = feat.importance === 'high' ? '[HIGH]' : feat.importance === 'medium' ? '[MED]' : '[LOW]';
    children.push(new Paragraph({
      children: [
        new TextRun({ text: feat.id, bold: true, size: 16, color: 'FFFFFF', shading: { type: ShadingType.SOLID, color: '2563EB' } }),
        new TextRun({ text: ` ${impLabel} `, bold: true, size: 16, color: impColor }),
        new TextRun({ text: feat.name, bold: true, size: 18, color: '1E293B' }),
        new TextRun({ text: ` -- ${feat.description}`, size: 16, color: '64748B' }),
      ],
      spacing: { after: 100 },
      indent: { left: 200 },
    }));
  }

  // ══ Section 2: Search Methodology ══
  children.push(docxSectionHeading(2, 'Search Methodology'));
  children.push(docxIntroBox('This section documents the databases searched, boolean strings used, classification codes applied, and the multi-round search process.'));

  const methodTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    rows: [
      new TableRow({ children: [makeHeaderCell('Parameter'), makeHeaderCell('Details')] }),
      ...([
        ['Search Mode', data.methodology.mode],
        ['Strategy', data.methodology.strategy || 'Standard'],
        ['Total Queries', String(data.methodology.totalQueries)],
        ['Unique Results', String(data.methodology.uniqueResults)],
        ['Total Duration', data.methodology.totalDurationMs ? formatDuration(data.methodology.totalDurationMs) : 'N/A'],
      ] as [string, string][]).map(([k, v]) =>
        new TableRow({
          children: [
            makeCell(k, { bold: true }),
            makeCell(v),
          ],
        })
      ),
    ],
  });
  children.push(methodTable);

  // Search log table
  if (data.methodology.searchLog.length > 0) {
    children.push(new Paragraph({
      children: [new TextRun({ text: 'Search Strings Executed', bold: true, size: 22, color: '1E3A5F' })],
      spacing: { before: 300, after: 100 },
    }));

    const logRows: TableRow[] = [
      new TableRow({
        children: ['Rnd', 'Label', 'Query', 'Hits'].map(h => makeHeaderCell(h, '475569')),
      }),
    ];
    for (const entry of data.methodology.searchLog) {
      const roundColor = entry.round === 1 ? 'DBEAFE' : entry.round === 2 ? 'FEF3C7' : 'FEE2E2';
      logRows.push(new TableRow({
        children: [
          makeCell(`R${entry.round}`, { bold: true, align: AlignmentType.CENTER, shading: roundColor }),
          makeCell(entry.label),
          makeCell(truncate(entry.query, 150), { font: 'Courier New', size: 14 }),
          makeCell(String(entry.resultCount), { align: AlignmentType.CENTER }),
        ],
      }));
    }
    children.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      layout: TableLayoutType.FIXED,
      rows: logRows,
    }));
  }

  // ══ Section 3: Prior Art References ══
  children.push(docxSectionHeading(3, 'Prior Art References'));
  children.push(docxIntroBox('References categorized using EPO relevance categories: X (particularly relevant alone), Y (relevant in combination), A (technological background).'));

  const refHeaderRow = new TableRow({
    children: ['Cat.', 'Document', 'Title', 'Assignee'].map(h => makeHeaderCell(h)),
  });
  const refDataRows = data.references.map(r => {
    const catColor = r.epoCategory === 'X' ? 'FEF2F2' : r.epoCategory === 'Y' ? 'FFFBEB' : 'F0FDF4';
    const catTextColor = r.epoCategory === 'X' ? 'DC2626' : r.epoCategory === 'Y' ? 'CA8A04' : '16A34A';
    return new TableRow({
      children: [
        makeCell(r.epoCategory, { bold: true, color: catTextColor, align: AlignmentType.CENTER, shading: catColor }),
        makeCell(r.patentId, { font: 'Courier New', size: 14 }),
        makeCell(truncate(r.title, 60)),
        makeCell(r.assignee || ''),
      ],
    });
  });
  children.push(new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    rows: [refHeaderRow, ...refDataRows],
  }));

  // ══ Section 4: Concept Coverage Matrix ══
  children.push(docxSectionHeading(4, 'Concept Coverage Matrix'));
  children.push(docxIntroBox('Shows how well each prior art reference discloses the invention\'s concepts. Checkmark = full, tilde = partial, X = none.'));

  const covConcepts = data.concepts.map(c => c.name);
  const matrixHeaderRow = new TableRow({
    children: [
      makeHeaderCell('Reference'),
      ...covConcepts.map(n => makeHeaderCell(truncate(n, 14))),
    ],
  });
  const matrixRows = data.conceptCoverage.map(pc => {
    const cells = [makeCell(truncate(pc.patentId, 18), { font: 'Courier New', size: 14 })];
    for (const cn of covConcepts) {
      const item = pc.conceptsCovered.find(c => c.conceptName === cn);
      const cov = item?.coverage || 'none';
      const symbol = cov === 'full' ? 'Y' : cov === 'partial' ? '~' : 'X';
      const color = cov === 'full' ? '16A34A' : cov === 'partial' ? 'CA8A04' : 'CCCCCC';
      const shading = cov === 'full' ? 'DCFCE7' : cov === 'partial' ? 'FEF9C3' : undefined;
      cells.push(makeCell(symbol, { bold: true, color, align: AlignmentType.CENTER, shading }));
    }
    return new TableRow({ children: cells });
  });
  children.push(new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    rows: [matrixHeaderRow, ...matrixRows],
  }));

  // ══ Section 5: Detailed Element Mapping ══
  children.push(docxSectionHeading(5, 'Detailed Element Mapping'));
  children.push(docxIntroBox('Element-by-element mapping showing how each X/Y reference discloses the invention\'s features.'));

  for (const chart of data.claimCharts) {
    const catLabel = chart.epoCategory;
    const catColor = catLabel === 'X' ? 'DC2626' : 'CA8A04';
    children.push(new Paragraph({
      children: [
        new TextRun({ text: `[${catLabel}] `, bold: true, size: 20, color: catColor }),
        new TextRun({ text: `${chart.patentId} -- ${data.patentTitles[chart.patentId] || ''}`, bold: true, size: 20, color: '1E3A5F' }),
      ],
      spacing: { before: 300, after: 100 },
    }));

    if (chart.narrativeIntro) {
      children.push(docxNarrative(chart.narrativeIntro));
    }

    const chartHeaderRow = new TableRow({
      children: [makeHeaderCell('Invention Feature'), makeHeaderCell('Prior Art Disclosure')],
    });
    const chartDataRows = chart.elements.map(el => {
      const covColor = el.coverage === 'full' ? '16A34A' : el.coverage === 'partial' ? 'CA8A04' : 'DC2626';
      return new TableRow({
        children: [
          new TableCell({
            children: [
              new Paragraph({
                children: [
                  new TextRun({ text: `${el.featureId} -- ${el.featureName}`, bold: true, size: 16, color: '1E3A5F' }),
                ],
              }),
            ],
            width: { size: 45, type: WidthType.PERCENTAGE },
          }),
          new TableCell({
            children: [
              new Paragraph({
                children: [
                  new TextRun({ text: el.sourceRef, bold: true, size: 14, color: '2563EB' }),
                ],
                spacing: { after: 60 },
              }),
              new Paragraph({
                children: [
                  new TextRun({ text: el.priorArtDisclosure, size: 14, color: '64748B', italics: true }),
                ],
                spacing: { after: 60 },
              }),
              new Paragraph({
                children: [
                  new TextRun({ text: el.coverageExplanation, bold: true, size: 14, color: covColor }),
                ],
              }),
            ],
            width: { size: 55, type: WidthType.PERCENTAGE },
          }),
        ],
      });
    });
    children.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      layout: TableLayoutType.FIXED,
      rows: [chartHeaderRow, ...chartDataRows],
    }));
  }

  // ══ Section 6: Section 102 ══
  children.push(docxSectionHeading(6, 'Section 102 -- Anticipation Analysis'));
  children.push(docxIntroBox('Under 35 U.S.C. 102, a patent claim is anticipated if every element is found in a single prior art reference.'));

  if (data.section102.length === 0) {
    children.push(new Paragraph({
      children: [new TextRun({ text: 'No Single Reference Anticipates All Elements', bold: true, size: 22, color: '16A34A' })],
      shading: { type: ShadingType.SOLID, color: 'F0FDF4' },
      border: { left: { style: BorderStyle.SINGLE, size: 12, color: 'BBF7D0' } },
      spacing: { after: 100 },
      indent: { left: 200 },
    }));
    children.push(new Paragraph({
      children: [new TextRun({ text: 'The invention is likely novel under 35 U.S.C. 102.', size: 16, color: '16A34A' })],
      indent: { left: 200 },
      spacing: { after: 200 },
    }));
  } else {
    children.push(new Paragraph({
      children: [new TextRun({ text: 'Potential Anticipation Found', bold: true, size: 22, color: 'DC2626' })],
      shading: { type: ShadingType.SOLID, color: 'FEF2F2' },
      border: { left: { style: BorderStyle.SINGLE, size: 12, color: 'FECACA' } },
      spacing: { after: 100 },
      indent: { left: 200 },
    }));
    for (const cand of data.section102) {
      children.push(new Paragraph({
        children: [
          new TextRun({ text: `${cand.patentId} `, bold: true, size: 18, font: 'Courier New' }),
          new TextRun({ text: `(${cand.coveragePercent}% coverage)`, bold: true, size: 16, color: 'DC2626' }),
        ],
        spacing: { after: 60 },
        indent: { left: 200 },
      }));
      children.push(new Paragraph({
        children: [new TextRun({ text: cand.reasoning, size: 16, color: '64748B' })],
        spacing: { after: 100 },
        indent: { left: 200 },
      }));
    }
  }

  // ══ Section 7: Section 103 ══
  children.push(docxSectionHeading(7, 'Section 103 -- Obviousness Analysis'));
  children.push(docxIntroBox('Under 35 U.S.C. 103, a claim is obvious if its subject matter would have been obvious to a person of ordinary skill in the art.'));

  if (data.section103.length === 0) {
    children.push(new Paragraph({
      children: [new TextRun({ text: 'No Obvious Combinations Identified', bold: true, size: 22, color: '16A34A' })],
      shading: { type: ShadingType.SOLID, color: 'F0FDF4' },
      border: { left: { style: BorderStyle.SINGLE, size: 12, color: 'BBF7D0' } },
      spacing: { after: 200 },
      indent: { left: 200 },
    }));
  } else {
    for (let i = 0; i < data.section103.length; i++) {
      const combo = data.section103[i];
      children.push(new Paragraph({
        children: [new TextRun({ text: `Combination ${i + 1} -- ${combo.combinedCoverage}% Combined Coverage`, bold: true, size: 22, color: '1E3A5F' })],
        shading: { type: ShadingType.SOLID, color: 'FFFBEB' },
        border: { left: { style: BorderStyle.SINGLE, size: 12, color: 'FDE68A' } },
        spacing: { before: 200, after: 100 },
        indent: { left: 200 },
      }));

      // Primary
      children.push(new Paragraph({
        children: [
          new TextRun({ text: 'PRIMARY ', bold: true, size: 16, color: '1D4ED8', shading: { type: ShadingType.SOLID, color: 'DBEAFE' } }),
          new TextRun({ text: ` ${combo.primary.patentId}`, bold: true, size: 18, font: 'Courier New' }),
          new TextRun({ text: ` -- ${data.patentTitles[combo.primary.patentId] || ''}`, size: 16, color: '64748B' }),
        ],
        spacing: { after: 60 },
        indent: { left: 400 },
      }));
      children.push(new Paragraph({
        children: [new TextRun({ text: `Concepts: ${combo.primary.conceptsContributed.join(', ')}`, size: 14, color: '64748B' })],
        spacing: { after: 100 },
        indent: { left: 400 },
      }));

      // Secondaries
      for (const sec of combo.secondary) {
        children.push(new Paragraph({
          children: [
            new TextRun({ text: 'SECONDARY ', bold: true, size: 16, color: '92400E', shading: { type: ShadingType.SOLID, color: 'FEF3C7' } }),
            new TextRun({ text: ` ${sec.patentId}`, bold: true, size: 18, font: 'Courier New' }),
            new TextRun({ text: ` -- ${data.patentTitles[sec.patentId] || ''}`, size: 16, color: '64748B' }),
          ],
          spacing: { after: 60 },
          indent: { left: 400 },
        }));
        children.push(new Paragraph({
          children: [new TextRun({ text: `Concepts: ${sec.conceptsContributed.join(', ')}`, size: 14, color: '64748B' })],
          spacing: { after: 100 },
          indent: { left: 400 },
        }));
      }

      // Motivation
      children.push(new Paragraph({
        children: [
          new TextRun({ text: 'Motivation to combine: ', bold: true, size: 16 }),
          new TextRun({ text: combo.combinationReasoning, size: 16, color: '64748B' }),
        ],
        spacing: { after: 200 },
        indent: { left: 400 },
      }));
    }
  }

  // ══ Section 8: Conclusion ══
  children.push(docxSectionHeading(8, 'Conclusion & Recommendations'));
  children.push(docxIntroBox('This section synthesizes the findings from the prior art analysis and provides an overall patentability assessment.'));

  const riskColor = data.conclusion.overallRisk === 'high' ? 'DC2626' : data.conclusion.overallRisk === 'moderate' ? 'CA8A04' : '16A34A';
  children.push(new Paragraph({
    children: [
      new TextRun({ text: 'Overall Patentability Assessment', bold: true, size: 26, color: '1E3A5F' }),
      new TextRun({ text: `  [${data.conclusion.overallRisk.toUpperCase()} RISK]`, bold: true, size: 20, color: riskColor }),
    ],
    spacing: { after: 200 },
  }));

  children.push(new Paragraph({
    children: [
      new TextRun({ text: 'Novelty (35 U.S.C. 102): ', bold: true, size: 18 }),
      new TextRun({ text: data.conclusion.noveltyAssessment, size: 18, color: '64748B' }),
    ],
    spacing: { after: 200 },
  }));

  children.push(new Paragraph({
    children: [
      new TextRun({ text: 'Non-Obviousness (35 U.S.C. 103): ', bold: true, size: 18 }),
      new TextRun({ text: data.conclusion.obviousnessAssessment, size: 18, color: '64748B' }),
    ],
    spacing: { after: 200 },
  }));

  children.push(new Paragraph({
    children: [new TextRun({ text: 'Recommendations:', bold: true, size: 18 })],
    spacing: { after: 100 },
  }));

  for (const rec of data.conclusion.recommendations) {
    children.push(new Paragraph({
      children: [new TextRun({ text: rec, size: 16, color: '64748B' })],
      bullet: { level: 0 },
      spacing: { after: 80 },
    }));
  }

  // ── Disclaimer ──
  children.push(new Paragraph({
    children: [],
    spacing: { before: 400 },
    border: { top: { style: BorderStyle.SINGLE, size: 8, color: '1E3A5F' } },
  }));

  children.push(new Paragraph({
    children: [new TextRun({ text: 'Patent Search Generator -- AI-Assisted Patent Search and Analysis', size: 16, color: '64748B' })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
  }));

  children.push(new Paragraph({
    children: [new TextRun({ text: 'IMPORTANT DISCLAIMERS', bold: true, size: 18 })],
    spacing: { after: 100 },
  }));

  for (const disc of DISCLAIMER_TEXT) {
    children.push(new Paragraph({
      children: [new TextRun({ text: disc, size: 14, color: '64748B' })],
      spacing: { after: 80 },
    }));
  }

  // Build document
  const docFile = new Document({
    sections: [{
      properties: {},
      children,
    }],
  });

  Packer.toBlob(docFile).then(blob => {
    saveAs(blob, `Full-Patent-Search-Report-${data.date.replace(/[/\s:,]/g, '-')}.docx`);
  });
}
