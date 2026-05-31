/**
 * One-time ingestion of the USPTO Patent Litigation Dataset (PTLITIG, 2020
 * release) into Firestore for the /v1/litigation endpoint (Phase 8b).
 *
 * Joins three CSVs by case_row_id and groups by patent number:
 *   patents.csv  patent -> case (case_number, district, date_filed, case_name, nos, type)
 *   cases.csv    case detail (court_name, cause, date_closed, settlement)
 *   names.csv    parties (Plaintiff / Defendant)
 *
 * Writes one doc per litigated patent:
 *   litigationByPatent/{patentDigits} = { patentNumber, caseCount, cases:[...] }
 *
 * Coverage: comprehensive 2003-2016, partial to 2020 (hand-coded patent-in-suit).
 * Run: LITIG_DIR=... node scripts/ingest-litigation.js
 */
const fs = require("fs");
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "solicitation-matcher-extension" });
const db = admin.firestore();

const DIR = process.env.LITIG_DIR || "C:/Projects/Bull-Generator/.litig-scratch";
const MAX_CASES_PER_PATENT = 300; // Firestore 1MB doc cap guard; keep most recent

function decodeHtml(s) {
  return (s || "")
    .replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
}

function parseLine(line) {
  const out = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else {
      if (c === '"') q = true;
      else if (c === ",") { out.push(cur); cur = ""; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

function* rows(path) {
  const text = fs.readFileSync(path, "utf8");
  const lines = text.split(/\r?\n/);
  const header = parseLine(lines[0]);
  const idx = {};
  header.forEach((h, i) => (idx[h.trim()] = i));
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    yield { f: parseLine(lines[i]), idx };
  }
}

function findCsv(base) {
  const hit = fs.readdirSync(DIR).find((f) => f.startsWith(base) && f.endsWith(".csv"));
  if (!hit) throw new Error(`Missing ${base}*.csv in ${DIR}`);
  return `${DIR}/${hit}`;
}

(async () => {
  console.time("ingest");

  // 1. cases.csv -> case_row_id -> detail
  console.log("Loading cases.csv ...");
  const caseDetail = new Map();
  for (const { f, idx } of rows(findCsv("cases"))) {
    const id = f[idx.case_row_id];
    if (!id) continue;
    caseDetail.set(id, {
      courtName: f[idx.court_name] || "",
      cause: f[idx.case_cause] || "",
      dateClosed: f[idx.date_closed] || "",
      settlement: (f[idx.settlement] || "").toLowerCase() === "yes" || f[idx.settlement] === "1",
      judge: f[idx.assigned_to] || "",
    });
  }
  console.log(`  ${caseDetail.size} cases`);

  // 2. names.csv -> case_row_id -> { plaintiffs, defendants }
  console.log("Loading names.csv ...");
  const parties = new Map();
  for (const { f, idx } of rows(findCsv("names"))) {
    const id = f[idx.case_row_id];
    if (!id) continue;
    const type = (f[idx.party_type] || "").toLowerCase();
    const name = decodeHtml(f[idx.name] || "");
    if (!name) continue;
    let p = parties.get(id);
    if (!p) { p = { plaintiffs: [], defendants: [] }; parties.set(id, p); }
    if (type.includes("plaintiff") && p.plaintiffs.length < 8) p.plaintiffs.push(name);
    else if (type.includes("defendant") && p.defendants.length < 8) p.defendants.push(name);
  }
  console.log(`  ${parties.size} cases with parties`);

  // 3. patents.csv -> group by patent
  console.log("Loading patents.csv + grouping ...");
  const byPatent = new Map();
  let patentRows = 0;
  for (const { f, idx } of rows(findCsv("patents"))) {
    const rawPatent = (f[idx.patent] || "").trim();
    if (!rawPatent) continue;
    const key = rawPatent.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
    if (!key || key === "NA" || !/\d/.test(key)) continue; // skip placeholders/uncoded
    patentRows++;
    const caseId = f[idx.case_row_id];
    const detail = caseDetail.get(caseId) || {};
    const party = parties.get(caseId) || { plaintiffs: [], defendants: [] };
    const rec = {
      caseNumber: f[idx.case_number] || "",
      district: f[idx.district_id] || "",
      court: detail.courtName || f[idx.district_id] || "",
      dateFiled: f[idx.date_filed] || "",
      dateClosed: detail.dateClosed || "",
      caseName: decodeHtml(f[idx.case_name] || ""),
      plaintiffs: party.plaintiffs,
      defendants: party.defendants,
      cause: detail.cause || "",
      natureOfSuit: f[idx.nos] || "",
      settlement: !!detail.settlement,
    };
    let arr = byPatent.get(key);
    if (!arr) { arr = []; byPatent.set(key, arr); }
    arr.push(rec);
  }
  console.log(`  ${patentRows} patent-case rows -> ${byPatent.size} unique patents`);

  if (process.env.DRY) {
    const sizes = [...byPatent.entries()].map(([k, v]) => [k, v.length]).sort((a, b) => b[1] - a[1]);
    console.log("Top 5 most-litigated patents:", sizes.slice(0, 5));
    for (const probe of ["6285999", "8724622", sizes[0][0]]) {
      const c = byPatent.get(probe);
      if (!c) { console.log(`\n${probe}: (not in dataset)`); continue; }
      console.log(`\n${probe}: ${c.length} cases. Most recent:`);
      c.sort((a, b) => (b.dateFiled || "").localeCompare(a.dateFiled || ""));
      c.slice(0, 2).forEach((x) => console.log(`  ${x.dateFiled} ${x.caseNumber} (${x.court}) | ${x.caseName} | P:${x.plaintiffs.join(";")||"?"} D:${x.defendants.join(";")||"?"} | cause:${x.cause}`));
    }
    console.timeEnd("ingest");
    process.exit(0);
  }

  // 4. write Firestore in batches
  console.log("Writing litigationByPatent ...");
  let written = 0, batch = db.batch(), n = 0;
  for (const [key, cases] of byPatent) {
    cases.sort((a, b) => (b.dateFiled || "").localeCompare(a.dateFiled || ""));
    const doc = {
      patentNumber: key,
      caseCount: cases.length,
      cases: cases.slice(0, MAX_CASES_PER_PATENT),
      truncated: cases.length > MAX_CASES_PER_PATENT,
      source: "USPTO PTLITIG 2020 (district-court, 2003-2020 coverage)",
      ingestedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    batch.set(db.collection("litigationByPatent").doc(key), doc);
    n++;
    if (n === 450) {
      await batch.commit();
      written += n; n = 0; batch = db.batch();
      if (written % 9000 === 0) console.log(`  ...${written} written`);
    }
  }
  if (n > 0) { await batch.commit(); written += n; }
  console.log(`Done. ${written} patent docs written.`);
  console.timeEnd("ingest");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
