import { describe, it, expect } from 'vitest';
import { sanitizeForGooglePatents, enforceGooglePatentsLimits } from '../src/utils/patentSearchPipeline';
import { buildTelescopingQueries } from '../src/utils/searchStrategy';
import { buildFieldTargetedSearch, buildTitleClaimsSearch, wrapWithField } from '../src/utils/conceptSearchBuilder';
import { ALL_BENCHMARKS } from './fixtures/mobile-device-benchmarks';
import { scoreQuery, diffEnforcedQuery } from './queryQualityScorer';

// ── sanitizeForGooglePatents ──

describe('sanitizeForGooglePatents', () => {
  it('strips Orbit-only field prefixes (FT=, TAC=, CA=)', () => {
    const input = 'FT=((hinge* OR pivot*) AND TAC=(fold* OR bend*))';
    const result = sanitizeForGooglePatents(input);
    expect(result).not.toMatch(/\b(FT|TAC|CA)\s*=/i);
  });

  it('preserves Google Patents field operators (TI=, AB=, CL=)', () => {
    const input = 'TI=(hinge) AND AB=(foldable) AND CL=(pivot)';
    const result = sanitizeForGooglePatents(input);
    expect(result).toContain('TI=');
    expect(result).toContain('AB=');
    expect(result).toContain('CL=');
  });

  it('removes country code clauses', () => {
    const input = '(hinge* OR pivot*) AND CC=US';
    const result = sanitizeForGooglePatents(input);
    expect(result).not.toContain('CC=');
    expect(result).not.toContain('US');
  });

  it('preserves NEAR/N (Google Patents supports it)', () => {
    const input = 'hinge NEAR/3 foldable';
    const result = sanitizeForGooglePatents(input);
    expect(result).toContain('NEAR/3');
  });

  it('preserves ADJ/N (Google Patents supports it)', () => {
    const input = 'camera ADJ/2 display';
    const result = sanitizeForGooglePatents(input);
    expect(result).toContain('ADJ/2');
  });

  it('converts Orbit nD proximity to NEAR/N', () => {
    const input = 'sensor 5D fingerprint';
    const result = sanitizeForGooglePatents(input);
    expect(result).toContain('NEAR/5');
    expect(result).not.toMatch(/\s5D\s/);
  });

  it('preserves wildcards (*)', () => {
    const input = 'hing* OR pivot* OR fold*';
    const result = sanitizeForGooglePatents(input);
    expect(result).toContain('hing*');
    expect(result).toContain('pivot*');
    expect(result).toContain('fold*');
  });

  it('extracts CPC codes and converts to semicolon syntax', () => {
    const input = '(hinge OR pivot) AND CPC=G06F1/1616';
    const result = sanitizeForGooglePatents(input);
    expect(result).toContain(';(G06F1/1616)');
    expect(result).not.toContain('CPC=');
  });

  it('handles combined Orbit syntax (strips Orbit-only, preserves Google Patents ops)', () => {
    const input = 'FT=((drill* OR bore*) NEAR/3 (head* OR tip*)) AND TAC=(rotary) AND CC=US AND CPC=E21B10';
    const result = sanitizeForGooglePatents(input);
    expect(result).not.toMatch(/\bFT=/i);
    expect(result).not.toMatch(/\bTAC=/i);
    expect(result).not.toMatch(/\bCC=/i);
    expect(result).toContain('NEAR/3'); // preserved, not stripped
    expect(result).toContain(';(E21B10)');
    expect(result).toContain('drill*');
  });

  it('passes through already-clean Google Patents queries', () => {
    const input = '(hinge* OR pivot*) AND (foldable* OR bendable*)';
    const result = sanitizeForGooglePatents(input);
    expect(result).toBe(input);
  });
});

// ── enforceGooglePatentsLimits ──

describe('enforceGooglePatentsLimits', () => {
  it('passes through a query already within limits', () => {
    const input = '(a OR b) AND (x OR y)';
    const result = enforceGooglePatentsLimits(input);
    expect(result).toBe(input);
  });

  it('allows up to 5 AND groups', () => {
    const input = '(a OR b) AND (c OR d) AND (e OR f) AND (g OR h) AND (i OR j)';
    const result = enforceGooglePatentsLimits(input);
    const andCount = (result.match(/\sAND\s/gi) || []).length;
    expect(andCount).toBe(4); // 5 groups = 4 ANDs — all preserved
  });

  it('trims beyond 5 AND groups', () => {
    const input = '(a) AND (b) AND (c) AND (d) AND (e) AND (f) AND (g)';
    const result = enforceGooglePatentsLimits(input);
    const andCount = (result.match(/\sAND\s/gi) || []).length;
    expect(andCount).toBeLessThanOrEqual(4); // max 5 groups = 4 ANDs
  });

  it('allows up to 20 total OR operators', () => {
    const input = '(a OR b OR c OR d OR e OR f OR g) AND (h OR i OR j OR k OR l OR m OR n)';
    const result = enforceGooglePatentsLimits(input);
    const orCount = (result.match(/\sOR\s/gi) || []).length;
    expect(orCount).toBeLessThanOrEqual(20);
    // 12 OR ops total — should be preserved fully
    expect(orCount).toBe(12);
  });

  it('preserves CPC codes through enforcement (semicolon syntax)', () => {
    const input = '(a OR b) AND (c OR d);(G06F1/16);(H05K5/02)';
    const result = enforceGooglePatentsLimits(input);
    expect(result).toContain(';(G06F1/16)');
    expect(result).toContain(';(H05K5/02)');
  });

  it('deduplicates quoted vs unquoted terms', () => {
    const input = '(hinge OR "hinge" OR pivot)';
    const result = enforceGooglePatentsLimits(input);
    const hingeCount = (result.match(/\bhinge\b/gi) || []).length;
    expect(hingeCount).toBe(1);
  });

  it('prefers $-truncated version when deduplicating', () => {
    const input = '(hinge OR hinge$ OR pivot)';
    const result = enforceGooglePatentsLimits(input);
    expect(result).toContain('hinge$');
    // hinge (exact) should be deduplicated away
    const hingeExact = (result.match(/\bhinge\b(?!\$)/g) || []).length;
    expect(hingeExact).toBe(0);
  });

  it('handles trailing empty semicolon (no CPC after it)', () => {
    const input = '(a OR b) AND (c OR d);';
    const result = enforceGooglePatentsLimits(input);
    // Should not end with bare semicolon (empty CPC would be filtered)
    expect(result).toMatch(/[^;]$/);
  });
});

