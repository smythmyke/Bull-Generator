// Probe USPTO ODP for examiner-related fields/endpoints. We need to know:
//   1) Does /api/v1/patent/applications/{appNum} return examiner name + art unit?
//   2) Are there search/aggregate endpoints we can use for examiner stats?
//
// Usage: node debug-odp-examiner.js US10867416B2

const fs = require('fs');
const path = require('path');
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').replace(/^﻿/, '').split(/\r?\n/).forEach((line) => {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) process.env[m[1]] = m[2];
  });
}

const patentNumber = process.argv[2] || 'US10867416B2';
const apiKey = process.env.USPTO_ODP_API_KEY;
if (!apiKey) { console.error('USPTO_ODP_API_KEY not in .env'); process.exit(1); }

async function fetchAppNumber(pn) {
  const url = `https://patents.google.com/xhr/result?id=patent/${pn}/en`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'text/html' } });
  const html = await res.text();
  const match = html.match(/itemprop="applicationNumber"[^>]*>([^<]+)/i);
  return match ? match[1].trim().replace(/\D/g, '') : null;
}

async function probe(url, label) {
  console.log(`\n── ${label} ──`);
  console.log(`GET ${url}`);
  const res = await fetch(url, { headers: { 'X-API-KEY': apiKey, Accept: 'application/json' } });
  console.log(`Status: ${res.status}`);
  if (!res.ok) {
    const txt = await res.text();
    console.log(`Body: ${txt.slice(0, 300)}`);
    return null;
  }
  const data = await res.json();
  return data;
}

(async () => {
  // Skip GP lookup — we already know US10867416B2 → 15456367 from prior debug
  const appNum = process.argv[3] || '15456367';
  console.log(`Patent: ${patentNumber}  App: ${appNum}`);

  // 1) Bibliographic endpoint — does it carry examiner info?
  const biblio = await probe(
    `https://api.uspto.gov/api/v1/patent/applications/${appNum}`,
    'Application bibliographic'
  );
  if (biblio) {
    const bag = biblio.patentFileWrapperDataBag || [];
    console.log(`Records: ${bag.length}`);
    if (bag.length > 0) {
      const meta = bag[0].applicationMetaData || bag[0];
      // Dump only relevant keys to keep output tight
      const relevant = [
        'firstInventorToFileIndicator', 'applicationTypeCategory',
        'examinerNameText', 'inventorNameBag', 'assigneeBag',
        'groupArtUnitNumber', 'cpcClassificationBag', 'filingDate',
        'effectiveFilingDate', 'grantDate', 'patentNumber',
        'applicationStatusDescriptionText', 'inventionTitle',
      ];
      console.log('\n── Selected bibliographic fields ──');
      relevant.forEach((k) => {
        if (meta[k] !== undefined) {
          const v = typeof meta[k] === 'object' ? JSON.stringify(meta[k]).slice(0, 200) : meta[k];
          console.log(`  ${k}: ${v}`);
        }
      });
      console.log('\nAll keys on meta:', Object.keys(meta).join(', '));
    }
  }

  // 2) Try the search endpoint with the correct query format (POST with JSON body)
  console.log('\n── Search by examiner (POST) ──');
  const searchUrl = `https://api.uspto.gov/api/v1/patent/applications/search`;
  console.log(`POST ${searchUrl}`);
  const sres = await fetch(searchUrl, {
    method: 'POST',
    headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      q: 'applicationMetaData.examinerNameText:"MISLEH"',
      fields: ['applicationNumberText', 'applicationMetaData.examinerNameText', 'applicationMetaData.grantDate', 'applicationMetaData.filingDate', 'applicationMetaData.applicationStatusDescriptionText'],
      pagination: { offset: 0, limit: 5 },
    }),
  });
  console.log(`Status: ${sres.status}`);
  const sbody = await sres.text();
  console.log('Body:', sbody.slice(0, 1500));
})();
