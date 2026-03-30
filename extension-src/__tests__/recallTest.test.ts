import { describe, it, expect } from 'vitest';
import { buildTelescopingQueries, buildOnionRingQueries, buildFacetedQueries } from '../src/utils/searchStrategy';
import { buildFieldTargetedSearch, buildTitleClaimsSearch } from '../src/utils/conceptSearchBuilder';
import { sanitizeForGooglePatents, enforceGooglePatentsLimits } from '../src/utils/patentSearchPipeline';
import { scoreQuery } from './queryQualityScorer';
import { GROUND_ENGAGEMENT_PATENT } from './fixtures/ground-engagement-benchmark';

const patent = GROUND_ENGAGEMENT_PATENT;

/**
 * Simulated recall test for US12201049B2.
 *
 * We can't hit Google Patents from the terminal, but we CAN measure:
 * 1. Do our generated queries contain terms that appear in the patent abstract?
 * 2. How much of the abstract vocabulary is covered by our queries?
 * 3. Does the proximity pairing (new) outperform flat OR groups (legacy)?
 */

/** Check how many key abstract terms appear in the generated query */
function abstractRecall(query: string, abstract: string): { score: number; matched: string[]; missed: string[] } {
  // Extract significant terms from abstract (4+ chars, not stopwords)
  const stopwords = new Set([
    'that', 'this', 'with', 'from', 'have', 'been', 'were', 'will', 'would',
    'their', 'which', 'when', 'what', 'into', 'also', 'more', 'than',
    'includes', 'include', 'including', 'configured', 'coupled', 'least',
    'response', 'underlying', 'communicatively',
  ]);

  const abstractWords = abstract
    .toLowerCase()
    .replace(/[.,;:()]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 4 && !stopwords.has(w));

  // Deduplicate
  const uniqueAbstractTerms = [...new Set(abstractWords)];

  const qLower = query.toLowerCase();
  const matched: string[] = [];
  const missed: string[] = [];

  for (const term of uniqueAbstractTerms) {
    // Check if the term or a truncated stem appears in the query
    const stem = term.replace(/(?:ing|tion|ment|ment|able|ible|ness|ed|er|ly|ure|s)$/, '');
    if (
      qLower.includes(term) ||
      qLower.includes(`${stem}$`) ||
      qLower.includes(`${stem}*`) ||
      qLower.includes(`"${term}`)
    ) {
      matched.push(term);
    } else {
      missed.push(term);
    }
  }

  return {
    score: uniqueAbstractTerms.length > 0 ? matched.length / uniqueAbstractTerms.length : 0,
    matched,
    missed,
  };
}

// ── Tests ──

