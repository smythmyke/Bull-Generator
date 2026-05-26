import { PatentSearchApiClient } from "../api/client.js";

export const examinerTool = {
  name: "examiner",
  description:
    "Get the assigned examiner's name, art unit, total applications handled, allowance rate, and average pendency for a US patent. " +
    "Free. Useful for prosecution strategy and risk assessment.",
  inputSchema: {
    type: "object",
    properties: {
      patentNumber: {
        type: "string",
        description: "Patent publication number (e.g. US10867416B2).",
      },
    },
    required: ["patentNumber"],
    additionalProperties: false,
  },
} as const;

interface ExaminerResponse {
  name?: string;
  artUnit?: string;
  totalApplications?: number;
  allowanceRate?: number;
  avgPendency?: number;
}

export async function runExaminer(
  api: PatentSearchApiClient,
  args: Record<string, unknown>
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  structuredContent: ExaminerResponse;
}> {
  const patentNumber = typeof args.patentNumber === "string" ? args.patentNumber : "";
  if (!patentNumber) throw new Error("patentNumber is required");

  const data = await api.post<ExaminerResponse>("/examiner-stats", { patentNumber });
  const lines = [
    `Examiner: ${data.name ?? "unknown"}`,
    data.artUnit ? `Art Unit: ${data.artUnit}` : null,
    data.totalApplications !== undefined ? `Total applications: ${data.totalApplications}` : null,
    data.allowanceRate !== undefined ? `Allowance rate: ${(data.allowanceRate * 100).toFixed(1)}%` : null,
    data.avgPendency !== undefined ? `Average pendency: ${data.avgPendency} months` : null,
  ].filter((s): s is string => s !== null);

  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structuredContent: data,
  };
}
