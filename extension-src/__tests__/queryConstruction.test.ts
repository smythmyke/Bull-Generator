import { describe, it, expect } from 'vitest';
import { buildTelescopingQueries, buildOnionRingQueries, buildFacetedQueries } from '../src/utils/searchStrategy';
import { buildSearchesFromConcepts, buildGroup } from '../src/utils/conceptSearchBuilder';
import { ALL_BENCHMARKS } from './fixtures/mobile-device-benchmarks';
import { scoreQuery } from './queryQualityScorer';

// ── Basic buildGroup ──

describe('buildGroup', () => {
  it('returns empty string for empty array', () => {
    expect(buildGroup([])).toBe('');
  });

  it('returns single term without parens', () => {
    expect(buildGroup(['hinge'])).toBe('hinge');
  });

  it('wraps multiple terms in parens with OR', () => {
    expect(buildGroup(['hinge', 'pivot'])).toBe('(hinge OR pivot)');
  });

  it('auto-quotes multi-word terms', () => {
    const result = buildGroup(['hinge mechanism', 'pivot']);
    expect(result).toBe('("hinge mechanism" OR pivot)');
  });
});

// ── Proximity pairing ──

describe('proximity-based concept groups', () => {
  it('generates NEAR/5 between modifiers and nouns', () => {
    const queries = buildTelescopingQueries(ALL_BENCHMARKS[0].concepts);
    // Every concept has modifiers + nouns, so all groups should use NEAR
    for (const q of queries) {
      expect(q.query).toContain('NEAR/5');
    }
  });

  it('modifier group stems words before $ truncation', () => {
    const queries = buildTelescopingQueries(ALL_BENCHMARKS[0].concepts);
    // "foldable" → "foldab$" (strips -le, min 5 char stem)
    expect(queries[0].query).toContain('foldab$');
    // "collapsible" → "collaps$" (strips -ible, 7 char stem)
    expect(queries[0].query).toContain('collaps$');
    // "articulating" → "articula$" (strips -ting)
    expect(queries[0].query).toContain('articula$');
  });

  it('noun group uses $ truncation on single words', () => {
    const queries = buildTelescopingQueries(ALL_BENCHMARKS[0].concepts);
    // "device" should become device$
    expect(queries[0].query).toContain('device$');
  });

  it('multi-word nouns get quoted not truncated', () => {
    const queries = buildTelescopingQueries(ALL_BENCHMARKS[0].concepts);
    // "mobile device" should appear as "mobile device" not mobile$ device$
    expect(queries[0].query).toContain('"mobile device"');
  });

  it('falls back to flat OR group when no modifiers/nouns', () => {
    const legacyConcepts = ALL_BENCHMARKS[0].concepts.map(c => ({
      ...c,
      modifiers: undefined,
      nouns: undefined,
    }));
    const queries = buildTelescopingQueries(legacyConcepts);
    // Should NOT contain NEAR since there are no modifiers/nouns
    for (const q of queries) {
      expect(q.query).not.toContain('NEAR/');
    }
    // Should still produce valid OR groups joined by AND
    for (const q of queries) {
      expect(q.query).toContain(' AND ');
      expect(q.query).toContain(' OR ');
    }
  });
});

// ── Telescoping strategy ──

describe('buildTelescopingQueries', () => {
  it('returns empty array for no enabled concepts', () => {
    const result = buildTelescopingQueries([
      { name: 'test', synonyms: [], enabled: false },
    ]);
    expect(result).toEqual([]);
  });

  it('produces exactly 3 queries (Broad, Moderate, Narrow)', () => {
    const result = buildTelescopingQueries(ALL_BENCHMARKS[0].concepts);
    expect(result).toHaveLength(3);
    expect(result.map(r => r.label)).toEqual(['Broad', 'Moderate', 'Narrow']);
  });

  it('Broad has more OR terms than Narrow', () => {
    const result = buildTelescopingQueries(ALL_BENCHMARKS[0].concepts);
    const broadOrCount = (result[0].query.match(/\sOR\s/gi) || []).length;
    const narrowOrCount = (result[2].query.match(/\sOR\s/gi) || []).length;
    expect(broadOrCount).toBeGreaterThanOrEqual(narrowOrCount);
  });

  it('does NOT use unsupported Orbit operators', () => {
    for (const bm of ALL_BENCHMARKS) {
      const queries = buildTelescopingQueries(bm.concepts);
      for (const q of queries) {
        // NEAR is allowed (Google Patents supports it), but Orbit-specific ones should not appear
        expect(q.query).not.toMatch(/\bWITH\b/i);
        expect(q.query).not.toMatch(/\bSAME\b/i);
        expect(q.query).not.toMatch(/\b\d+D\b/);
      }
    }
  });

  it('uses $ (multi-char) not * (single-char) for truncation', () => {
    for (const bm of ALL_BENCHMARKS) {
      const queries = buildTelescopingQueries(bm.concepts);
      for (const q of queries) {
        expect(q.query).toMatch(/\w{4,}\$/);
        // No auto-generated * wildcards
        const autoStarred = q.query.match(/\b\w{4,}\*/g) || [];
        expect(autoStarred).toEqual([]);
      }
    }
  });
});

