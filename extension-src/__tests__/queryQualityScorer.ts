/**
 * Query Quality Scorer
 *
 * Evaluates generated patent search queries against quality metrics
 * without hitting a live search engine. Scores:
 *
 *  - syntax:     Is the query well-formed for Google Patents?
 *  - coverage:   What fraction of input concepts appear in the query?
 *  - specificity: How focused is the query (penalizes over-broad wildcards)?
 *  - balance:    Are AND groups roughly equal in OR-term count?
 */

export interface QueryScore {
  /** 0-1: syntactically valid for Google Patents */
  syntax: number;
  /** 0-1: fraction of concept names present in query */
  coverage: number;
  /** 0-1: higher = more specific (fewer broad wildcards, more quoted phrases) */
  specificity: number;
  /** 0-1: AND groups have similar term counts */
  balance: number;
  /** Weighted composite 0-1 */
  overall: number;
  /** Human-readable issues found */
  issues: string[];
}

const WEIGHTS = { syntax: 0.3, coverage: 0.3, specificity: 0.2, balance: 0.2 };

// ── Syntax checks ──

function scoreSyntax(query: string): { score: number; issues: string[] } {
  const issues: string[] = [];
  let deductions = 0;

  // Balanced parentheses
  let depth = 0;
  for (const ch of query) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (depth < 0) break;
  }
  if (depth !== 0) {
    issues.push(`Unbalanced parentheses (depth=${depth})`);
    deductions += 0.4;
  }

  // Balanced quotes
  const quoteCount = (query.match(/"/g) || []).length;
  if (quoteCount % 2 !== 0) {
    issues.push(`Unbalanced quotes (${quoteCount} found)`);
    deductions += 0.3;
  }

  // Double operators: AND AND, OR OR, AND OR, OR AND
  if (/\b(AND\s+AND|OR\s+OR)\b/i.test(query)) {
    issues.push('Doubled operator (AND AND or OR OR)');
    deductions += 0.3;
  }

  // Leading/trailing operators
  if (/^\s*(AND|OR)\b/i.test(query)) {
    issues.push('Query starts with an operator');
    deductions += 0.2;
  }
  if (/\b(AND|OR)\s*$/i.test(query)) {
    issues.push('Query ends with an operator');
    deductions += 0.2;
  }

  // Empty groups: ()
  if (/\(\s*\)/.test(query)) {
    issues.push('Empty parenthesized group');
    deductions += 0.2;
  }

  // Google Patents empirical limit: 5+ AND groups work (tested March 2026)
  const andGroups = splitTopLevelAnd(query).length;
  if (andGroups > 5) {
    issues.push(`May exceed Google Patents limit: ${andGroups} AND groups (5 tested safe)`);
    deductions += 0.3;
  }

  // Empirically: 8 OR terms per group, 20+ total works fine
  const orCount = (query.match(/\sOR\s/gi) || []).length;
  if (orCount > 20) {
    issues.push(`High OR count: ${orCount} OR operators (20 tested safe)`);
    deductions += 0.2;
  }

  // Orbit-only syntax that should have been stripped
  if (/\b(FT|TAC|CA)\s*=/i.test(query)) {
    issues.push('Contains Orbit-only field prefix (should be stripped)');
    deductions += 0.4;
  }
  // Note: TI=, AB=, CL=, NEAR/N, ADJ/N, WITH, SAME are valid Google Patents syntax

  return { score: Math.max(0, 1 - deductions), issues };
}

// ── Coverage: what fraction of concepts survive into the query ──

function scoreCoverage(query: string, conceptNames: string[]): { score: number; issues: string[] } {
  if (conceptNames.length === 0) return { score: 1, issues: [] };

  const qLower = query.toLowerCase();
  const issues: string[] = [];
  let found = 0;

  for (const name of conceptNames) {
    // Check if any significant word (4+ chars) from the concept name appears
    const words = name.toLowerCase().split(/\s+/).filter(w => w.length >= 4);
    const stem = (w: string) => w.replace(/(?:ing|tion|ment|able|ible|ness|ed|er|ly|s)$/, '');

    const matched = words.some(w => {
      // Direct match or wildcard-truncated match
      return qLower.includes(w) || qLower.includes(stem(w));
    });

    if (matched) {
      found++;
    } else {
      issues.push(`Concept "${name}" not represented in query`);
    }
  }

  return { score: found / conceptNames.length, issues };
}

// ── Specificity: penalize over-broad wildcards ──

function scoreSpecificity(query: string): { score: number; issues: string[] } {
  const issues: string[] = [];
  let deductions = 0;

  // Find all truncated terms ($ = multi-char, * = single-char in Google Patents)
  const truncatedTerms = query.match(/\b\w+[$*]/g) || [];
  const shortTruncations = truncatedTerms.filter(t => t.replace(/[$*]/g, '').length <= 3);

  if (shortTruncations.length > 0) {
    issues.push(`Short truncation stems (3 chars or less): ${shortTruncations.join(', ')} — very broad matches`);
    deductions += 0.15 * shortTruncations.length;
  }

  // Common over-broad truncations that match thousands of irrelevant patents
  const dangerousTruncations = ['comp$', 'proc$', 'syst$', 'meth$', 'devi$', 'sign$', 'cont$',
                                 'comp*', 'proc*', 'syst*', 'meth*', 'devi*', 'sign*', 'cont*'];
  for (const dw of dangerousTruncations) {
    if (query.toLowerCase().includes(dw)) {
      issues.push(`Dangerous broad truncation: "${dw}" matches too many irrelevant patents`);
      deductions += 0.1;
    }
  }

  // Reward quoted multi-word phrases (more specific)
  const quotedPhrases = query.match(/"[^"]+"/g) || [];
  const bonus = Math.min(0.2, quotedPhrases.length * 0.05);

  return { score: Math.max(0, Math.min(1, 1 - deductions + bonus)), issues };
}

// ── Balance: AND groups should have similar term counts ──

function scoreBalance(query: string): { score: number; issues: string[] } {
  const issues: string[] = [];
  const groups = splitTopLevelAnd(query);

  if (groups.length <= 1) return { score: 1, issues: [] };

  const termCounts = groups.map(g => {
    const orTerms = g.split(/\s+OR\s+/i);
    return orTerms.length;
  });

  const max = Math.max(...termCounts);
  const min = Math.min(...termCounts);

  if (max === 0) return { score: 1, issues: [] };

  const ratio = min / max;

  if (ratio < 0.3) {
    issues.push(`Imbalanced groups: term counts [${termCounts.join(', ')}] — smallest group may be too restrictive`);
  }

  return { score: ratio, issues };
}

// ── Helpers ──

/** Split query on top-level AND (not inside parentheses) */
function splitTopLevelAnd(query: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';

  // Tokenize roughly
  const tokens = query.split(/(\s+AND\s+)/i);

  for (const token of tokens) {
    if (/^\s+AND\s+$/i.test(token) && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      for (const ch of token) {
        if (ch === '(') depth++;
        if (ch === ')') depth--;
      }
      current += token;
    }
  }
  if (current.trim()) parts.push(current.trim());

  // Filter out CPC-only parts
  return parts.filter(p => !/^cpc=/i.test(p.trim()));
}

// ── Main scorer ──

export function scoreQuery(query: string, conceptNames: string[] = []): QueryScore {
  const { score: syntax, issues: syntaxIssues } = scoreSyntax(query);
  const { score: coverage, issues: coverageIssues } = scoreCoverage(query, conceptNames);
  const { score: specificity, issues: specificityIssues } = scoreSpecificity(query);
  const { score: balance, issues: balanceIssues } = scoreBalance(query);

  const overall =
    WEIGHTS.syntax * syntax +
    WEIGHTS.coverage * coverage +
    WEIGHTS.specificity * specificity +
    WEIGHTS.balance * balance;

  return {
    syntax,
    coverage,
    specificity,
    balance,
    overall,
    issues: [...syntaxIssues, ...coverageIssues, ...specificityIssues, ...balanceIssues],
  };
}

/**
 * Compare a query before and after enforceGooglePatentsLimits.
 * Returns which terms were dropped during enforcement.
 */
export function diffEnforcedQuery(
  before: string,
  after: string
): { kept: string[]; dropped: string[] } {
  const extractTerms = (q: string): Set<string> => {
    const terms = new Set<string>();
    // Extract quoted phrases
    for (const m of q.matchAll(/"([^"]+)"/g)) terms.add(m[1].toLowerCase());
    // Extract single words (non-operator, non-paren)
    for (const m of q.matchAll(/\b([a-z][a-z0-9$*]{2,})\b/gi)) {
      const w = m[1].toLowerCase();
      if (!['and', 'or', 'cpc'].includes(w.replace(/[$*]/g, ''))) terms.add(w);
    }
    return terms;
  };

  const beforeTerms = extractTerms(before);
  const afterTerms = extractTerms(after);

  const kept: string[] = [];
  const dropped: string[] = [];

  for (const t of beforeTerms) {
    const bare = t.replace(/[$*]/g, '');
    // Check if the term or its truncated variant survived
    if (afterTerms.has(t) || afterTerms.has(bare + '$') || afterTerms.has(bare + '*') || afterTerms.has(bare)) {
      kept.push(t);
    } else {
      dropped.push(t);
    }
  }

  return { kept, dropped };
}
