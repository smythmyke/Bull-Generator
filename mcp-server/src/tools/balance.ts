import { PatentSearchApiClient } from "../api/client.js";

export const balanceTool = {
  name: "balance",
  description:
    "Return the current credit balance and subscription status for the authenticated AI Patent Search Generator account. " +
    "Use this before calling paid tools (dossier, oa_analyze, query, search) to verify credits are available.",
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
} as const;

interface BalanceResponse {
  balance: number;
  subscriptionCredits?: number;
  topupCredits?: number;
  totalUsed?: number;
  totalPurchased?: number;
  subscription?: { planId?: string; status?: string } | null;
}

export async function runBalance(api: PatentSearchApiClient): Promise<{
  content: Array<{ type: "text"; text: string }>;
  structuredContent: BalanceResponse;
}> {
  const data = await api.post<BalanceResponse>("/credits/balance", {});
  const lines = [
    `Credit balance: ${data.balance}`,
    data.subscriptionCredits !== undefined ? `  • Subscription: ${data.subscriptionCredits}` : null,
    data.topupCredits !== undefined ? `  • Top-up: ${data.topupCredits}` : null,
    data.totalUsed !== undefined ? `Total used: ${data.totalUsed}` : null,
    data.subscription
      ? `Subscription: ${data.subscription.planId ?? "unknown"} (${data.subscription.status ?? "unknown"})`
      : "Subscription: none",
  ].filter((s): s is string => s !== null);
  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structuredContent: data,
  };
}
