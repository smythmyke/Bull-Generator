import { auth } from "../firebaseConfig";

const AI_BASE_URL = "https://us-central1-solicitation-matcher-extension.cloudfunctions.net/ai";

async function callAdmin<T>(endpoint: string, body: Record<string, unknown> = {}): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new Error("User must be logged in");

  const token = await user.getIdToken(true);

  const response = await fetch(`${AI_BASE_URL}/admin/${endpoint}`, {
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

// Types
export interface AdminDashboard {
  totalAuthUsers: number;
  totalCreditUsers: number;
  totalBalance: number;
  totalPurchased: number;
  totalUsed: number;
  userBalance: number;
  userPurchased: number;
  userUsed: number;
  revenueCents: number;
  realCreditsPurchased: number;
  adminBalance: number;
  adminPurchased: number;
  adminUsed: number;
}

export interface AdminUser {
  uid: string;
  email: string;
  displayName: string;
  createdAt: string | null;
  lastSignIn: string | null;
  balance: number;
  totalPurchased: number;
  totalUsed: number;
}

export interface UsageRecord {
  id: string;
  action: string;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  timestamp: string | null;
}

export interface PurchaseRecord {
  id: string;
  date: string | null;
  packId: string;
  packLabel: string;
  credits: number;
  amountPaid: number;
}

// API calls
export async function fetchAdminDashboard(): Promise<AdminDashboard> {
  return callAdmin<AdminDashboard>("dashboard");
}

export async function fetchAdminUsers(): Promise<AdminUser[]> {
  const result = await callAdmin<{ users: AdminUser[] }>("users");
  return result.users;
}

export async function fetchUserUsage(uid: string): Promise<UsageRecord[]> {
  const result = await callAdmin<{ usage: UsageRecord[] }>("user-usage", { uid });
  return result.usage;
}

export async function fetchUserPurchases(uid: string): Promise<PurchaseRecord[]> {
  const result = await callAdmin<{ purchases: PurchaseRecord[] }>("user-purchases", { uid });
  return result.purchases;
}

export async function grantCredits(uid: string, amount: number): Promise<{ balance: number }> {
  return callAdmin<{ balance: number }>("grant-credits", { uid, amount });
}
