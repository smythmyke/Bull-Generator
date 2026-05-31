/**
 * One-time ingestion of the by-PARTY litigation index for /v1/company-litigation
 * (reverse lookup: company name -> its patent suits). Phase 8 reverse-lookup Idea 1.
 *
 * Same PTLITIG source as ingest-litigation.js, re-grouped by party (plaintiff /
 * defendant) instead of by patent. Writes:
 *   litigationByParty/{normName} = { normalizedName, displayNames, caseCount,
 *     asPlaintiffCount, asDefendantCount, cases:[{role, caseNumber, court,
 *     dateFiled, cause, patents, opposing}] }
 *
 * Filtered to repeat players (>= 2 cases) to cut one-off-defendant noise.
 * Name handling: conservative normalization (strip legal-entity suffixes only);
 * the endpoint does prefix matching so "Uniloc" finds "uniloc usa"/"uniloc 2017".
 *
 * Run: DRY=1 LITIG_DIR=... node scripts/ingest-company-litigation.js
 */
const fs = require("fs");
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "solicitation-matcher-extension" });
const db = admin.firestore();

const DIR = process.env.LITIG_DIR || "C:/Projects/Bull-Generator/.litig-scratch";
const MIN_CASES = 2;
const MAX_CASES_PER_PARTY = 300;
const SUFFIX = /\b(incorporated|inc|corporation|corp|company|co|llc|ltd|limited|lp|llp|plc|gmbh|sa|ag|nv|bv)\b/g;

function decodeHtml(s) {
  return (s || "").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();
}
function normName(s) {
  return decodeHtml(s).toLowerCase()
    .replace(/[.,'"]/g, "")
    .replace(SUFFIX, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ").trim();
}
function parseLine(line) {
  const out = []; let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else { if (c === '"') q = true; else if (c === ",") { out.push(cur); cur = ""; } else cur += c; }
  }
  out.push(cur); return out;
}
function* rows(base) {
  const hit = fs.readdirSync(DIR).find((f) => f.startsWith(base) && f.endsWith(".csv"));
  if (!hit) throw new Error(`Missing ${base}*.csv`);
  const lines = fs.readFileSync(`${DIR}/${hit}`, "utf8").split(/\r?\n/);
  const idx = {}; parseLine(lines[0]).forEach((h, i) => (idx[h.trim()] = i));
  for (let i = 1; i < lines.length; i++) if (lines[i]) yield { f: parseLine(lines[i]), idx };
}

(async () => {
  console.time("ingest-party");

  // case detail
  const detail = new Map();
  for (const { f, idx } of rows("cases")) {
    detail.set(f[idx.case_row_id], {
      caseNumber: f[idx.case_number] || "",
      court: f[idx.court_name] || "",
      dateFiled: f[idx.date_filed] || "",
      cause: f[idx.case_cause] || "",
    });
  }
  // patents per case (only these cases are litigated-patent cases)
  const casePatents = new Map();
  for (const { f, idx } of rows("patents")) {
    const id = f[idx.case_row_id];
    const p = (f[idx.patent] || "").trim().replace(/[^0-9A-Za-z]/g, "").toUpperCase();
    if (!p || p === "NA" || !/\d/.test(p)) continue;
    let a = casePatents.get(id); if (!a) { a = []; casePatents.set(id, a); }
    if (!a.includes(p)) a.push(p);
  }
  // parties per case
  const caseParties = new Map(); // id -> {plaintiffs:[], defendants:[]}
  for (const { f, idx } of rows("names")) {
    const id = f[idx.case_row_id];
    if (!casePatents.has(id)) continue; // only litigated-patent cases
    const name = decodeHtml(f[idx.name] || ""); if (!name) continue;
    const type = (f[idx.party_type] || "").toLowerCase();
    let p = caseParties.get(id); if (!p) { p = { plaintiffs: [], defendants: [] }; caseParties.set(id, p); }
    if (type.includes("plaintiff")) p.plaintiffs.push(name);
    else if (type.includes("defendant")) p.defendants.push(name);
  }
  console.log(`litigated-patent cases: ${casePatents.size}; with parties: ${caseParties.size}`);

  // group by party
  const byParty = new Map(); // norm -> {displayNames:Set, cases:[], pc, dc}
  function add(name, role, caseId, opposing) {
    const key = normName(name); if (!key) return;
    const d = detail.get(caseId) || {};
    let e = byParty.get(key);
    if (!e) { e = { displayNames: new Set(), cases: [], pc: 0, dc: 0 }; byParty.set(key, e); }
    e.displayNames.add(name);
    if (role === "plaintiff") e.pc++; else e.dc++;
    e.cases.push({
      role, caseNumber: d.caseNumber || "", court: d.court || "",
      dateFiled: d.dateFiled || "", cause: d.cause || "",
      patents: casePatents.get(caseId) || [],
      opposing: opposing.slice(0, 6),
    });
  }
  for (const [id, p] of caseParties) {
    for (const pl of p.plaintiffs) add(pl, "plaintiff", id, p.defendants);
    for (const df of p.defendants) add(df, "defendant", id, p.plaintiffs);
  }
  const kept = [...byParty.entries()].filter(([, e]) => e.cases.length >= MIN_CASES);
  console.log(`unique parties: ${byParty.size}; repeat players (>=${MIN_CASES}): ${kept.length}`);

  if (process.env.DRY) {
    const top = kept.map(([k, e]) => [k, e.cases.length]).sort((a, b) => b[1] - a[1]).slice(0, 8);
    console.log("Top parties by case count:", top);
    for (const probe of ["microsoft", "apple", "uniloc usa"]) {
      const e = byParty.get(probe);
      if (!e) { console.log(`\n${probe}: (no exact key)`); continue; }
      e.cases.sort((a, b) => (b.dateFiled || "").localeCompare(a.dateFiled || ""));
      console.log(`\n${probe}: ${e.cases.length} cases (P:${e.pc} D:${e.dc}) | names: ${[...e.displayNames].slice(0, 3).join(" / ")}`);
      e.cases.slice(0, 2).forEach((c) => console.log(`   ${c.dateFiled} ${c.role} ${c.caseNumber} | vs ${c.opposing.join(";")} | patents ${c.patents.join(",")} | ${c.cause}`));
    }
    console.timeEnd("ingest-party"); process.exit(0);
  }

  let written = 0, batch = db.batch(), n = 0;
  for (const [key, e] of kept) {
    e.cases.sort((a, b) => (b.dateFiled || "").localeCompare(a.dateFiled || ""));
    batch.set(db.collection("litigationByParty").doc(key.slice(0, 1400)), {
      normalizedName: key,
      displayNames: [...e.displayNames].slice(0, 10),
      caseCount: e.cases.length,
      asPlaintiffCount: e.pc,
      asDefendantCount: e.dc,
      cases: e.cases.slice(0, MAX_CASES_PER_PARTY),
      truncated: e.cases.length > MAX_CASES_PER_PARTY,
      source: "USPTO PTLITIG 2020 (district-court, 2003-2020)",
      ingestedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    if (++n === 450) { await batch.commit(); written += n; n = 0; batch = db.batch(); if (written % 9000 === 0) console.log(`  ...${written}`); }
  }
  if (n) { await batch.commit(); written += n; }
  console.log(`Done. ${written} party docs written.`);
  console.timeEnd("ingest-party"); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
