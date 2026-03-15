import { auth } from "../firebaseConfig";

const AI_BASE_URL = "https://us-central1-solicitation-matcher-extension.cloudfunctions.net/ai";

async function getAuthToken(): Promise<string> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error("User must be logged in");
  }
  return user.getIdToken(true);
}

async function callCredits<T>(endpoint: string, body: Record<string, unknown> = {}): Promise<T> {
  const token = await getAuthToken();

  const response = await fetch(`${AI_BASE_URL}/credits/${endpoint}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    const message = errorData?.error || `Request failed: ${response.status}`;
    const err = new Error(message);
    (err as any).status = response.status;
    throw err;
  }

  const result = await response.json();
  return result.data as T;
}

// Types
export interface CreditBalance {
  balance: number;
  totalUsed: number;
}

export interface CreditPack {
  id: string;
  credits: number;
  price: number;
  label: string;
  perCredit: string;
}

export interface PurchaseRecord {
  id: string;
  date: string | null;
  packId: string;
  packLabel: string;
  credits: number;
  amountPaid: number; // cents
}

// API functions
export async function getCreditBalance(): Promise<CreditBalance> {
  return callCredits<CreditBalance>("balance");
}

export async function getCreditPacks(): Promise<{ packs: CreditPack[] }> {
  return callCredits<{ packs: CreditPack[] }>("packs");
}

export async function createCreditCheckout(packId: string): Promise<{ url: string; sessionId: string }> {
  return callCredits<{ url: string; sessionId: string }>("checkout", { packId });
}

export async function refundCredit(reason: string, amount: number = 1): Promise<{ balance: number }> {
  return callCredits<{ balance: number }>("refund", { reason, amount });
}

export async function getPurchaseHistory(): Promise<PurchaseRecord[]> {
  const result = await callCredits<{ purchases: PurchaseRecord[] }>("history");
  return result.purchases;
}
