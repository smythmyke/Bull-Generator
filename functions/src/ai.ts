import {GoogleGenerativeAI} from "@google/generative-ai";

// Get API key from environment (.env file deployed with functions)
function getApiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error("GEMINI_API_KEY not configured");
  }
  return key;
}

let genAI: GoogleGenerativeAI | null = null;

function getGenAI(): GoogleGenerativeAI {
  if (!genAI) {
    genAI = new GoogleGenerativeAI(getApiKey());
  }
  return genAI;
}

function getModel() {
  return getGenAI().getGenerativeModel({model: "gemini-2.0-flash"});
}

// ── Generate Search Strings ──

const SEARCH_SYSTEM_PROMPT = `You are a patent search expert that outputs search strings in JSON format.
Your response must be valid JSON matching this structure:

{
  "broad": "string - the broad search string",
  "moderate": "string - the moderate search string",
  "narrow": "string - the narrow search string",
  "terms": [
    {
      "term": "string - the original word",
      "synonyms": ["array of synonym strings"]
    }
  ]
}

Follow these exact rules when generating search strings:

1. SYNONYM GENERATION RULES:
   - Keep each concept's synonyms in separate parentheses
   - Use OR between synonyms within a group
   - Use truncation (*) for word variations (min 3 chars)
   - Never mix different concepts in the same group

2. SEARCH STRING FORMATS:

   BROAD:
   - Start with FT=
   - Use 3-4 synonyms per group
   - Connect groups with AND
   Example: FT=((burst* OR break* OR ruptur* OR split*) AND (head* OR tip* OR tool* OR device*))

   MODERATE:
   - Start with TAC=
   - Use 3-5 synonyms per group
   - Connect groups with AND
   Example: TAC=((burst* OR break* OR ruptur* OR split* OR fractur*) AND (head* OR tip* OR tool* OR device* OR implement*))

   NARROW:
   - Start with TAC=
   - Use exactly 3 synonyms per group
   - Pair related groups with 2D
   Example: TAC=((burst* OR break* OR split*) 2D (head* OR tip* OR tool*))

3. GOOGLE PATENTS FORMAT (when searchSystem is "google-patents"):
   - Do NOT use truncation wildcards (no *)
   - Use full words and quoted phrases for multi-word fixed terms (e.g., "lithium ion")
   - Use AND/OR operators
   - Proximity operators (NEAR/x, ADJ/x, WITH, SAME) are available for MODERATE and NARROW. These affect result ranking (boosting patents where terms appear close together) but do not filter results out.

   BROAD (Google Patents):
   - Use 3-4 synonyms per group
   - Connect ALL groups with AND only — no proximity operators
   - Do NOT use field prefixes
   Example: (burst OR break OR rupture OR split) AND (head OR tip OR tool OR device)

   MODERATE (Google Patents):
   - Use 3-5 synonyms per group
   - Choose the connector between each pair of concept groups based on their relationship:
     * Compound phrases where word order matters (e.g., "wireless" + "charging") → use ADJ/5
     * Closely related concepts where order is flexible (e.g., "corrosion" + "resistance") → use NEAR/10
     * Related concepts that co-occur in discussion (e.g., "battery" + "thermal management") → use WITH
     * Independent concepts from different domains → use AND
   - Do NOT use field prefixes in moderate
   Example: ("burst" OR "break" OR "rupture" OR "fracture") NEAR/10 ("drill" OR "tip" OR "tool" OR "bit") AND ("underground" OR "subterranean" OR "wellbore")

   NARROW (Google Patents):
   - Use exactly 3 synonyms per group
   - Use tighter proximity than moderate:
     * Compound phrases where word order matters → use ADJ/3
     * Closely related concepts → use NEAR/5
     * Related concepts in same discussion → use NEAR/10 or WITH
     * Independent concepts → use AND
   - Optionally wrap the single most important inventive concept group in CL=() to boost patents where it appears in claims. Only do this for the core novelty, not for supporting/contextual terms.
   Example: CL=("burst" OR "fracture" OR "rupture") ADJ/3 ("drill bit" OR "tool tip" OR "cutting head") AND ("wellbore" OR "downhole")

Key Points:
- Keep each concept's synonyms in separate parentheses
- Use OR between synonyms within a group
- Use appropriate operators between groups
- Always return valid JSON`;

async function generateSearch(
  body: { words: string[]; searchSystem?: string }
): Promise<object> {
  const {words, searchSystem = "orbit"} = body;

  if (!words || !Array.isArray(words) || words.length === 0) {
    throw new Error("words array is required");
  }

  const wordList = words.slice(0, 8).join(", ");
  const systemSuffix = searchSystem === "google-patents" ?
    "\n\nIMPORTANT: Generate search strings in GOOGLE PATENTS FORMAT " +
    "(no field prefixes, no wildcards, no proximity operators, " +
    "use quoted phrases)." : "";

  const model = getModel();
  const result = await model.generateContent({
    contents: [{
      role: "user",
      parts: [{
        text: `${SEARCH_SYSTEM_PROMPT}${systemSuffix}

Generate a JSON response containing patent search strings for these words: [${wordList}].
Follow the schema exactly. Return ONLY valid JSON, no markdown.`,
      }],
    }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 1000,
      responseMimeType: "application/json",
    },
  });

  const content = result.response.text();
  if (!content) {
    throw new Error("Empty response from Gemini API");
  }

  return JSON.parse(content);
}

