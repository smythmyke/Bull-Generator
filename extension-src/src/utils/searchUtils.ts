// Word type detection for patent search terms
export type WordType = 'verb' | 'noun' | 'adjective' | 'unknown';

export function detectWordType(word: string): WordType {
  const lowerWord = word.toLowerCase();
  // Simple heuristic based on common suffixes
  if (lowerWord.endsWith('ing') || lowerWord.endsWith('ate') || lowerWord.endsWith('ize') || lowerWord.endsWith('ify')) {
    return 'verb';
  }
  if (lowerWord.endsWith('tion') || lowerWord.endsWith('ment') || lowerWord.endsWith('ness') || lowerWord.endsWith('ity')) {
    return 'noun';
  }
  if (lowerWord.endsWith('able') || lowerWord.endsWith('ible') || lowerWord.endsWith('ous') || lowerWord.endsWith('ive')) {
    return 'adjective';
  }
  return 'unknown';
}

// Generate word variations (truncated forms) for patent searching
export function getWordVariations(word: string): string[] {
  const variations: string[] = [word];
  const lowerWord = word.toLowerCase();

  // Common suffixes to strip for truncation
  const suffixes = ['ing', 'tion', 'sion', 'ment', 'ness', 'able', 'ible', 'ous', 'ive', 'ed', 'er', 'est', 'ly', 's', 'es'];
  for (const suffix of suffixes) {
    if (lowerWord.endsWith(suffix) && lowerWord.length - suffix.length >= 3) {
      variations.push(lowerWord.slice(0, -suffix.length));
    }
  }

  return [...new Set(variations)];
}

// Get the root/stem of a word
export function getRootWord(word: string): string {
  const lowerWord = word.toLowerCase();
  const suffixes = ['ation', 'tion', 'sion', 'ing', 'ment', 'ness', 'able', 'ible', 'ous', 'ive', 'ed', 'er', 'est', 'ly', 'es', 's'];

  for (const suffix of suffixes) {
    if (lowerWord.endsWith(suffix) && lowerWord.length - suffix.length >= 3) {
      return lowerWord.slice(0, -suffix.length);
    }
  }

  return lowerWord;
}

// Optimize search string based on mode
export function optimizeSearch(search: string, mode: 'broad' | 'moderate' | 'narrow'): string {
  let optimized = search;

  // Remove duplicate terms within groups
  optimized = optimized.replace(/\(([^)]+)\)/g, (match, group) => {
    const terms = group.split(/\s+(?:OR|NEAR\/\d+)\s+/);
    const uniqueTerms = [...new Set(terms.map((t: string) => t.trim()).filter((t: string) => t))];
    const operator = mode === 'narrow' ? ' NEAR/3 ' : ' OR ';
    return `(${uniqueTerms.join(operator)})`;
  });

  // Remove empty groups
  optimized = optimized.replace(/\(\s*\)/g, '');

  // Clean up extra whitespace
  optimized = optimized.replace(/\s+/g, ' ').trim();

  return optimized;
}

// Validate search string for a given system
export function validateSearch(
  search: string,
  system: string,
  proximity: string,
  setErrors: React.Dispatch<React.SetStateAction<string[]>>
): boolean {
  const errors: string[] = [];

  if (!search || search.trim().length === 0) {
    errors.push('Search string is empty');
    setErrors(errors);
    return false;
  }

  // Check for balanced parentheses
  let depth = 0;
  for (const char of search) {
    if (char === '(') depth++;
    if (char === ')') depth--;
    if (depth < 0) {
      errors.push('Unbalanced parentheses: extra closing parenthesis');
      break;
    }
  }
  if (depth > 0) {
    errors.push('Unbalanced parentheses: missing closing parenthesis');
  }

  // Check for empty groups
  if (/\(\s*\)/.test(search)) {
    errors.push('Search contains empty groups');
  }

  if (errors.length > 0) {
    setErrors(errors);
    return false;
  }

  setErrors([]);
  return true;
}
