import { PatentSearchApiClient } from "../api/client.js";

export const dossierTool = {
  name: "dossier",
  description:
    "Fetch a comprehensive intelligence dossier for a patent by publication number. " +
    "Returns bibliographic data (title, assignees, inventors, dates, legal status), independent claims, " +
    "backward + forward citations, patent family, CPC classifications, examiner info, and similar documents. " +
    "Costs 3 credits on a fresh fetch; subsequent calls within 24 hours read from cache and are free. " +
    "The headline tool — most patent-analysis workflows start here.",
  inputSchema: {
    type: "object",
    properties: {
      patentNumber: {
        type: "string",
        description:
          "Publication number in canonical form (e.g. US10867416B2, EP3500001B1). Accepts loose input like '10,867,416' or 'us10867416' — the server normalizes.",
      },
    },
    required: ["patentNumber"],
    additionalProperties: false,
  },
} as const;

interface DossierResponse {
  patentNumber: string;
  cached: boolean;
  header: Record<string, unknown>;
  claims: Record<string, unknown>;
  citations: Record<string, unknown>;
  family: Record<string, unknown>;
  classification: Record<string, unknown>;
  similar: unknown[];
}

export async function runDossier(
  api: PatentSearchApiClient,
  args: Record<string, unknown>
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  structuredContent: DossierResponse;
}> {
  const patentNumber = typeof args.patentNumber === "string" ? args.patentNumber : "";
  if (!patentNumber) throw new Error("patentNumber is required");

  const data = await api.post<DossierResponse>("/dossier", { patentNumber });
  const header = data.header as Record<string, unknown>;
  const title = String(header?.title ?? "");
  const assignee = String(header?.currentAssignee ?? "");
  const statusLabel = String(header?.statusLabel ?? "unknown");
  const priorityDate = String(header?.priorityDate ?? "");
  const claims = data.claims as { totalCount?: number; independentNumbers?: number[] };
  const citations = data.citations as { forwardCount?: number; backwardCount?: number };

  const summary = [
    `${data.patentNumber} — ${title}`,
    assignee ? `Assignee: ${assignee}` : null,
    priorityDate ? `Priority: ${priorityDate}` : null,
    `Status: ${statusLabel}`,
    `Claims: ${claims?.totalCount ?? 0} total, independent: ${(claims?.independentNumbers ?? []).join(", ") || "n/a"}`,
    `Citations: ${citations?.backwardCount ?? 0} backward / ${citations?.forwardCount ?? 0} forward`,
    `Similar documents: ${(data.similar ?? []).length}`,
    data.cached ? "(served from 24h cache — free)" : "(fresh fetch — 3 credits charged)",
  ].filter((s): s is string => s !== null);

  return {
    content: [{ type: "text", text: summary.join("\n") }],
    structuredContent: data,
  };
}