// ── Synonym Lookup ──

const SYNONYM_PROMPT = `You are a technical thesaurus expert. For each input word, generate exactly 6 technical synonyms that would be relevant in patent searches.

Return your response in this exact JSON format:
{
  "word": "input_word",
  "synonyms": ["synonym1", "synonym2", "synonym3", "synonym4", "synonym5", "synonym6"]
}

Keep synonyms technical and relevant to patent searching. Always return exactly 6 synonyms.
Return ONLY valid JSON, no markdown.`;

async function getSynonyms(body: { word: string }): Promise<object> {
  const {word} = body;

  if (!word || typeof word !== "string") {
    throw new Error("word string is required");
  }

  const model = getModel();
  const result = await model.generateContent({
    contents: [{
      role: "user",
      parts: [{
        text: `${SYNONYM_PROMPT}

Generate technical synonyms for: ${word}`,
      }],
    }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 500,
      responseMimeType: "application/json",
    },
  });

  const content = result.response.text();
  if (!content) {
    throw new Error("Empty response from Gemini API");
  }

  return JSON.parse(content);
}

// ── Definition Lookup ──

const DEFINITION_PROMPT = `You are a technical dictionary that provides clear, concise definitions for technical terms.
When given a word or phrase, provide its technical definition in a JSON format.

Example response format:
{
  "word": "pneumatic",
  "definition": "Operated by or using pressurized air or gas."
}

Keep definitions technical and focused on engineering/scientific context when applicable.
Return ONLY valid JSON, no markdown.`;

async function getDefinition(body: { word: string }): Promise<object> {
  const {word} = body;

  if (!word || typeof word !== "string") {
    throw new Error("word string is required");
  }

  const model = getModel();
  const result = await model.generateContent({
    contents: [{
      role: "user",
      parts: [{
        text: `${DEFINITION_PROMPT}

Define this term: ${word}`,
      }],
    }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 300,
      responseMimeType: "application/json",
    },
  });

  const content = result.response.text();
  if (!content) {
    throw new Error("Empty response from Gemini API");
  }

  return JSON.parse(content);
}

// ── Paragraph Analysis ──

const ANALYZE_PROMPT = `You are a patent search expert that analyzes paragraphs to identify key technical concepts and generate comprehensive search strings. Your response must be valid JSON with this structure:

{
  "search": "The generated search string",
  "concepts": ["List of identified key concepts"],
  "terms": ["List of search terms with their synonyms"]
}

Follow these strict rules when analyzing paragraphs:

1. CONCEPT IDENTIFICATION:
   - Identify distinct technical components and concepts
   - Keep each concept separate and avoid mixing different concepts
   - Identify key actions and processes as separate concepts
   - Identify technical parameters as separate concepts

2. SEARCH STRING GENERATION RULES:
   - Start with FT=
   - Each concept gets its own set of parentheses with synonyms
   - Connect concepts with AND operators
   - Use 5D proximity operator between related concepts
   - Use truncation (*) for word variations (min 3 chars)
   - DO NOT include country codes (CC=US)

3. SYNONYM GROUPING RULES:
   - Each concept's synonyms go in their own parentheses
   - Connect synonyms with OR operators
   - Never mix different concepts within the same parentheses
   - Use at least 4 synonyms of a word within a group (if possible)

4. GOOGLE PATENTS FORMAT (when specified):
   - Do NOT use field prefixes (no FT=)
   - Do NOT use truncation wildcards (no *)
   - Use full words and quoted phrases
   - Use AND/OR operators only
   - No proximity operators (no 5D, no NEAR)

Return ONLY valid JSON, no markdown.`;

async function analyzeParagraph(
  body: { paragraph: string; searchSystem?: string }
): Promise<object> {
  const {paragraph, searchSystem = "orbit"} = body;

  if (!paragraph || typeof paragraph !== "string") {
    throw new Error("paragraph string is required");
  }

  const systemSuffix = searchSystem === "google-patents" ?
    "\n\nIMPORTANT: Generate search string in GOOGLE PATENTS FORMAT " +
    "(no field prefixes, no wildcards, no proximity operators)." : "";

  const model = getModel();
  const result = await model.generateContent({
    contents: [{
      role: "user",
      parts: [{
        text: `${ANALYZE_PROMPT}${systemSuffix}

Analyze this paragraph and generate a comprehensive patent search string. Keep each concept's synonyms in separate parentheses and connect different concepts with AND: "${paragraph}"`,
      }],
    }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 1000,
      responseMimeType: "application/json",
    },
  });

  const content = result.response.text();
  if (!content) {
    throw new Error("Empty response from Gemini API");
  }

  return JSON.parse(content);
}

