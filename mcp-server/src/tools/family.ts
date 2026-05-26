import { PatentSearchApiClient } from "../api/client.js";

export const familyTool = {
  name: "family",
  description:
    "Return the patent family for a given patent — continuations, divisionals, and national counterparts (foreign equivalents). " +
    "Useful for confirming worldwide IP coverage and identifying related applications still pending. Free.",
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

interface FamilyMember {
  jurisdiction: string;
  publicationNumber: string;
  type: string;
  status?: string;
  date?: string;
}

interface FamilyResponse {
  patentNumber: string;
  family: {
    familyId: string;
    members: FamilyMember[];
  };
  cached: boolean;
}

export async function runFamily(
  api: PatentSearchApiClient,
  args: Record<string, unknown>
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  structuredContent: FamilyResponse;
}> {
  const patentNumber = typeof args.patentNumber === "string" ? args.patentNumber : "";
  if (!patentNumber) throw new Error("patentNumber is required");

  const data = await api.post<FamilyResponse>("/family", { patentNumber });
  const members = data.family?.members ?? [];
  const lines = [
    `Family ID: ${data.family?.familyId || "n/a"}`,
    `${members.length} member(s):`,
    ...members.slice(0, 30).map(
      (m) => `  • ${m.jurisdiction} — ${m.publicationNumber}${m.type ? ` (${m.type})` : ""}${m.date ? ` — ${m.date}` : ""}`
    ),
    members.length > 30 ? `  … and ${members.length - 30} more` : null,
  ].filter((s): s is string => s !== null);

  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structuredContent: data,
  };
}
