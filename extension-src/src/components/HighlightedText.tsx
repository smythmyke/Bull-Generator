import React from 'react';

interface HighlightedTextProps {
  text: string;
  queryTerms: string[];
  snippetQuotes?: string[];
  className?: string;
  maxLength?: number;
}

type AnnotationType = 'none' | 'query' | 'snippet';

const HighlightedText: React.FC<HighlightedTextProps> = ({
  text,
  queryTerms,
  snippetQuotes,
  className = '',
  maxLength,
}) => {
  if (!text) return null;

  const displayText = maxLength && text.length > maxLength
    ? text.substring(0, maxLength) + '...'
    : text;

  // If no terms to highlight, return plain text
  if ((!queryTerms || queryTerms.length === 0) && (!snippetQuotes || snippetQuotes.length === 0)) {
    return <span className={className}>{displayText}</span>;
  }

  // Build character-level annotation array
  const annotations: AnnotationType[] = new Array(displayText.length).fill('none');

  // Mark snippet ranges first (amber) — lower priority, gets overwritten by query
  if (snippetQuotes && snippetQuotes.length > 0) {
    for (const quote of snippetQuotes) {
      if (!quote || quote.length < 5) continue;
      const lowerText = displayText.toLowerCase();
      const lowerQuote = quote.toLowerCase();
      let searchFrom = 0;
      while (searchFrom < lowerText.length) {
        const idx = lowerText.indexOf(lowerQuote, searchFrom);
        if (idx === -1) break;
        for (let i = idx; i < idx + quote.length && i < displayText.length; i++) {
          annotations[i] = 'snippet';
        }
        searchFrom = idx + 1;
      }
    }
  }

  // Mark query term ranges (blue) — higher priority, overwrites snippet marks
  if (queryTerms && queryTerms.length > 0) {
    // Sort by length descending so longer terms take priority
    const sortedTerms = [...queryTerms].sort((a, b) => b.length - a.length);
    for (const term of sortedTerms) {
      if (!term || term.length < 2) continue;
      // Escape regex special chars
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      try {
        const regex = new RegExp(`\\b${escaped}`, 'gi');
        let match: RegExpExecArray | null;
        while ((match = regex.exec(displayText)) !== null) {
          for (let i = match.index; i < match.index + match[0].length && i < displayText.length; i++) {
            annotations[i] = 'query';
          }
        }
      } catch {
        // Skip invalid regex patterns
      }
    }
  }

  // Group consecutive same-type characters into spans
  const spans: { type: AnnotationType; text: string }[] = [];
  let currentType = annotations[0];
  let currentStart = 0;

  for (let i = 1; i <= displayText.length; i++) {
    const type = i < displayText.length ? annotations[i] : 'none';
    if (type !== currentType || i === displayText.length) {
      spans.push({
        type: currentType,
        text: displayText.substring(currentStart, i),
      });
      currentType = type;
      currentStart = i;
    }
  }

  return (
    <span className={className}>
      {spans.map((span, i) => {
        if (span.type === 'query') {
          return (
            <mark key={i} className="bg-blue-100 text-blue-900 rounded-sm px-0.5">
              {span.text}
            </mark>
          );
        }
        if (span.type === 'snippet') {
          return (
            <mark key={i} className="bg-amber-100 text-amber-900 rounded-sm px-0.5">
              {span.text}
            </mark>
          );
        }
        return <span key={i}>{span.text}</span>;
      })}
    </span>
  );
};

export default HighlightedText;