// ── Optimize Query for Google Patents ──

const OPTIMIZE_QUERY_PROMPT = `You are a patent search expert who specializes in Google Patents.

Given a user's natural language description of what they're searching for, generate an optimized search query for Google Patents.

Rules:
- Use technical patent terminology and jargon
- Add key synonyms and alternate phrasings a patent examiner would use
- Use quoted phrases for multi-word concepts
- Use AND/OR operators
- Keep the query focused — don't add unrelated concepts
- Include relevant CPC class hints if obvious (e.g., H01M for batteries)
- Maximum ~150 words for the query
- Do NOT use field prefixes, truncation wildcards, or proximity operators

Return JSON matching this schema:
{
  "optimizedQuery": "the optimized search string",
  "reasoning": "1 sentence explaining your optimization strategy"
}

Return ONLY valid JSON, no markdown.`;

async function optimizeQuery(
  body: { text: string }
): Promise<object> {
  const {text} = body;

  if (!text || typeof text !== "string") {
    throw new Error("text string is required");
  }

  const model = getModel();
  const result = await model.generateContent({
    contents: [{
      role: "user",
      parts: [{
        text: `${OPTIMIZE_QUERY_PROMPT}

User's search description: "${text}"`,
      }],
    }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 500,
      responseMimeType: "application/json",
    },
  });

  const content = result.response.text();
  if (!content) {
    throw new Error("Empty response from Gemini API");
  }

  let parsed = JSON.parse(content);

  // Gemini sometimes wraps the response in an array — unwrap it
  if (Array.isArray(parsed)) {
    parsed = parsed[0] || {};
  }
  // Gemini sometimes double-stringifies — parse again if needed
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
      if (Array.isArray(parsed)) parsed = parsed[0] || {};
    } catch {
      // not valid JSON string, leave as-is
    }
  }

  console.log("optimize-query parsed keys:", Object.keys(parsed),
    "preview:", JSON.stringify(parsed).substring(0, 300));

  const reasoning = parsed.reasoning ||
    parsed.explanation ||
    parsed.strategy ||
    parsed.rationale || "";

  // Normalize: Gemini sometimes uses different key names
  let optimizedQuery = parsed.optimizedQuery ||
    parsed.optimized_query ||
    parsed.query ||
    parsed.search_query ||
    parsed.searchQuery ||
    parsed.search ||
    parsed.result ||
    parsed.optimized || "";

  // Last resort: grab the first string value that looks like a search query
  if (!optimizedQuery) {
    for (const val of Object.values(parsed)) {
      if (typeof val === "string" && val.length > 10 && val !== reasoning) {
        optimizedQuery = val;
        break;
      }
    }
  }

  return {optimizedQuery, reasoning};
}

// ── Patent Ranking ──

interface PatentForRanking {
  patentId: string;
  patentNumber: string;
  title: string;
  assignee: string;
  abstract: string;
  fullAbstract: string;
  cpcCodes: string[];
  firstClaim: string;
  foundBy?: string[];
  // NPL-specific fields (optional)
  citationCount?: number;
  venue?: string;
}

interface Snippet {
  source: string;
  quote: string;
  relevance: string;
}

interface RankedPatent {
  patentId: string;
  rank: number;
  score: number;
  reasoning: string;
  snippets: Snippet[];
}

const RANK_PROMPT = `You are a patent relevance expert. Given a search query and a list of patents, rank them by relevance to the query.

For each patent, provide:
- "score": 1-100 (100 = perfectly relevant)
- "reasoning": 1 sentence explaining the overall relevance
- "snippets": 1-2 direct quotes from the patent's abstract or claims that prove relevance. Each snippet must have:
  - "source": either "abstract" or "claim" (where the quote comes from)
  - "quote": the EXACT text copied from the patent (10-40 words, must be a real substring from the provided text)
  - "relevance": 1 short sentence explaining why this quote matters

Return JSON matching this schema exactly:
{
  "ranked": [
    {
      "patentId": "string",
      "rank": 1,
      "score": 95,
      "reasoning": "string",
      "snippets": [
        {
          "source": "abstract",
          "quote": "exact text from the patent abstract...",
          "relevance": "why this proves relevance"
        }
      ]
    }
  ]
}

Ranking criteria (in order of importance):
1. Title and abstract directly address the search query concepts
2. Claims cover the query's technical scope (patents) or content directly addresses the topic (NPL)
3. CPC codes align with the technology domain (patents only)
4. Specificity - results focused on the exact topic rank higher than broad/tangential ones
5. Multi-source signal - results found by multiple independent searches are more likely relevant (noted as "Found by: ..." in the listing). Give a moderate boost (+5-10 points) to results found by 2+ searches.
6. For non-patent literature (NPL): citation count is a strong relevance signal. Papers with 50+ citations are well-established in the field. Papers with 200+ citations are seminal works. Include citation count in your reasoning if notable.

IMPORTANT for snippets:
- Quotes MUST be real substrings from the Abstract or Claim 1 text provided (or from the NPL snippet/abstract)
- Do NOT fabricate or paraphrase — copy exact text
- If no relevant quote exists, return an empty snippets array
- Prefer quotes that contain key terms matching the search query

The list may include both patents AND non-patent literature (NPL). NPL items are marked with "Type: NPL" and may include citation count and venue. Rank them on equal footing based on relevance.

Return ALL results ranked from most to least relevant. Return ONLY valid JSON, no markdown.`;

