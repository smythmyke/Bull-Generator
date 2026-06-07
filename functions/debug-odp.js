// One-off debug: dump the raw USPTO ODP response for a single patent so we can
// see exactly what JSON field holds the PDF download URI.
//
// Usage: node debug-odp.js US10867416B2
//
// Reads USPTO_ODP_API_KEY from .env. Not committed — safe to delete after use.

// Minimal .env parser — avoids the dotenv dep. Handles CRLF + BOM.
const fs = require('fs');
const path = require('path');
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const raw = fs.readFileSync(envPath, 'utf8').replace(/^﻿/, '');
  raw.split(/\r?\n/).forEach((line) => {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) process.env[m[1]] = m[2];
  });
}
console.log(`[debug] .env loaded; USPTO_ODP_API_KEY present: ${!!process.env.USPTO_ODP_API_KEY} (length=${(process.env.USPTO_ODP_API_KEY||'').length})`);

const patentNumber = process.argv[2] || 'US10867416B2';
const apiKey = process.env.USPTO_ODP_API_KEY;

if (!apiKey) {
  console.error('USPTO_ODP_API_KEY not in .env');
  process.exit(1);
}

async function fetchGpAppNumber(pn) {
  const url = `https://patents.google.com/xhr/result?id=patent/${pn}/en`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; PatentSearchBot/1.0)',
      Accept: 'text/html',
    },
  });
  if (!res.ok) throw new Error(`GP returned ${res.status}`);
  const html = await res.text();
  const match = html.match(/itemprop="applicationNumber"[^>]*>([^<]+)/i);
  if (!match) throw new Error('applicationNumber not found in GP response');
  return match[1].trim();
}

async function fetchOdpDocs(appNumberDigits) {
  const url = `https://api.uspto.gov/api/v1/patent/applications/${appNumberDigits}/documents`;
  console.log(`\nGET ${url}`);
  const res = await fetch(url, {
    headers: { 'X-API-KEY': apiKey, Accept: 'application/json' },
  });
  console.log(`Status: ${res.status}`);
  const text = await res.text();
  if (!res.ok) {
    console.error('Body:', text.slice(0, 500));
    throw new Error(`ODP returned ${res.status}`);
  }
  return JSON.parse(text);
}

(async () => {
  try {
    const rawApp = await fetchGpAppNumber(patentNumber);
    const appDigits = rawApp.replace(/\D/g, '');
    console.log(`Patent: ${patentNumber}`);
    console.log(`Application No. (raw from GP): ${rawApp}`);
    console.log(`Application No. (digits-only): ${appDigits}`);

    const data = await fetchOdpDocs(appDigits);

    console.log(`\nTop-level keys: ${Object.keys(data).join(', ')}`);
    const bag = data.documentBag || data.documents || data.results || [];
    console.log(`Doc count: ${bag.length}`);

    if (bag.length > 0) {
      console.log('\n── First document (raw) ──────────────────────────────');
      console.log(JSON.stringify(bag[0], null, 2));

      // Find first Office Action (CTNF/CTFR) for focused inspection
      const oa = bag.find((d) => {
        const code = (d.documentCode || d.code || '').toUpperCase();
        return code === 'CTNF' || code === 'CTFR' || code === 'CTAV';
      });
      if (oa) {
        console.log('\n── First Office Action (raw) ─────────────────────────');
        console.log(JSON.stringify(oa, null, 2));
      } else {
        console.log('\n(No Office Action found in this file wrapper)');
      }

      // List all unique top-level keys across the bag, to make sure we're not
      // missing a field that only some docs carry.
      const allKeys = new Set();
      bag.forEach((d) => Object.keys(d).forEach((k) => allKeys.add(k)));
      console.log(`\nAll unique document keys: ${[...allKeys].sort().join(', ')}`);
    }
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
})();
