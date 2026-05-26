import { PatentSearchApiClient } from "../api/client.js";

export const prosecutionTool = {
  name: "prosecution",
  description:
    "Retrieve the USPTO file-wrapper documents (office actions, responses, amendments, IDS, notices) for a US patent or application. " +
    "Free. Returns each document's ID, mail date, category, and short description — IDs can be passed to `oa_analyze` for AI analysis.",
  inputSchema: {
    type: "object",
    properties: {
      patentNumber: {
        type: "string",
        description: "Patent publication number (e.g. US10867416B2). One of patentNumber or applicationNumber required.",
      },
      applicationNumber: {
        type: "string",
        description: "USPTO application number (e.g. 15912345). One of patentNumber or applicationNumber required.",
      },
    },
    additionalProperties: false,
  },
} as const;

interface ProsecutionResponse {
  applicationNumber?: string;
  patentNumber?: string;
  documents?: Array<{
    documentId: string;
    mailDate: string;
    category: string;
    description: string;
  }>;
}

export async function runProsecution(
  api: PatentSearchApiClient,
  args: Record<string, unknown>
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  structuredContent: ProsecutionResponse;
}> {
  const patentNumber = typeof args.patentNumber === "string" ? args.patentNumber : undefined;
  const applicationNumber = typeof args.applicationNumber === "string" ? args.applicationNumber : undefined;
  if (!patentNumber && !applicationNumber) {
    throw new Error("Provide patentNumber or applicationNumber");
  }
  const body: Record<string, unknown> = {};
  if (patentNumber) body.patentNumber = patentNumber;
  if (applicationNumber) body.applicationNumber = applicationNumber;

  const data = await api.post<ProsecutionResponse>("/prosecution-history", body);
  const docs = data.documents ?? [];
  const lines = [
    `Application: ${data.applicationNumber ?? "n/a"}`,
    `${docs.length} document(s):`,
    ...docs.slice(0, 30).map((d) => `  • [${d.documentId}] ${d.mailDate} (${d.category}) — ${d.description}`),
    docs.length > 30 ? `  … and ${docs.length - 30} more` : null,
  ].filter((s): s is string => s !== null);

  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structuredContent: data,
  };
}
