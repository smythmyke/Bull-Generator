import { PatentSearchApiClient } from "../api/client.js";

export const oaAnalyzeTool = {
  name: "oa_analyze",
  description:
    "AI-analyze a USPTO Office Action document to extract rejection grounds (102, 103, 112, etc.), cited prior art, " +
    "and suggested response arguments. " +
    "Two invocation forms: (1) pass only `patentNumber` and the server auto-picks the most recent Office Action for the patent; " +
    "(2) pass both `applicationNumber` and `documentId` (from `prosecution` output) for explicit selection. " +
    "First 5 analyses per application are free; subsequent analyses cost 1 credit each.",
  inputSchema: {
    type: "object",
    properties: {
      patentNumber: {
        type: "string",
        description: "Patent publication number — auto-picks the most recent OA for this patent.",
      },
      applicationNumber: {
        type: "string",
        description: "Application number for explicit selection (used with documentId).",
      },
      documentId: {
        type: "string",
        description: "Office Action document ID from prosecution-history output (used with applicationNumber).",
      },
    },
    additionalProperties: false,
  },
} as const;

interface OaAnalyzeResponse {
  analysis?: Record<string, unknown>;
  quota?: { used: number; limit: number; billed: boolean };
}

export async function runOaAnalyze(
  api: PatentSearchApiClient,
  args: Record<string, unknown>
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  structuredContent: OaAnalyzeResponse;
}> {
  const patentNumber = typeof args.patentNumber === "string" ? args.patentNumber : undefined;
  const applicationNumber = typeof args.applicationNumber === "string" ? args.applicationNumber : undefined;
  const documentId = typeof args.documentId === "string" ? args.documentId : undefined;

  if (!patentNumber && !(applicationNumber && documentId)) {
    throw new Error("Provide patentNumber, OR applicationNumber + documentId");
  }

  const body: Record<string, unknown> = {};
  if (patentNumber) body.patentNumber = patentNumber;
  if (applicationNumber) body.applicationNumber = applicationNumber;
  if (documentId) body.documentId = documentId;

  const data = await api.post<OaAnalyzeResponse>("/oa-analyze", body);
  const analysis = data.analysis ?? {};
  const rejections = (analysis as { rejections?: unknown[] }).rejections ?? [];
  const citedArt = (analysis as { citedArt?: unknown[] }).citedArt ?? [];
  const args_ = (analysis as { suggestedArguments?: unknown[] }).suggestedArguments ?? [];

  const lines = [
    `Office Action analysis:`,
    `  • Rejections: ${rejections.length}`,
    `  • Cited prior art: ${citedArt.length}`,
    `  • Suggested arguments: ${args_.length}`,
    data.quota ? `Quota: ${data.quota.used}/${data.quota.limit} used (${data.quota.billed ? "1 credit charged" : "free"})` : null,
  ].filter((s): s is string => s !== null);

  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structuredContent: data,
  };
}
