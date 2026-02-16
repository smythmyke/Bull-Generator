import React from 'react';

interface SearchResultProps {
  result: string;
}

function highlightSyntax(text: string): string {
  let highlighted = text;

  // Highlight field prefixes (FT=, TAC=, TI=, AB=, CL=)
  highlighted = highlighted.replace(
    /\b(FT|TAC|TI|AB|CL)=/g,
    '<span class="search-field-prefix">$1=</span>'
  );

  // Highlight operators (AND, OR)
  highlighted = highlighted.replace(
    /\b(AND|OR)\b/g,
    '<span class="search-operator">$1</span>'
  );

  // Highlight proximity operators (2D, 3D, 5D, NEAR/3, etc.)
  highlighted = highlighted.replace(
    /\b(\d+D|NEAR\/\d+)\b/g,
    '<span class="search-proximity">$1</span>'
  );

  // Highlight CC= country codes
  highlighted = highlighted.replace(
    /\b(CC)=([A-Z]{2})\b/g,
    '<span class="search-field-prefix">$1=$2</span>'
  );

  return highlighted;
}

export const SearchResult: React.FC<SearchResultProps> = ({ result }) => {
  return (
    <p
      className="mt-1 font-mono text-xs break-all leading-relaxed"
      dangerouslySetInnerHTML={{ __html: highlightSyntax(result) }}
    />
  );
};
