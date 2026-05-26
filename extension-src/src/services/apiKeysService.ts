import { auth } from "../firebaseConfig";

const AI_BASE_URL = "https://us-central1-solicitation-matcher-extension.cloudfunctions.net/ai";

async function callKeys<T>(endpoint: string, body: Record<string, unknown> = {}): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new Error("User must be logged in");

  const token = await user.getIdToken(true);

  const response = await fetch(`${AI_BASE_URL}/keys/${endpoint}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new Error(errorData?.error || `Request failed: ${response.status}`);
  }

  const result = await response.json();
  return result.data as T;
}

// ── Types ──

export interface ApiKey {
  keyId: string;
  name: string;
  prefix: string;
  environment: "live" | "test";
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface CreatedApiKey {
  keyId: string;
  rawKey: string;
  name: string;
  prefix: string;
  environment: "live" | "test";
  scopes: string[];
  createdAt: string;
}

// Default scope list — kept in sync with functions/src/keys.ts DEFAULT_SCOPES.
// All five are checked by default on key creation.
export const AVAILABLE_SCOPES: { id: string; label: string; description: string }[] = [
  { id: "dossier", label: "Dossier", description: "patent-dossier, claim-chart, similar, citations, family, cpc" },
  { id: "search", label: "Search", description: "query + search-execute (Google Patents)" },
  { id: "oa-analyze", label: "OA Analyze", description: "office-action AI analysis" },
  { id: "prosecution", label: "Prosecution", description: "file-wrapper + examiner stats" },
  { id: "credits:read", label: "Credits", description: "balance + usage" },
];

// ── API calls ──

export async function listApiKeys(): Promise<ApiKey[]> {
  const result = await callKeys<{ keys: ApiKey[] }>("list");
  return result.keys;
}

export async function createApiKey(
  name: string,
  scopes: string[],
  environment: "live" | "test" = "live"
): Promise<CreatedApiKey> {
  return callKeys<CreatedApiKey>("create", { name, scopes, environment });
}

export async function revokeApiKey(keyId: string): Promise<{ keyId: string; revokedAt: string }> {
  return callKeys<{ keyId: string; revokedAt: string }>("revoke", { keyId });
}
