#!/usr/bin/env node
/**
 * Phase 0 FTO CLI shim.
 *
 * Loads functions/.env (so GEMINI_API_KEY + USPTO_ODP_API_KEY are available)
 * and hands off to the compiled TypeScript entry point at lib/fto/cli.js.
 *
 * Build first:
 *   cd functions && npm run build
 *
 * Then run:
 *   node fto-cli.js "Product description here..."
 *   node fto-cli.js --input ./product.txt --jurisdiction US
 *
 * The TypeScript source lives at src/fto/cli.ts. This shim only handles
 * .env loading (same minimal parser as debug-odp.js — no dotenv dep).
 */

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

require('./lib/fto/cli.js');
