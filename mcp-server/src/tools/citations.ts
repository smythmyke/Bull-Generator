import { PatentSearchApiClient } from "../api/client.js";

export const citationsTool = {
  name: "citations",
  description:
    "Return backward and/or forward citations for a patent. " +
    "Backward = patents this one cites (its prior art). Forward = patents that cite this one (downstream impact). " +
    "Each citation includes whether it was examiner-cited (load-bearing on patentability) vs applicant-cited. " +
    "Free. Lighter payload than `dossier` when you only need citation lists.",
  inputSchema: {
    type: "object",
    properties: {
      patentNumber: {
        type: "string",
        description: "Patent publication number (e.g. US10867416B2).",
      },
      direction: {
        type: "string",
        enum: ["backward", "forward", "both"],
        description: "Which citation set to return. Defaults to 'both'.",
        default: "both",
      },
    },
    required: ["patentNumber"],
    additionalProperties: false,
  },
} as const;

interface Citation {
  patentNumber: string;
  title?: string;
  assignee?: string;
  date?: string;
  examinerCited?: boolean;
}

interface CitationsResponse {
  patentNumber: string;
  direction: string;
  backwardCount?: number;
  forwardCount?: number;
  backward?: Citation[];
  forward?: Citation[];
  cached: boolean;
}

export async function runCitations(
  api: PatentSearchApiClient,
  args: Record<string, unknown>
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  structuredContent: CitationsResponse;
}> {
  const patentNumber = typeof args.patentNumber === "string" ? args.patentNumber : "";
  const direction = typeof args.direction === "string" ? args.direction : "both";
  if (!patentNumber) throw new Error("patentNumber is required");

  const data = await api.post<CitationsResponse>("/citations", { patentNumber, direction });
  const sections: string[] = [];

  if (data.backward && data.backward.length > 0) {
    sections.push(`Backward citations (${data.backwardCount ?? data.backward.length}):`);
    sections.push(...data.backward.slice(0, 15).map(
      (c) => `  • ${c.patentNumber}${c.examinerCited ? " [examiner-cited]" : ""}: ${c.title ?? ""}`
    ));
    if (data.backward.length > 15) sections.push(`  … and ${data.backward.length - 15} more`);
  }
  if (data.forward && data.forward.length > 0) {
    if (sections.length > 0) sections.push("");
    sections.push(`Forward citations (${data.forwardCount ?? data.forward.length}):`);
    sections.push(...data.forward.slice(0, 15).map(
      (c) => `  • ${c.patentNumber}${c.examinerCited ? " [examiner-cited]" : ""}: ${c.title ?? ""}`
    ));
    if (data.forward.length > 15) sections.push(`  … and ${data.forward.length - 15} more`);
  }

  return {
    content: [{ type: "text", text: sections.join("\n") || "No citations found." }],
    structuredContent: data,
  };
}
