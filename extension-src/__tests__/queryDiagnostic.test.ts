import { describe, it } from 'vitest';
import { buildTelescopingQueries, buildFacetedQueries } from '../src/utils/searchStrategy';
import { sanitizeForGooglePatents, enforceGooglePatentsLimits } from '../src/utils/patentSearchPipeline';
import { ALL_BENCHMARKS } from './fixtures/mobile-device-benchmarks';
import { scoreQuery } from './queryQualityScorer';

/**
 * Diagnostic test — prints query output for visual inspection.
 * Run with: npx vitest run __tests__/queryDiagnostic.test.ts
 */
describe('query output diagnostic', () => {
  for (const bm of ALL_BENCHMARKS) {
    describe(bm.name, () => {
      it('telescoping pipeline output', () => {
        const queries = buildTelescopingQueries(bm.concepts);
        console.log(`\n=== ${bm.name} — TELESCOPING ===`);
        for (const q of queries) {
          const sanitized = sanitizeForGooglePatents(q.query);
          const enforced = enforceGooglePatentsLimits(sanitized);
          const score = scoreQuery(enforced, bm.concepts.map(c => c.name));
          console.log(`\n[${q.label}]`);
          console.log(`  Raw:      ${q.query}`);
          if (sanitized !== q.query) console.log(`  Sanitized: ${sanitized}`);
          if (enforced !== sanitized) console.log(`  Enforced:  ${enforced}`);
          console.log(`  Final:    ${enforced}`);
          console.log(`  Score:    syntax=${score.syntax.toFixed(2)} coverage=${score.coverage.toFixed(2)} specificity=${score.specificity.toFixed(2)} balance=${score.balance.toFixed(2)} overall=${score.overall.toFixed(2)}`);
          if (score.issues.length > 0) {
            console.log(`  Issues:   ${score.issues.join('; ')}`);
          }
          console.log(`  Length:   ${enforced.length} chars, ${(enforced.match(/\sAND\s/gi) || []).length + 1} AND groups, ${(enforced.match(/\sOR\s/gi) || []).length} OR ops`);
        }
      });

      it('faceted pipeline output', () => {
        const queries = buildFacetedQueries(bm.concepts);
        console.log(`\n=== ${bm.name} — FACETED ===`);
        for (const q of queries) {
          const enforced = enforceGooglePatentsLimits(q.query);
          const score = scoreQuery(enforced, bm.concepts.map(c => c.name));
          console.log(`\n[${q.label}]`);
          console.log(`  Query:  ${enforced}`);
          console.log(`  Score:  overall=${score.overall.toFixed(2)} coverage=${score.coverage.toFixed(2)}`);
          console.log(`  Stats:  ${enforced.length}ch, ${(enforced.match(/\sAND\s/gi) || []).length + 1} ANDs, ${(enforced.match(/\sOR\s/gi) || []).length} ORs`);
        }
      });
    });
  }
});