async function rankPatents(
  body: { query: string; patents: PatentForRanking[] }
): Promise<object> {
  const {query, patents} = body;

  if (!query || typeof query !== "string") {
    throw new Error("query string is required");
  }
  if (!patents || !Array.isArray(patents) || patents.length === 0) {
    throw new Error("patents array is required");
  }

  // Build a compact representation for the prompt
  const patentSummaries = patents.map((p, i) => {
    const isNPL = p.patentId?.startsWith("scholar/") ||
      p.patentId?.startsWith("scholar-") ||
      p.citationCount !== undefined;

    const parts = [
      `[${i + 1}] ID: ${p.patentId}`,
      `Title: ${p.title}`,
    ];

    if (isNPL) {
      parts.push("Type: NPL (non-patent literature)");
      if (p.assignee) parts.push(`Source: ${p.assignee}`);
      if (p.citationCount !== undefined && p.citationCount !== null) {
        parts.push(`Citation count: ${p.citationCount}`);
      }
      if (p.venue) parts.push(`Venue: ${p.venue}`);
    } else {
      parts.push(`Assignee: ${p.assignee || "Unknown"}`);
    }

    if (p.foundBy && p.foundBy.length > 0) {
      parts.push(`Found by: ${p.foundBy.join(", ")} (${p.foundBy.length} searches)`);
    }
    const abs = p.fullAbstract || p.abstract || "";
    if (abs) parts.push(`Abstract: ${abs.substring(0, 500)}`);
    if (p.cpcCodes?.length > 0) parts.push(`CPC: ${p.cpcCodes.join(", ")}`);
    if (p.firstClaim) {
      parts.push(`Claim 1: ${p.firstClaim.substring(0, 400)}`);
    }
    return parts.join("\n");
  }).join("\n\n");

  const model = getModel();
  const result = await model.generateContent({
    contents: [{
      role: "user",
      parts: [{
        text: `${RANK_PROMPT}

Search query: "${query}"

Patents to rank (${patents.length} total):

${patentSummaries}`,
      }],
    }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 8000,
      responseMimeType: "application/json",
    },
  });

  const content = result.response.text();
  if (!content) {
    throw new Error("Empty response from Gemini API");
  }

  const parsed = JSON.parse(content) as { ranked: RankedPatent[] };

  // Ensure ranks are sequential
  parsed.ranked.forEach((item: RankedPatent, idx: number) => {
    item.rank = idx + 1;
  });

  return parsed;
}

// ── Enrich NPL via Semantic Scholar + CrossRef ──

interface NPLItem {
  patentId: string;
  title: string;
  doi?: string;
}

interface EnrichedNPLItem {
  patentId: string;
  fullAbstract: string;
  citationCount: number;
  venue: string;
  doi: string;
  fieldsOfStudy: string[];
  enrichedVia: string;
}

const SS_FIELDS = "abstract,citationCount,venue,year,externalIds,fieldsOfStudy";

async function lookupSemanticScholar(
  item: NPLItem
): Promise<EnrichedNPLItem | null> {
  try {
    // Try DOI lookup first (exact match)
    if (item.doi) {
      const url = `https://api.semanticscholar.org/graph/v1/paper/DOI:${item.doi}?fields=${SS_FIELDS}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (data.abstract) {
          return {
            patentId: item.patentId,
            fullAbstract: data.abstract || "",
            citationCount: data.citationCount || 0,
            venue: data.venue || "",
            doi: item.doi,
            fieldsOfStudy: (data.fieldsOfStudy || []).map(
              (f: { category: string }) => f.category
            ),
            enrichedVia: "semantic-scholar-doi",
          };
        }
      }
    }

    // Fall back to title search
    const encoded = encodeURIComponent(item.title);
    const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encoded}&limit=1&fields=${SS_FIELDS}`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      if (data.data && data.data.length > 0) {
        const paper = data.data[0];
        if (paper.abstract) {
          const exDoi = paper.externalIds?.DOI || item.doi || "";
          return {
            patentId: item.patentId,
            fullAbstract: paper.abstract || "",
            citationCount: paper.citationCount || 0,
            venue: paper.venue || "",
            doi: exDoi,
            fieldsOfStudy: (paper.fieldsOfStudy || []).map(
              (f: { category: string }) => f.category
            ),
            enrichedVia: "semantic-scholar-title",
          };
        }
      }
    }
  } catch (err) {
    console.warn(`Semantic Scholar lookup failed for "${item.title}":`, err);
  }
  return null;
}

