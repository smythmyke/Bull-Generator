/**
 * Smoke test for the patent-dossier parsers.
 * Reads a saved GP XHR fixture and runs buildDossierFromHtml() on it.
 * Run from functions/ dir:  node smoke-dossier.js [fixturePath] [patentNumber]
 */
const fs = require("fs");
const path = require("path");

const { buildDossierFromHtml, normalizePatentNumber } = require("./lib/patentDossier");

const fixturePath = process.argv[2] || path.join("..", "gp-fixture-us10867416b2.html");
const patentNumber = process.argv[3] || "US10867416B2";

const html = fs.readFileSync(fixturePath, "utf8");
console.log(`Fixture: ${fixturePath} (${html.length} bytes)`);
console.log(`Patent:  ${normalizePatentNumber(patentNumber)}\n`);

const dossier = buildDossierFromHtml(normalizePatentNumber(patentNumber), html);

const { header, family, claims, citations, classification, similar, legalStatus } = dossier;

console.log("── Header ─────────────────────────────────────────────────");
console.log(`Title:          ${header.title}`);
console.log(`Abstract:       ${header.abstract.slice(0, 120)}...`);
console.log(`Inventors:      ${header.inventors.join(", ")}`);
console.log(`Orig assignee:  ${header.originalAssignee}`);
console.log(`Curr assignee:  ${header.currentAssignee}`);
console.log(`App no.:        ${header.applicationNumber}`);
console.log(`Dates:          prio=${header.priorityDate} file=${header.filingDate} pub=${header.publicationDate} exp=${header.anticipatedExpiration}`);
console.log(`Status:         ${header.status} (${header.statusLabel})`);

console.log("\n── Legal Status ──────────────────────────────────────────");
legalStatus.forEach((r) => console.log(`  ${r.jurisdiction}: ${r.status} (${r.keyDate})`));

console.log("\n── Family ────────────────────────────────────────────────");
console.log(`Family ID: ${family.familyId || "(none)"}`);
console.log(`Members:   ${family.members.length}`);
family.members.slice(0, 10).forEach((m) =>
  console.log(`  ${m.jurisdiction} ${m.publicationNumber} (${m.type}) ${m.date}`)
);

console.log("\n── Claims ────────────────────────────────────────────────");
console.log(`Total:        ${claims.totalCount}`);
console.log(`Independent:  ${claims.independentNumbers.join(", ")} (${claims.independentNumbers.length} total)`);
console.log(`Parsed items: ${claims.items.length}`);
claims.items.slice(0, 5).forEach((c) =>
  console.log(`  #${c.number} ${c.isIndependent ? "[IND]" : `[dep on ${c.dependsOn ?? "?"}]`} ${c.text.slice(0, 80)}...`)
);

console.log("\n── Citations ─────────────────────────────────────────────");
console.log(`Forward: ${citations.forwardCount}`);
citations.forward.slice(0, 5).forEach((c) =>
  console.log(`  ${c.patentNumber} (${c.date || "n/a"}) ${c.assignee || ""} — ${(c.title || "").slice(0, 60)}`)
);
console.log(`Backward: ${citations.backwardCount}`);
citations.backward.slice(0, 5).forEach((c) =>
  console.log(`  ${c.patentNumber}${c.examinerCited ? " [examiner]" : ""} (${c.date || "n/a"}) ${c.assignee || ""} — ${(c.title || "").slice(0, 60)}`)
);

console.log("\n── Classification ────────────────────────────────────────");
console.log(`CPC codes: ${classification.cpcCodes.length}`);
classification.cpcCodes.forEach((c) =>
  console.log(`  ${c.primary ? "★" : " "} ${c.code.padEnd(14)} ${c.label}`)
);

console.log("\n── Similar ───────────────────────────────────────────────");
console.log(`Count: ${similar.length}`);
similar.slice(0, 5).forEach((s) => console.log(`  ${s.patentNumber} — ${s.title || ""}`));

console.log("\n── Summary ───────────────────────────────────────────────");
const issues = [];
if (!header.title) issues.push("missing title");
if (!header.abstract) issues.push("missing abstract");
if (header.inventors.length === 0) issues.push("no inventors");
if (!header.originalAssignee) issues.push("no original assignee");
if (claims.items.length === 0) issues.push("no claims parsed");
if (claims.independentNumbers.length === 0) issues.push("no independent claims detected");
if (classification.cpcCodes.length === 0) issues.push("no CPC codes parsed");
if (family.members.length === 0) issues.push("no family members");
if (issues.length === 0) {
  console.log("✓ All required fields populated");
} else {
  console.log(`⚠ ${issues.length} issue(s): ${issues.join(", ")}`);
  process.exitCode = 1;
}