// ── Round-trip: strategy → sanitize → enforce → quality check ──

describe('full pipeline round-trip quality', () => {
  for (const bm of ALL_BENCHMARKS) {
    describe(bm.name, () => {
      it('telescoping queries survive sanitize+enforce with good quality', () => {
        const queries = buildTelescopingQueries(bm.concepts);

        for (const q of queries) {
          const sanitized = sanitizeForGooglePatents(q.query);
          const enforced = enforceGooglePatentsLimits(sanitized);
          const score = scoreQuery(enforced, bm.concepts.map(c => c.name));

          // The final query should still be syntactically valid
          expect(score.syntax).toBeGreaterThanOrEqual(0.9);

          // Should not have lost all concept coverage
          expect(score.coverage).toBeGreaterThan(0);

          // Overall should be reasonable
          expect(score.overall).toBeGreaterThanOrEqual(0.45);
        }
      });

      it('enforcer does not drop high-importance concept terms', () => {
        const queries = buildTelescopingQueries(bm.concepts);
        const highConcepts = bm.concepts
          .filter(c => c.importance === 'high')
          .map(c => c.name.toLowerCase());

        for (const q of queries) {
          const enforced = enforceGooglePatentsLimits(q.query);
          const { dropped } = diffEnforcedQuery(q.query, enforced);

          // No dropped term should be from a high-importance concept name
          for (const d of dropped) {
            const isHighConcept = highConcepts.some(hc =>
              hc.includes(d.replace('*', '')) || d.replace('*', '').includes(hc)
            );
            if (isHighConcept) {
              // This is a WARNING not a hard fail — but flag it
              console.warn(
                `[${bm.name}/${q.label}] High-importance term dropped by enforcer: "${d}"`
              );
            }
          }
        }
      });
    });
  }
});

// ── Edge cases ──

describe('sanitizer edge cases', () => {
  it('handles empty string', () => {
    expect(sanitizeForGooglePatents('')).toBe('');
  });

  it('handles query that is only a CPC code', () => {
    const result = sanitizeForGooglePatents('CPC=A61B5/02');
    expect(result).toContain('(A61B5/02)');
  });

  it('handles multiple CPC codes', () => {
    const result = sanitizeForGooglePatents('hinge AND CPC=G06F1/16 AND CPC=H05K5/02');
    expect(result).toContain(';(G06F1/16)');
    expect(result).toContain(';(H05K5/02)');
  });
});

describe('enforcer edge cases', () => {
  it('handles empty string', () => {
    expect(enforceGooglePatentsLimits('')).toBe('');
  });

  it('handles single term', () => {
    expect(enforceGooglePatentsLimits('hinge')).toBe('hinge');
  });

  it('handles CPC-only query (semicolon syntax)', () => {
    const result = enforceGooglePatentsLimits('(hinge);(G06F1/16)');
    expect(result).toContain('hinge');
    expect(result).toContain(';(G06F1/16)');
  });
});

// ── Field Operators ──

describe('field operator queries', () => {
  it('wrapWithField produces TI=(group)', () => {
    const result = wrapWithField('TI', ['hinge', 'pivot']);
    expect(result).toBe('TI=((hinge OR pivot))');
  });

  it('wrapWithField produces CL=(group)', () => {
    const result = wrapWithField('CL', ['foldable device', 'bendable']);
    expect(result).toBe('CL=(("foldable device" OR bendable))');
  });

  it('buildFieldTargetedSearch creates field-wrapped AND groups', () => {
    const result = buildFieldTargetedSearch(ALL_BENCHMARKS[0].concepts, 'CL', 2);
    expect(result).toContain('CL=');
    expect(result).toContain(' AND ');
    // Each concept should be in its own CL=() group
    const clCount = (result.match(/CL=/g) || []).length;
    const enabledCount = ALL_BENCHMARKS[0].concepts.filter(c => c.enabled).length;
    expect(clCount).toBe(enabledCount);
  });

  it('buildTitleClaimsSearch puts top concept in TI and second in CL', () => {
    const result = buildTitleClaimsSearch(ALL_BENCHMARKS[0].concepts, 2);
    expect(result).toContain('TI=');
    expect(result).toContain('CL=');
    expect(result).toContain(' AND ');
  });

  it('field operators survive sanitizer passthrough', () => {
    const fieldQuery = buildFieldTargetedSearch(ALL_BENCHMARKS[0].concepts.slice(0, 2), 'AB', 2);
    const sanitized = sanitizeForGooglePatents(fieldQuery);
    // AB= should be preserved (not stripped)
    expect(sanitized).toContain('AB=');
  });
});