async function lookupCrossRef(
  item: NPLItem
): Promise<EnrichedNPLItem | null> {
  try {
    // Try DOI lookup first
    if (item.doi) {
      const url = `https://api.crossref.org/works/${encodeURIComponent(item.doi)}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        const work = data.message;
        if (work) {
          const abstract = work.abstract
            ? work.abstract.replace(/<[^>]*>/g, "").trim()
            : "";
          return {
            patentId: item.patentId,
            fullAbstract: abstract,
            citationCount: work["is-referenced-by-count"] || 0,
            venue: work["container-title"]?.[0] || "",
            doi: item.doi,
            fieldsOfStudy: (work.subject || []).slice(0, 5),
            enrichedVia: "crossref-doi",
          };
        }
      }
    }

    // Fall back to title search
    const encoded = encodeURIComponent(item.title);
    const url =
      `https://api.crossref.org/works?query.bibliographic=${encoded}&rows=1`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      const items = data.message?.items;
      if (items && items.length > 0) {
        const work = items[0];
        const abstract = work.abstract
          ? work.abstract.replace(/<[^>]*>/g, "").trim()
          : "";
        if (abstract) {
          return {
            patentId: item.patentId,
            fullAbstract: abstract,
            citationCount: work["is-referenced-by-count"] || 0,
            venue: work["container-title"]?.[0] || "",
            doi: work.DOI || item.doi || "",
            fieldsOfStudy: (work.subject || []).slice(0, 5),
            enrichedVia: "crossref-title",
          };
        }
      }
    }
  } catch (err) {
    console.warn(`CrossRef lookup failed for "${item.title}":`, err);
  }
  return null;
}

async function enrichNPL(
  body: { items: NPLItem[] }
): Promise<object> {
  const {items} = body;
  if (!items || !Array.isArray(items) || items.length === 0) {
    throw new Error("items array is required");
  }

  // Process each item: Semantic Scholar first, CrossRef fallback
  const results: EnrichedNPLItem[] = await Promise.all(
    items.map(async (item) => {
      // Try Semantic Scholar
      const ssResult = await lookupSemanticScholar(item);
      if (ssResult) return ssResult;

      // Try CrossRef
      const crResult = await lookupCrossRef(item);
      if (crResult) return crResult;

      // No enrichment found
      return {
        patentId: item.patentId,
        fullAbstract: "",
        citationCount: 0,
        venue: "",
        doi: item.doi || "",
        fieldsOfStudy: [],
        enrichedVia: "none",
      };
    })
  );

  return {enriched: results};
}

// ── Analyze Round (Pro Search) ──

const ANALYZE_ROUND_PROMPT = `You are a patent search expert analyzing results from a patent search round to help refine the next round.

Given the original search concepts, the original paragraph, and the patents found in this round (with their titles, abstracts, and CPC codes), analyze the results and provide:

1. **CPC Suggestions**: The most frequent/relevant CPC codes from the results, with labels and frequency counts
2. **Terminology Swaps**: Terms the user used vs what patents actually use (e.g., user said "battery" but patents say "electrochemical cell")
3. **Concept Health**: How well each original concept matched — strong (5+ hits), weak (1-4 hits), or missing (0 hits)
4. **Refined Concepts**: Pre-built improved concepts with updated synonyms and relevant CPC codes for the next search round
5. **Top Patent IDs**: The 3 most relevant patent IDs for similarity searching

Return JSON matching this schema exactly:
{
  "cpcSuggestions": [
    { "code": "H02J50", "label": "Wireless power supply", "frequency": 12 }
  ],
  "terminologySwaps": [
    { "userTerm": "battery", "patentTerms": ["electrochemical cell", "energy storage device"], "frequency": 8 }
  ],
  "conceptHealth": [
    { "conceptName": "wireless power", "matchCount": 12, "status": "strong" }
  ],
  "refinedConcepts": [
    { "name": "wireless power transfer", "synonyms": ["inductive coupling", "resonant charging", "contactless power"], "addedCPCCodes": ["H02J50"] }
  ],
  "topPatentIds": ["US10234567B2", "EP3456789A1", "WO2020123456A1"]
}

Rules:
- CPC suggestions: List up to 10 most frequent CPC codes, sorted by frequency descending
- Terminology swaps: Identify 3-8 terms where patent language differs from user language
- Concept health: Report on ALL original concepts
- Refined concepts: Improve each original concept with better synonyms learned from the results
- Top patent IDs: Pick the 3 most relevant patents for similarity expansion (prefer broad, foundational patents)
- Return ONLY valid JSON, no markdown.`;

interface RoundResult {
  patentId: string;
  title: string;
  abstract?: string;
  fullAbstract?: string;
  cpcCodes?: string[];
}

