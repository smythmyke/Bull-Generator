import { PatentSearchApiClient } from "../api/client.js";

export const cpcTool = {
  name: "cpc",
  description:
    "Look up a Cooperative Patent Classification (CPC) code and return its section, class, subclass, and group context. " +
    "Accepts any level of code — section letter (e.g. 'H'), class ('H01'), subclass ('H01M'), main group ('H01M10/00'), " +
    "or subgroup ('H01M10/0525'). Free. " +
    "v1.0 dataset covers all sections + ~80 common subclasses; subgroup-level descriptions land in v1.1.",
  inputSchema: {
    type: "object",
    properties: {
      code: {
        type: "string",
        description: "CPC code at any level (section, class, subclass, main group, or subgroup).",
      },
    },
    required: ["code"],
    additionalProperties: false,
  },
} as const;

interface CpcEntry {
  code: string;
  title: string;
}

interface CpcResponse {
  code: string;
  section: CpcEntry | null;
  classification: CpcEntry | null;
  subclass: CpcEntry | null;
  mainGroup: CpcEntry | null;
  subgroup: string | null;
  uspoBrowserUrl: string;
  notes?: string;
}

export async function runCpc(
  api: PatentSearchApiClient,
  args: Record<string, unknown>
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  structuredContent: CpcResponse;
}> {
  const code = typeof args.code === "string" ? args.code : "";
  if (!code) throw new Error("code is required");

  const data = await api.post<CpcResponse>("/cpc", { code });
  const lines = [
    `CPC ${data.code}:`,
    data.section ? `  Section ${data.section.code}: ${data.section.title}` : null,
    data.classification ? `  Class ${data.classification.code}: ${data.classification.title}` : null,
    data.subclass && data.subclass.title ? `  Subclass ${data.subclass.code}: ${data.subclass.title}` : null,
    data.mainGroup ? `  Main group: ${data.mainGroup.code}` : null,
    data.subgroup ? `  Subgroup: ${data.subgroup}` : null,
    "",
    `USPTO browser: ${data.uspoBrowserUrl}`,
    data.notes ? `\nNotes: ${data.notes}` : null,
  ].filter((s): s is string => s !== null);

  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structuredContent: data,
  };
}