// ── Onion Ring strategy ──

describe('buildOnionRingQueries', () => {
  it('starts with fewer concepts and adds more', () => {
    const queries = buildOnionRingQueries(ALL_BENCHMARKS[0].concepts);
    expect(queries.length).toBeGreaterThanOrEqual(1);

    for (let i = 1; i < queries.length; i++) {
      const prevAnds = (queries[i - 1].query.match(/\sAND\s/gi) || []).length;
      const currAnds = (queries[i].query.match(/\sAND\s/gi) || []).length;
      expect(currAnds).toBeGreaterThanOrEqual(prevAnds);
    }
  });

  it('goes up to 5 AND groups (raised limit)', () => {
    const queries = buildOnionRingQueries(ALL_BENCHMARKS[0].concepts);
    // With 5 concepts, should produce layers up to 5
    expect(queries.length).toBeGreaterThanOrEqual(3);
  });
});

// ── Faceted strategy ──

describe('buildFacetedQueries', () => {
  it('first query is the anchor (most concepts)', () => {
    const queries = buildFacetedQueries(ALL_BENCHMARKS[0].concepts);
    expect(queries[0].label).toContain('Anchor');
  });

  it('produces drop-one variants', () => {
    const queries = buildFacetedQueries(ALL_BENCHMARKS[0].concepts);
    const dropOnes = queries.filter(q => q.label.startsWith('Without'));
    expect(dropOnes.length).toBeGreaterThanOrEqual(1);
  });

  it('stays within 8-query budget', () => {
    for (const bm of ALL_BENCHMARKS) {
      const queries = buildFacetedQueries(bm.concepts);
      expect(queries.length).toBeLessThanOrEqual(8);
    }
  });

  it('no duplicate query text', () => {
    for (const bm of ALL_BENCHMARKS) {
      const queries = buildFacetedQueries(bm.concepts);
      const queryTexts = queries.map(q => q.query);
      const unique = new Set(queryTexts);
      expect(unique.size).toBe(queryTexts.length);
    }
  });
});

// ── Cross-strategy: all benchmarks pass quality scorer ──

describe('query quality scores across all benchmarks', () => {
  for (const bm of ALL_BENCHMARKS) {
    describe(bm.name, () => {
      const strategies = [
        { name: 'telescoping', fn: buildTelescopingQueries },
        { name: 'onion-ring', fn: buildOnionRingQueries },
        { name: 'faceted', fn: buildFacetedQueries },
      ] as const;

      for (const strat of strategies) {
        it(`${strat.name}: syntax score >= 0.7`, () => {
          const queries = strat.fn(bm.concepts);
          for (const q of queries) {
            const score = scoreQuery(q.query, bm.concepts.map(c => c.name));
            expect(score.syntax).toBeGreaterThanOrEqual(0.7);
          }
        });

        it(`${strat.name}: coverage score >= 0.4 (at least some concepts present)`, () => {
          const queries = strat.fn(bm.concepts);
          const bestCoverage = Math.max(
            ...queries.map(q => scoreQuery(q.query, bm.concepts.map(c => c.name)).coverage)
          );
          expect(bestCoverage).toBeGreaterThanOrEqual(0.4);
        });

        it(`${strat.name}: overall score >= 0.5`, () => {
          const queries = strat.fn(bm.concepts);
          for (const q of queries) {
            const score = scoreQuery(q.query, bm.concepts.map(c => c.name));
            expect(score.overall).toBeGreaterThanOrEqual(0.5);
          }
        });
      }
    });
  }
});