interface AnalyzeRoundBody {
  originalConcepts: { name: string; synonyms: string[] }[];
  roundResults: RoundResult[];
  roundNumber: number;
  originalParagraph: string;
}

async function analyzeRound(body: AnalyzeRoundBody): Promise<object> {
  const {originalConcepts, roundResults, roundNumber, originalParagraph} = body;

  if (!originalConcepts || !Array.isArray(originalConcepts)) {
    throw new Error("originalConcepts array is required");
  }
  if (!roundResults || !Array.isArray(roundResults)) {
    throw new Error("roundResults array is required");
  }
  if (!originalParagraph || typeof originalParagraph !== "string") {
    throw new Error("originalParagraph string is required");
  }

  const conceptsSummary = originalConcepts.map(
    (c) => `- ${c.name}: [${c.synonyms.join(", ")}]`
  ).join("\n");

  const resultsSummary = roundResults.slice(0, 30).map((r, i) => {
    const parts = [`[${i + 1}] ID: ${r.patentId}`, `Title: ${r.title}`];
    const abs = r.fullAbstract || r.abstract || "";
    if (abs) parts.push(`Abstract: ${abs.substring(0, 300)}`);
    if (r.cpcCodes && r.cpcCodes.length > 0) {
      parts.push(`CPC: ${r.cpcCodes.join(", ")}`);
    }
    return parts.join("\n");
  }).join("\n\n");

  const model = getModel();
  const result = await model.generateContent({
    contents: [{
      role: "user",
      parts: [{
        text: `${ANALYZE_ROUND_PROMPT}

Original paragraph: "${originalParagraph}"

Original concepts:
${conceptsSummary}

Round ${roundNumber} results (${roundResults.length} patents):

${resultsSummary}`,
      }],
    }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 4000,
      responseMimeType: "application/json",
    },
  });

  const content = result.response.text();
  if (!content) {
    throw new Error("Empty response from Gemini API");
  }

  let parsed = JSON.parse(content);

  // Gemini sometimes wraps the response in an array — unwrap it
  if (Array.isArray(parsed)) {
    parsed = parsed[0] || {};
  }
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
      if (Array.isArray(parsed)) parsed = parsed[0] || {};
    } catch {
      // not valid JSON string, leave as-is
    }
  }

  return parsed;
}

// ── Generate Searches from Concepts ──

const GENERATE_FROM_CONCEPTS_PROMPT = `You are a patent search expert for Google Patents. Given structured technical concepts (each with a name, synonyms, category, and importance level), generate three search query strings: broad, moderate, and narrow.

Return JSON matching this schema exactly:
{
  "broad": "the broad search string",
  "moderate": "the moderate search string",
  "narrow": "the narrow search string"
}

RULES:

BROAD:
- Include the concept name and ALL provided synonyms in each group
- Use OR between terms within a group, AND between all groups
- Quote multi-word phrases
- No proximity operators, no field prefixes
Example: ("flotation device" OR "buoyancy vest" OR "life vest" OR PFD) AND ("water activated" OR "moisture triggered" OR "automatic inflation")

MODERATE:
- Include the concept name and 3-5 best synonyms per group
- Choose the connector between EACH pair of concept groups based on their semantic relationship:
  * Compound phrases where word order matters (e.g., "wireless" + "charging") → ADJ/5
  * Closely related concepts where order is flexible (e.g., "corrosion" + "resistance") → NEAR/10
  * Related concepts that co-occur in the same discussion (e.g., "battery" + "thermal management") → WITH
  * Independent concepts from different domains (e.g., "vehicle" + "user interface") → AND
- Do NOT use field prefixes in moderate
- Proximity operators affect ranking (boosting relevant results higher), not filtering
Example: ("flotation device" OR "buoyancy vest" OR "life preserver") NEAR/10 ("water activated" OR "moisture triggered" OR "auto-inflating") AND ("pet" OR "canine" OR "domestic animal")

NARROW:
- Include the concept name and 2-3 best synonyms per group
- Use tighter proximity than moderate:
  * Compound phrases where word order matters → ADJ/3
  * Closely related concepts → NEAR/5
  * Related concepts in same discussion → NEAR/10 or WITH
  * Independent concepts → AND
- Only include HIGH importance concepts (skip low importance concepts entirely)
- Optionally wrap the single most important inventive concept group in CL=() to boost claim matches. Only do this for the core novelty, never for contextual or supporting terms.
Example: CL=("flotation device" OR "buoyancy vest") ADJ/3 ("water activated" OR "auto-inflating") NEAR/5 ("pet" OR "canine")

KEY POINTS:
- Quote multi-word phrases (e.g., "drill bit", "lithium ion")
- Single words do not need quotes
- Keep each concept's terms in separate parenthesized groups with OR
- Proximity operators (NEAR/x, ADJ/x, WITH, SAME) only affect ranking, not filtering — they boost patents where terms appear close together
- The relationship between concept pairs determines the operator — analyze each pair independently
- Return ONLY valid JSON, no markdown.`;

