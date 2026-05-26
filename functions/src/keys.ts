import * as admin from "firebase-admin";
import * as functions from "firebase-functions";
import {
  AuthContext,
  generateRawApiKey,
  hashApiKey,
  keyPrefixForDisplay,
  requireFirebaseAuth,
} from "./auth";

const MAX_KEYS_PER_USER = 10;

// Scopes correspond to logical endpoint groups (see PLAN-PUBLIC-API.md).
// Firebase-token auth always has "*" scope; API keys are scoped by this list.
export const DEFAULT_SCOPES = [
  "dossier",       // /v1/dossier, /v1/dossier-summary, /v1/claim-chart
  "search",        // /v1/search (Boolean query + strategy)
  "oa-analyze",    // /v1/oa-analyze
  "prosecution",   // /v1/prosecution-history, /v1/examiner-stats
  "credits:read",  // /v1/credits/balance
];

interface CreateKeyResult {
  keyId: string;
  rawKey: string;
  name: string;
  prefix: string;
  environment: "live" | "test";
  scopes: string[];
  createdAt: string;
}

interface KeyListItem {
  keyId: string;
  name: string;
  prefix: string;
  environment: "live" | "test";
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export async function handleKeysRequest(
  path: string,
  body: Record<string, unknown>,
  ctx: AuthContext
): Promise<unknown> {
  requireFirebaseAuth(ctx);

  const subPath = path.replace(/^\/(v1\/)?keys\/?/, "");
  const db = admin.firestore();

  switch (subPath) {
    case "create":
      return createKey(db, ctx.uid, body);
    case "list":
      return listKeys(db, ctx.uid);
    case "revoke":
      return revokeKey(db, ctx.uid, body);
    default:
      throw new functions.https.HttpsError("not-found", `Unknown keys endpoint: ${subPath}`);
  }
}

async function createKey(
  db: FirebaseFirestore.Firestore,
  uid: string,
  body: Record<string, unknown>
): Promise<CreateKeyResult> {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 80) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Key name is required (1-80 chars)"
    );
  }

  const environment = body.environment === "test" ? "test" : "live";
  const requestedScopes = Array.isArray(body.scopes) ? (body.scopes as string[]) : DEFAULT_SCOPES;
  const scopes = requestedScopes.filter((s) => DEFAULT_SCOPES.includes(s));
  if (scopes.length === 0) {
    throw new functions.https.HttpsError("invalid-argument", "At least one valid scope is required");
  }

  const existingCount = await db
    .collection("apiKeys")
    .where("uid", "==", uid)
    .where("revokedAt", "==", null)
    .count()
    .get();

  if (existingCount.data().count >= MAX_KEYS_PER_USER) {
    throw new functions.https.HttpsError(
      "resource-exhausted",
      `Maximum ${MAX_KEYS_PER_USER} active keys per user. Revoke an existing key first.`
    );
  }

  const rawKey = generateRawApiKey(environment);
  const keyHash = hashApiKey(rawKey);
  const prefix = keyPrefixForDisplay(rawKey);

  const docRef = db.collection("apiKeys").doc();
  const now = admin.firestore.FieldValue.serverTimestamp();

  await docRef.set({
    uid,
    name,
    keyHash,
    prefix,
    environment,
    scopes,
    createdAt: now,
    lastUsedAt: null,
    revokedAt: null,
  });

  return {
    keyId: docRef.id,
    rawKey,
    name,
    prefix,
    environment,
    scopes,
    createdAt: new Date().toISOString(),
  };
}

async function listKeys(
  db: FirebaseFirestore.Firestore,
  uid: string
): Promise<{ keys: KeyListItem[] }> {
  const snapshot = await db
    .collection("apiKeys")
    .where("uid", "==", uid)
    .orderBy("createdAt", "desc")
    .limit(50)
    .get();

  const keys: KeyListItem[] = snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      keyId: doc.id,
      name: data.name,
      prefix: data.prefix,
      environment: data.environment,
      scopes: data.scopes ?? [],
      createdAt: tsToIso(data.createdAt) ?? new Date(0).toISOString(),
      lastUsedAt: tsToIso(data.lastUsedAt),
      revokedAt: tsToIso(data.revokedAt),
    };
  });

  return { keys };
}

async function revokeKey(
  db: FirebaseFirestore.Firestore,
  uid: string,
  body: Record<string, unknown>
): Promise<{ keyId: string; revokedAt: string }> {
  const keyId = typeof body.keyId === "string" ? body.keyId : "";
  if (!keyId) {
    throw new functions.https.HttpsError("invalid-argument", "keyId is required");
  }

  const docRef = db.collection("apiKeys").doc(keyId);
  const doc = await docRef.get();
  if (!doc.exists) {
    throw new functions.https.HttpsError("not-found", "Key not found");
  }
  if (doc.data()?.uid !== uid) {
    throw new functions.https.HttpsError("permission-denied", "Key does not belong to this user");
  }

  const now = admin.firestore.FieldValue.serverTimestamp();
  await docRef.update({ revokedAt: now });

  return { keyId, revokedAt: new Date().toISOString() };
}

function tsToIso(ts: FirebaseFirestore.Timestamp | null | undefined): string | null {
  if (!ts) return null;
  return ts.toDate().toISOString();
}
