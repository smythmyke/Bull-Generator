import { PatentSearchApiClient } from "../api/client.js";

export const queryTool = {
  name: "query",
  description:
    "Generate a single optimized Boolean search query for Google Patents from a natural-language description of an invention or technology. " +
    "Returns the Boolean string only — does NOT execute the search. Use `search` if you want ranked hits instead. " +
    "Costs 1 credit.",
  inputSchema: {
    type: "object",
    properties: {
      description: {
        type: "string",
        description:
          "Natural-language description of the invention or technology area (e.g. 'foldable smartphone display with ultrasonic fingerprint sensor'). Minimum 10 characters.",
      },
    },
    required: ["description"],
    additionalProperties: false,
  },
} as const;

interface QueryResponse {
  optimizedQuery: string;
  reasoning: string;
}

export async function runQuery(
  api: PatentSearchApiClient,
  args: Record<string, unknown>
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  structuredContent: QueryResponse;
}> {
  const description = typeof args.description === "string" ? args.description : "";
  if (!description) throw new Error("description is required");

  const data = await api.post<QueryResponse>("/query", { description });
  const lines = [
    `Optimized Boolean query for Google Patents:`,
    "",
    data.optimizedQuery || "(empty)",
    "",
    data.reasoning ? `Strategy: ${data.reasoning}` : "",
    "",
    "Paste this into patents.google.com to run the search.",
  ].filter(Boolean);

  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structuredContent: data,
  };
}
