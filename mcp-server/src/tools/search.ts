import { PatentSearchApiClient } from "../api/client.js";

export const searchTool = {
  name: "search",
  description:
    "Execute a patent search against Google Patents server-side and return ranked hits. " +
    "Given a natural-language description and a search strategy, the server: " +
    "(1) extracts technical concepts, (2) generates Boolean queries per the chosen strategy, " +
    "(3) runs each query against Google Patents, (4) dedupes results by publication number. " +
    "Strategies: 'telescoping' (3 queries: broad/moderate/narrow — recommended default), " +
    "'onion-ring' (layered queries adding one concept at a time), " +
    "'faceted' (multiple two-concept pair queries). " +
    "Costs 1 credit.",
  inputSchema: {
    type: "object",
    properties: {
      description: {
        type: "string",
        description:
          "Natural-language description of the invention or technology area (minimum 10 characters).",
      },
      strategy: {
        type: "string",
        enum: ["telescoping", "onion-ring", "faceted"],
        description: "Search strategy. Defaults to 'telescoping'.",
        default: "telescoping",
      },
      limit: {
        type: "number",
        description: "Maximum number of deduplicated hits to return (default 20, max 100).",
        default: 20,
      },
    },
    required: ["description"],
    additionalProperties: false,
  },
} as const;

interface SearchResponse {
  description: string;
  strategy: string;
  concepts: Array<{ name: string; synonyms: string[] }>;
  queries: Array<{ label: string; query: string; hitCount: number }>;
  hits: Array<{
    publicationNumber: string;
    title: string;
    snippet: string;
    assignee: string;
    inventor: string;
    priorityDate: string;
    publicationDate: string;
    countryCode: string;
    foundByQueryLabel: string;
    rankInQuery: number;
  }>;
  totalHits: number;
  warnings?: string[];
}

export async function runSearch(
  api: PatentSearchApiClient,
  args: Record<string, unknown>
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  structuredContent: SearchResponse;
}> {
  const description = typeof args.description === "string" ? args.description : "";
  const strategy = typeof args.strategy === "string" ? args.strategy : "telescoping";
  const limit = typeof args.limit === "number" ? args.limit : 20;
  if (!description) throw new Error("description is required");

  const data = await api.post<SearchResponse>("/search", { description, strategy, limit });

  const lines = [
    `Strategy: ${data.strategy}`,
    `Concepts extracted: ${data.concepts.map((c) => c.name).join(", ")}`,
    "",
    `Queries run (${data.queries.length}):`,
    ...data.queries.map((q, i) => `  ${i + 1}. [${q.label}] ${q.hitCount} hits\n     ${q.query}`),
    "",
    `Top ${data.hits.length} of ${data.totalHits} deduplicated hits:`,
    ...data.hits.slice(0, 10).map((h, i) =>
      `  ${i + 1}. ${h.publicationNumber} — ${h.title}\n     Assignee: ${h.assignee || "n/a"}; priority: ${h.priorityDate || "n/a"}`
    ),
    data.hits.length > 10 ? `  … and ${data.hits.length - 10} more in structuredContent.hits` : null,
    data.warnings && data.warnings.length > 0 ? `\nWarnings:\n${data.warnings.map((w) => `  • ${w}`).join("\n")}` : null,
  ].filter((s): s is string => s !== null);

  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structuredContent: data,
  };
}