interface ConceptInput {
  name: string;
  synonyms: string[];
  category: string;
  importance: string;
  enabled: boolean;
}

async function generateFromConcepts(
  body: { concepts: ConceptInput[] }
): Promise<object> {
  const {concepts} = body;

  if (!concepts || !Array.isArray(concepts) || concepts.length === 0) {
    throw new Error("concepts array is required");
  }

  const enabled = concepts.filter((c) => c.enabled !== false);
  if (enabled.length === 0) {
    throw new Error("at least one enabled concept is required");
  }

  const conceptsSummary = enabled.map((c, i) => {
    return `${i + 1}. "${c.name}" [${c.category}, ${c.importance}]: synonyms = [${c.synonyms.join(", ")}]`;
  }).join("\n");

  const model = getModel();
  const result = await model.generateContent({
    contents: [{
      role: "user",
      parts: [{
        text: `${GENERATE_FROM_CONCEPTS_PROMPT}

Generate broad, moderate, and narrow Google Patents search strings from these concepts:

${conceptsSummary}`,
      }],
    }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 2000,
      responseMimeType: "application/json",
    },
  });

  const content = result.response.text();
  if (!content) {
    throw new Error("Empty response from Gemini API");
  }

  let parsed = JSON.parse(content);

  if (Array.isArray(parsed)) {
    parsed = parsed[0] || {};
  }
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
      if (Array.isArray(parsed)) parsed = parsed[0] || {};
    } catch {
      // leave as-is
    }
  }

  return parsed;
}

// ── Extract Concepts ──

const EXTRACT_CONCEPTS_PROMPT = `You are a patent search expert that analyzes paragraphs to extract structured technical concepts for patent searching.

Given a paragraph describing an invention or technology, extract 4-8 distinct technical concepts. Each concept should represent a separate searchable idea.

Return JSON matching this schema exactly:
{
  "concepts": [
    {
      "name": "concept name",
      "category": "device" | "process" | "material" | "property" | "context",
      "synonyms": ["synonym1", "synonym2", "synonym3", "synonym4"],
      "importance": "high" | "medium" | "low"
    }
  ]
}

Rules:
- Extract 4-8 concepts from the paragraph
- Each concept gets 3-6 synonyms that a patent examiner would use
- Categories: "device" (physical components/apparatus), "process" (methods/steps/actions), "material" (substances/compositions), "property" (characteristics/parameters), "context" (application domain/field of use)
- Importance: "high" (core inventive concept), "medium" (supporting technical feature), "low" (background/contextual)
- Use full words (no truncation wildcards)
- Multi-word concepts are fine (e.g., "wireless charging")
- Synonyms should be technically accurate alternatives a patent searcher would use
- Return ONLY valid JSON, no markdown.`;

async function extractConcepts(
  body: { paragraph: string }
): Promise<object> {
  const {paragraph} = body;

  if (!paragraph || typeof paragraph !== "string") {
    throw new Error("paragraph string is required");
  }

  const model = getModel();
  const result = await model.generateContent({
    contents: [{
      role: "user",
      parts: [{
        text: `${EXTRACT_CONCEPTS_PROMPT}

Analyze this paragraph and extract structured technical concepts: "${paragraph}"`,
      }],
    }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 2000,
      responseMimeType: "application/json",
    },
  });

  const content = result.response.text();
  if (!content) {
    throw new Error("Empty response from Gemini API");
  }

  let parsed = JSON.parse(content);

  // Gemini sometimes wraps the response in an array — unwrap it
  if (Array.isArray(parsed)) {
    parsed = parsed[0] || {};
  }
  // Gemini sometimes double-stringifies — parse again if needed
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
      if (Array.isArray(parsed)) parsed = parsed[0] || {};
    } catch {
      // not valid JSON string, leave as-is
    }
  }

  return parsed;
}

// ── Prior Art Analysis (102/103) ──

