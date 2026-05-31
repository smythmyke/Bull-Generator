import * as admin from "firebase-admin";
import * as functions from "firebase-functions";
import * as crypto from "crypto";
import type { PlatformSource } from "./credits";

export const API_KEY_PREFIX = "psg_live_";
export const API_KEY_TEST_PREFIX = "psg_test_";
const API_KEY_RANDOM_BYTES = 32;

export type AuthSource = "firebase" | "apikey";

export interface AuthContext {
  uid: string;
  email: string | null;
  source: AuthSource;
  keyId?: string;
  scopes?: string[];
}

interface ApiKeyDoc {
  uid: string;
  name: string;
  keyHash: string;
  prefix: string;
  environment: "live" | "test";
  createdAt: FirebaseFirestore.Timestamp;
  lastUsedAt: FirebaseFirestore.Timestamp | null;
  revokedAt: FirebaseFirestore.Timestamp | null;
  scopes: string[];
}

export function generateRawApiKey(environment: "live" | "test" = "live"): string {
  const prefix = environment === "test" ? API_KEY_TEST_PREFIX : API_KEY_PREFIX;
  const random = crypto.randomBytes(API_KEY_RANDOM_BYTES).toString("base64url");
  return `${prefix}${random}`;
}

export function hashApiKey(rawKey: string): string {
  return crypto.createHash("sha256").update(rawKey).digest("hex");
}

export function keyPrefixForDisplay(rawKey: string): string {
  return rawKey.slice(0, 16);
}

async function verifyFirebaseIdToken(
  req: { headers: { authorization?: string } }
): Promise<admin.auth.DecodedIdToken | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return null;

  const idToken = authHeader.split("Bearer ")[1];
  try {
    return await admin.auth().verifyIdToken(idToken);
  } catch {
    throw new functions.https.HttpsError("unauthenticated", "Invalid or expired token");
  }
}

async function verifyApiKey(
  req: { headers: { "x-api-key"?: string | string[] } }
): Promise<AuthContext | null> {
  const headerVal = req.headers["x-api-key"];
  const raw = Array.isArray(headerVal) ? headerVal[0] : headerVal;
  if (!raw) return null;

  if (!raw.startsWith(API_KEY_PREFIX) && !raw.startsWith(API_KEY_TEST_PREFIX)) {
    throw new functions.https.HttpsError("unauthenticated", "Malformed API key");
  }

  const keyHash = hashApiKey(raw);
  const db = admin.firestore();
  const snapshot = await db
    .collection("apiKeys")
    .where("keyHash", "==", keyHash)
    .limit(1)
    .get();

  if (snapshot.empty) {
    throw new functions.https.HttpsError("unauthenticated", "Invalid API key");
  }

  const doc = snapshot.docs[0];
  const data = doc.data() as ApiKeyDoc;

  if (data.revokedAt) {
    throw new functions.https.HttpsError("unauthenticated", "API key has been revoked");
  }

  doc.ref
    .update({ lastUsedAt: admin.firestore.FieldValue.serverTimestamp() })
    .catch(() => {});

  return {
    uid: data.uid,
    email: null,
    source: "apikey",
    keyId: doc.id,
    scopes: data.scopes,
  };
}

export async function resolveAuth(
  req: { headers: { authorization?: string; "x-api-key"?: string | string[] } }
): Promise<AuthContext> {
  const apiKeyCtx = await verifyApiKey(req);
  if (apiKeyCtx) return apiKeyCtx;

  const idToken = await verifyFirebaseIdToken(req);
  if (idToken) {
    return {
      uid: idToken.uid,
      email: idToken.email ?? null,
      source: "firebase",
      scopes: ["*"],
    };
  }

  throw new functions.https.HttpsError(
    "unauthenticated",
    "Missing credentials — supply Bearer token or X-API-Key header"
  );
}

// Shim: existing handlers (handleCreditRequest, handleAdminRequest, etc.) take a
// DecodedIdToken. Adapt AuthContext to that shape so we don't have to touch them.
export function asDecodedIdToken(ctx: AuthContext): admin.auth.DecodedIdToken {
  return {
    uid: ctx.uid,
    email: ctx.email ?? undefined,
    aud: "patent-search-generator",
    auth_time: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    firebase: { identities: {}, sign_in_provider: ctx.source },
    iat: Math.floor(Date.now() / 1000),
    iss: "patent-search-generator-api",
    sub: ctx.uid,
  } as admin.auth.DecodedIdToken;
}

export function requireFirebaseAuth(ctx: AuthContext): void {
  if (ctx.source !== "firebase") {
    throw new functions.https.HttpsError(
      "permission-denied",
      "This endpoint requires a Firebase ID token. API keys cannot manage other API keys."
    );
  }
}

export function hasScope(ctx: AuthContext, scope: string): boolean {
  if (!ctx.scopes) return false;
  return ctx.scopes.includes("*") || ctx.scopes.includes(scope);
}

const FIREBASE_CLIENT_HINTS: ReadonlySet<PlatformSource> = new Set(["extension", "website"]);
const MCP_USER_AGENT_PREFIX = "patent-search-mcp-server";

/**
 * Determine which surface a request came from. Server-authoritative —
 * clients can supply a `source` hint when calling with a Firebase token (to
 * distinguish extension vs website), but API-key callers are classified
 * entirely from auth context + headers so they can't lie about the channel.
 *
 *   - API key + User-Agent starts with patent-search-mcp-server → "mcp"
 *   - API key, no other signal                                  → "api"
 *   - Firebase token + client hint of "extension" / "website"    → that hint
 *   - Firebase token, no hint                                    → "extension"
 *     (PatentSearch's original surface was the Chrome extension)
 */
export function resolvePlatformSource(
  ctx: AuthContext,
  req: { headers: { "user-agent"?: string | string[] } },
  clientHint?: unknown
): PlatformSource {
  if (ctx.source === "apikey") {
    const uaHeader = req.headers["user-agent"];
    const ua = (Array.isArray(uaHeader) ? uaHeader[0] : uaHeader) ?? "";
    if (ua.toLowerCase().startsWith(MCP_USER_AGENT_PREFIX)) return "mcp";
    return "api";
  }

  if (typeof clientHint === "string" && FIREBASE_CLIENT_HINTS.has(clientHint as PlatformSource)) {
    return clientHint as PlatformSource;
  }
  return "extension";
}
