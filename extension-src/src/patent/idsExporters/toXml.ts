import { saveAs } from 'file-saver';
import type { IdsBundle, IdsReference } from '../idsGenerator';

// XML structure is inspired by USPTO ST.96 patent-document conventions
// for IDS data exchange. It is NOT a direct USPTO e-filing format —
// Patent Center accepts web-form IDS or DOCX/PDF uploads, not raw XML.
// This file is intended for use with downstream tooling (docketing systems,
// custom filing wrappers) that consume structured IDS data.

function xmlEscape(value: string | undefined): string {
  if (value === undefined || value === null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function indent(level: number): string {
  return '  '.repeat(level);
}

function refToXml(ref: IdsReference, idx: number, level: number): string {
  const lines: string[] = [];
  const examinerCited = ref.sources.includes('examiner-cited');
  const oaCited = ref.sources.includes('oa-cited');

  lines.push(`${indent(level)}<patent-reference cite-number="${idx + 1}" examiner-cited="${examinerCited}" oa-cited="${oaCited}">`);
  lines.push(`${indent(level + 1)}<document-number>${xmlEscape(ref.patentNumber)}</document-number>`);
  lines.push(`${indent(level + 1)}<normalized-number>${xmlEscape(ref.normalizedNumber)}</normalized-number>`);
  if (ref.date) {
    lines.push(`${indent(level + 1)}<publication-date>${xmlEscape(ref.date)}</publication-date>`);
  }
  if (ref.title) {
    lines.push(`${indent(level + 1)}<invention-title>${xmlEscape(ref.title)}</invention-title>`);
  }
  if (ref.assignee) {
    lines.push(`${indent(level + 1)}<assignee>${xmlEscape(ref.assignee)}</assignee>`);
  }
  lines.push(`${indent(level + 1)}<sources>`);
  for (const source of ref.sources) {
    lines.push(`${indent(level + 2)}<source>${xmlEscape(source)}</source>`);
  }
  lines.push(`${indent(level + 1)}</sources>`);
  if (ref.oaShortNames?.length) {
    lines.push(`${indent(level + 1)}<oa-short-names>`);
    for (const name of ref.oaShortNames) {
      lines.push(`${indent(level + 2)}<name>${xmlEscape(name)}</name>`);
    }
    lines.push(`${indent(level + 1)}</oa-short-names>`);
  }
  lines.push(`${indent(level)}</patent-reference>`);
  return lines.join('\n');
}

export function buildIdsXml(bundle: IdsBundle): string {
  const c = bundle.counts;
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<!-- IDS data export. Not a direct USPTO e-filing format. -->');
  lines.push('<!-- USPTO Patent Center accepts web-form IDS or DOCX/PDF uploads. -->');
  lines.push('<information-disclosure-statement version="1.0" xmlns="urn:patent-search-generator:ids:v1">');
  lines.push(`  <meta>`);
  lines.push(`    <reference-patent>${xmlEscape(bundle.patentNumber)}</reference-patent>`);
  if (bundle.applicationNumber) {
    lines.push(`    <application-number>${xmlEscape(bundle.applicationNumber)}</application-number>`);
  }
  lines.push(`    <generated-at>${xmlEscape(bundle.generatedAt)}</generated-at>`);
  lines.push(`    <counts total="${c.total}" backward="${c.fromBackward}" examiner-cited="${c.fromExaminerCited}" oa-cited="${c.fromOaCited}" analyzed-oas="${c.analyzedOaCount}"/>`);
  lines.push(`  </meta>`);
  lines.push(`  <us-patent-documents count="${c.total}">`);
  bundle.references.forEach((ref, idx) => {
    lines.push(refToXml(ref, idx, 2));
  });
  lines.push(`  </us-patent-documents>`);
  lines.push('  <disclaimer>This document was machine-generated from public citation data. Not legal advice. Verify each reference before filing.</disclaimer>');
  lines.push('</information-disclosure-statement>');
  return lines.join('\n');
}

export function downloadIdsXml(bundle: IdsBundle): void {
  const xml = buildIdsXml(bundle);
  const blob = new Blob([xml], { type: 'application/xml;charset=utf-8' });
  saveAs(blob, `IDS-${bundle.patentNumber}.xml`);
}