const PRIOR_ART_ANALYSIS_PROMPT = `You are a patent law expert performing prior art analysis under 35 USC 102 (anticipation) and 35 USC 103 (obviousness).

Given an invention description, a list of key concepts (with synonyms), and a set of prior art patents, analyze:

1. **Concept Coverage**: For each patent, evaluate whether it discloses each concept.
   - "full": The patent clearly teaches this concept
   - "partial": The patent mentions related technology but doesn't fully disclose the concept
   - "none": The patent does not address this concept
   - Provide a brief evidence string (10-30 words) explaining the coverage determination

2. **Section 102 — Anticipation**: Identify any SINGLE patent that discloses ALL concepts (100% coverage).
   A patent anticipates only if it covers every single concept fully or partially. Be strict — if even one concept is "none", it cannot anticipate.

3. **Section 103 — Obviousness Combinations**: Identify 2-3 reference combinations where:
   - A PRIMARY reference covers the most concepts
   - One or two SECONDARY references fill the gaps
   - There must be a motivation to combine (same field, similar problem, complementary solutions)
   - Report which concepts each reference contributes
   - Only include combinations that achieve high combined coverage (80%+)

Return JSON matching this schema exactly:
{
  "conceptCoverage": [
    {
      "patentId": "string",
      "conceptsCovered": [
        { "conceptName": "string", "coverage": "full" | "partial" | "none", "evidence": "string" }
      ]
    }
  ],
  "section102": [
    { "patentId": "string", "coveragePercent": 100, "reasoning": "string" }
  ],
  "section103": [
    {
      "primary": { "patentId": "string", "conceptsContributed": ["string"], "reasoning": "string" },
      "secondary": [
        { "patentId": "string", "conceptsContributed": ["string"], "reasoning": "string" }
      ],
      "combinedCoverage": 95,
      "combinationReasoning": "string",
      "fieldOverlap": "string"
    }
  ]
}

Rules:
- Only include patents in section102 if they truly cover ALL concepts (100% of concepts at "full" or "partial")
- section102 array should be EMPTY if no single patent anticipates — this is the common case
- For section103, prefer combinations with the fewest references that cover the most concepts
- Limit to the top 3 most threatening 103 combinations
- Be conservative: don't overstate coverage. When in doubt, rate as "partial" rather than "full"
- Return ONLY valid JSON, no markdown.`;

interface PriorArtPatentInput {
  patentId: string;
  title: string;
  abstract?: string;
  fullAbstract?: string;
  cpcCodes?: string[];
  firstClaim?: string;
}

interface AnalyzePriorArtBody {
  query: string;
  concepts: { name: string; synonyms: string[] }[];
  patents: PriorArtPatentInput[];
}

async function analyzePriorArt(body: AnalyzePriorArtBody): Promise<object> {
  const {query, concepts, patents} = body;

  if (!query || typeof query !== "string") {
    throw new Error("query string is required");
  }
  if (!concepts || !Array.isArray(concepts) || concepts.length === 0) {
    throw new Error("concepts array is required");
  }
  if (!patents || !Array.isArray(patents) || patents.length === 0) {
    throw new Error("patents array is required");
  }

  const conceptsSummary = concepts.map(
    (c) => `- ${c.name}: [${c.synonyms.join(", ")}]`
  ).join("\n");

  const patentSummaries = patents.slice(0, 12).map((p, i) => {
    const parts = [`[${i + 1}] ID: ${p.patentId}`, `Title: ${p.title}`];
    const abs = (p.fullAbstract || p.abstract || "").substring(0, 600);
    if (abs) parts.push(`Abstract: ${abs}`);
    if (p.cpcCodes && p.cpcCodes.length > 0) {
      parts.push(`CPC: ${p.cpcCodes.join(", ")}`);
    }
    if (p.firstClaim) {
      parts.push(`Claim 1: ${p.firstClaim.substring(0, 500)}`);
    }
    return parts.join("\n");
  }).join("\n\n");

  const model = getModel();
  const result = await model.generateContent({
    contents: [{
      role: "user",
      parts: [{
        text: `${PRIOR_ART_ANALYSIS_PROMPT}

Invention description: "${query}"

Key concepts:
${conceptsSummary}

Prior art patents (${patents.length} total, top 12):

${patentSummaries}`,
      }],
    }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 8000,
      responseMimeType: "application/json",
    },
  });

  const content = result.response.text();
  if (!content) {
    throw new Error("Empty response from Gemini API");
  }

  let parsed = JSON.parse(content);

  // Gemini sometimes wraps the response in an array — unwrap it
  if (Array.isArray(parsed)) {
    parsed = parsed[0] || {};
  }
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
      if (Array.isArray(parsed)) parsed = parsed[0] || {};
    } catch {
      // not valid JSON string, leave as-is
    }
  }

  return parsed;
}

// ── Router ──

export async function handleAIRequest(
  path: string,
  body: Record<string, unknown>
): Promise<object> {
  switch (path) {
  case "/generate":
    return generateSearch(body as { words: string[]; searchSystem?: string });
  case "/synonyms":
    return getSynonyms(body as { word: string });
  case "/definitions":
    return getDefinition(body as { word: string });
  case "/analyze":
    return analyzeParagraph(
      body as { paragraph: string; searchSystem?: string }
    );
  case "/rank":
    return rankPatents(
      body as { query: string; patents: PatentForRanking[] }
    );
  case "/optimize-query":
    return optimizeQuery(body as { text: string });
  case "/enrich-npl":
    return enrichNPL(body as { items: NPLItem[] });
  case "/extract-concepts":
    return extractConcepts(body as { paragraph: string });
  case "/generate-from-concepts":
    return generateFromConcepts(body as { concepts: ConceptInput[] });
  case "/analyze-round":
    return analyzeRound(body as unknown as AnalyzeRoundBody);
  case "/analyze-prior-art":
    return analyzePriorArt(body as unknown as AnalyzePriorArtBody);
  default:
    throw new Error(`Unknown endpoint: ${path}`);
  }
}
