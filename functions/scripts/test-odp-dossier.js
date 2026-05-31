/**
 * Throwaway Phase-3 verification harness for the ODP dossier path.
 * Run:  USPTO_ODP_API_KEY=... node scripts/test-odp-dossier.js
 * Not committed with a key — reads USPTO_ODP_API_KEY from the environment.
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "solicitation-matcher-extension" });

const { handleOdpDossierRequest } = require("../lib/odp/odpDossier");

const PATENTS = ["US10000000B2", "10509666", "US7654321B2", "EP3500001B1"];

(async () => {
  for (const pn of PATENTS) {
    try {
      const r = await handleOdpDossierRequest({ patentNumber: pn });
      if (r.error) {
        console.log(`\n${pn}: ERROR [${r.code}] ${r.error}`);
        continue;
      }
      const d = r.dossier;
      const h = d.header;
      console.log(`\n=== ${pn} -> ${d.patentNumber} (cached=${d.cached}) ===`);
      console.log(`  title:        ${h.title.slice(0, 70)}`);
      console.log(`  inventors:    ${h.inventors.length} -> ${h.inventors.slice(0, 2).join("; ")}`);
      console.log(`  origAssignee: ${h.originalAssignee}`);
      console.log(`  currAssignee: ${h.currentAssignee}`);
      console.log(`  appNumber:    ${h.applicationNumber}`);
      console.log(`  dates:        filing=${h.filingDate} grant=${h.grantDate} exp=${h.anticipatedExpiration}`);
      console.log(`  status:       ${h.status} (${h.statusLabel})`);
      console.log(`  abstract:     ${h.abstract.length} chars | ${h.abstract.slice(0, 80)}...`);
      console.log(`  claims:       total=${d.claims.totalCount} independent=[${d.claims.independentNumbers.join(",")}]`);
      console.log(`  claim 1:      ${(d.claims.items[0]?.text || "").slice(0, 90)}...`);
      console.log(`  citations:    backward=${d.citations.backwardCount} forward=${d.citations.forwardCount}`);
      console.log(`  cpc:          ${d.classification.cpcCodes.length} -> ${d.classification.cpcCodes.slice(0, 4).map((c) => c.code).join(", ")}`);
      console.log(`  family:       ${d.family.members.length} members`);
      console.log(`  similar:      ${d.similar.length} (expected 0)`);
    } catch (e) {
      console.log(`\n${pn}: THREW ${e.message}`);
    }
  }
  process.exit(0);
})();
