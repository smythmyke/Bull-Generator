import { PatentSearchApiClient } from "../api/client.js";

export const similarTool = {
  name: "similar",
  description:
    "Return Google Patents' 'similar documents' ranking for a given patent — a list of patents that Google considers " +
    "technically related based on its own semantic models. Free. Distinct from `search` (which generates new queries from a description); " +
    "this tool finds patents related to an existing one.",
  inputSchema: {
    type: "object",
    properties: {
      patentNumber: {
        type: "string",
        description: "Patent publication number (e.g. US10867416B2).",
      },
      limit: {
        type: "number",
        description: "Maximum number of similar patents to return (default 20).",
        default: 20,
      },
    },
    required: ["patentNumber"],
    additionalProperties: false,
  },
} as const;

interface SimilarResponse {
  patentNumber: string;
  similar: Array<{ patentNumber: string; title?: string; assignee?: string }>;
  cached: boolean;
}

export async function runSimilar(
  api: PatentSearchApiClient,
  args: Record<string, unknown>
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  structuredContent: SimilarResponse;
}> {
  const patentNumber = typeof args.patentNumber === "string" ? args.patentNumber : "";
  const limit = typeof args.limit === "number" ? args.limit : 20;
  if (!patentNumber) throw new Error("patentNumber is required");

  const data = await api.post<SimilarResponse>("/similar", { patentNumber, limit });
  const lines = [
    `${data.similar.length} similar patents for ${data.patentNumber}:`,
    ...data.similar.slice(0, 15).map((s, i) => `  ${i + 1}. ${s.patentNumber} — ${s.title ?? ""}`),
    data.similar.length > 15 ? `  … and ${data.similar.length - 15} more` : null,
    data.cached ? "(served from 24h cache)" : null,
  ].filter((s): s is string => s !== null);

  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structuredContent: data,
  };
}