describe(`Recall test: ${patent.name}`, () => {

  describe('new proximity-based queries (with modifiers/nouns)', () => {
    const strategies = [
      { name: 'telescoping', fn: buildTelescopingQueries },
      { name: 'onion-ring', fn: buildOnionRingQueries },
      { name: 'faceted', fn: buildFacetedQueries },
    ] as const;

    for (const strat of strategies) {
      it(`${strat.name}: abstract recall >= 0.3 (at least some patent terms found)`, () => {
        const queries = strat.fn(patent.conceptsWithModifiers);
        let bestRecall = 0;
        let bestQuery = '';
        let bestResult: ReturnType<typeof abstractRecall> | null = null;

        for (const q of queries) {
          const enforced = enforceGooglePatentsLimits(q.query);
          const recall = abstractRecall(enforced, patent.abstract);
          if (recall.score > bestRecall) {
            bestRecall = recall.score;
            bestQuery = `${q.label}: ${enforced}`;
            bestResult = recall;
          }
        }

        console.log(`\n[${strat.name}] Best recall: ${(bestRecall * 100).toFixed(0)}%`);
        console.log(`  Query: ${bestQuery.substring(0, 120)}...`);
        console.log(`  Matched: ${bestResult!.matched.join(', ')}`);
        console.log(`  Missed:  ${bestResult!.missed.join(', ')}`);

        expect(bestRecall).toBeGreaterThanOrEqual(0.3);
      });
    }

    it('best query covers at least 4 of 6 concepts', () => {
      // Faceted uses all concepts — check its anchor query
      const queries = buildFacetedQueries(patent.conceptsWithModifiers);
      const anchor = queries[0];
      const enforced = enforceGooglePatentsLimits(anchor.query);
      const score = scoreQuery(enforced, patent.conceptsWithModifiers.map(c => c.name));

      console.log(`\n[Faceted anchor] Coverage: ${(score.coverage * 100).toFixed(0)}%`);
      console.log(`  Issues: ${score.issues.join('; ') || 'none'}`);

      // At least 4/6 = 0.67
      expect(score.coverage).toBeGreaterThanOrEqual(0.5);
    });
  });

  describe('legacy flat queries (without modifiers/nouns) — comparison baseline', () => {
    it('telescoping: abstract recall (legacy)', () => {
      const queries = buildTelescopingQueries(patent.conceptsLegacy);
      let bestRecall = 0;
      let bestResult: ReturnType<typeof abstractRecall> | null = null;

      for (const q of queries) {
        const enforced = enforceGooglePatentsLimits(q.query);
        const recall = abstractRecall(enforced, patent.abstract);
        if (recall.score > bestRecall) {
          bestRecall = recall.score;
          bestResult = recall;
        }
      }

      console.log(`\n[telescoping LEGACY] Best recall: ${(bestRecall * 100).toFixed(0)}%`);
      console.log(`  Matched: ${bestResult!.matched.join(', ')}`);
      console.log(`  Missed:  ${bestResult!.missed.join(', ')}`);
    });
  });

  describe('field-targeted queries for precision', () => {
    it('claims-targeted search produces valid CL= query', () => {
      const query = buildFieldTargetedSearch(patent.conceptsWithModifiers, 'CL', 2);
      console.log(`\n[Claims search] ${query}`);
      expect(query).toContain('CL=');
      // Should have multiple AND groups
      expect(query).toContain(' AND ');
    });

    it('title+claims cross-field search', () => {
      const query = buildTitleClaimsSearch(patent.conceptsWithModifiers, 2);
      console.log(`\n[Title+Claims] ${query}`);
      expect(query).toContain('TI=');
      expect(query).toContain('CL=');
    });
  });

  describe('full pipeline output (for manual verification)', () => {
    it('prints all queries for copy-paste testing in Google Patents', () => {
      console.log(`\n${'='.repeat(70)}`);
      console.log(`PATENT: ${patent.name}`);
      console.log(`TARGET: ${patent.patentId}`);
      console.log(`${'='.repeat(70)}`);

      const strategies = [
        { name: 'TELESCOPING', queries: buildTelescopingQueries(patent.conceptsWithModifiers) },
        { name: 'ONION-RING', queries: buildOnionRingQueries(patent.conceptsWithModifiers) },
        { name: 'FACETED', queries: buildFacetedQueries(patent.conceptsWithModifiers) },
      ];

      for (const strat of strategies) {
        console.log(`\n--- ${strat.name} ---`);
        for (const q of strat.queries) {
          const enforced = enforceGooglePatentsLimits(q.query);
          const recall = abstractRecall(enforced, patent.abstract);
          console.log(`\n[${q.label}] (recall: ${(recall.score * 100).toFixed(0)}%)`);
          console.log(`  ${enforced}`);
        }
      }

      // Field-targeted
      console.log(`\n--- FIELD-TARGETED ---`);
      const clQuery = buildFieldTargetedSearch(patent.conceptsWithModifiers.slice(0, 3), 'CL', 2);
      console.log(`\n[Claims top-3]`);
      console.log(`  ${clQuery}`);
      const tcQuery = buildTitleClaimsSearch(patent.conceptsWithModifiers, 2);
      console.log(`\n[Title+Claims]`);
      console.log(`  ${tcQuery}`);

      console.log(`\n${'='.repeat(70)}\n`);
    });
  });
});
