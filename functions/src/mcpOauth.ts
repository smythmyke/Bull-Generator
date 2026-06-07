/**
 * OAuth 2.1 token verification for the remote MCP endpoint (mcp.ts).
 *
 * WorkOS AuthKit is the authorization server; this server is the resource
 * server. We verify the RS256 bearer JWT against AuthKit's JWKS using
 * `node:crypto` (no `jose` dependency — functions/ is CommonJS), then resolve
 * the verified email. RFC 9728 Protected Resource Metadata is served by the
 * mcp function for client discovery (Claude Connector Directory / OpenAI Apps).
 *
 * Ported from JackpotKeywords' mcpOAuth.ts (proven end-to-end via Claude
 * 2026-06-03; runbook: JK docs/api-deployment/CLAUDE-CONNECTOR-REPLICATION-
 * RUNBOOK.md). Env: WORKOS_AUTHKIT_DOMAIN (issuer), WORKOS_API_KEY (user-email
 * lookup), WORKOS_CLIENT_ID, PSG_MCP_RESOURCE_URL (audience).
 */
import * as crypto from "crypto";
import * as functions from "firebase-functions";

function authkitDomain(): string {
  return (process.env.WORKOS_AUTHKIT_DOMAIN || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
}
export function oauthIssuer(): string {
  return `https://${authkitDomain()}`;
}
export function oauthJwksUri(): string {
  return `${oauthIssuer()}/oauth2/jwks`;
}
export function isMcpOAuthConfigured(): boolean {
  return !!authkitDomain();
}

/**
 * Canonical resource URL clients bind tokens to (token `aud`), and the URL the
 * PRM `resource` field + WWW-Authenticate hint advertise. MUST equal the URL
 * clients connect to — the Connector Directory listing URL on Hosting (the
 * /api/mcp rewrite routes it here), NOT the raw cloudfunctions.net URL.
 * (Runbook gotcha #12: a mismatch fails OAuth with no useful client error.)
 */
export function mcpResourceUrl(): string {
  return (
    process.env.PSG_MCP_RESOURCE_URL ||
    "https://patent-search-generator.web.app/api/mcp"
  );
}

// --- JWKS cache (kid -> public KeyObject) -----------------------------------
let jwksCache: { keys: Record<string, crypto.KeyObject>; fetchedAt: number } | null = null;
const JWKS_TTL_MS = 60 * 60 * 1000; // 1h

async function getSigningKey(kid: string): Promise<crypto.KeyObject | null> {
  const fresh = jwksCache && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS;
  if (fresh && jwksCache!.keys[kid]) return jwksCache!.keys[kid];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(oauthJwksUri(), {signal: controller.signal});
    if (!res.ok) throw new Error(`JWKS ${res.status}`);
    const json = await res.json() as { keys?: Array<Record<string, unknown>> };
    const keys: Record<string, crypto.KeyObject> = {};
    for (const jwk of json.keys || []) {
      const kidVal = jwk.kid;
      if (typeof kidVal !== "string") continue;
      try {
        keys[kidVal] = crypto.createPublicKey({key: jwk, format: "jwk"} as crypto.JsonWebKeyInput);
      } catch {
        /* skip unusable key */
      }
    }
    jwksCache = {keys, fetchedAt: Date.now()};
    return keys[kid] || null;
  } catch (err) {
    functions.logger.warn("MCP OAuth: JWKS fetch failed:", (err as Error).message);
    return jwksCache?.keys[kid] || null; // stale fallback if present
  } finally {
    clearTimeout(timer);
  }
}

function b64urlToBuf(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}
function b64urlToJson(s: string): Record<string, unknown> {
  return JSON.parse(b64urlToBuf(s).toString("utf8"));
}

export interface VerifiedPrincipal {
  sub: string;
  email?: string;
}

/**
 * Verify an AuthKit access token. Returns the principal on success or
 * `{ error }` on failure. Validates RS256 signature against JWKS + issuer +
 * expiry. Audience is checked loosely (logged, not enforced) until the WorkOS
 * Resource Indicator is confirmed configured — then tighten to hard-fail.
 */
export async function verifyAccessToken(
  token: string,
): Promise<VerifiedPrincipal | { error: string }> {
  const parts = token.split(".");
  if (parts.length !== 3) return {error: "malformed_token"};

  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    header = b64urlToJson(parts[0]);
    payload = b64urlToJson(parts[1]);
  } catch {
    return {error: "malformed_token"};
  }

  if (header.alg !== "RS256") return {error: `unsupported_alg:${header.alg}`};
  if (typeof header.kid !== "string") return {error: "missing_kid"};

  const key = await getSigningKey(header.kid);
  if (!key) return {error: "unknown_signing_key"};

  const valid = crypto.verify(
    "RSA-SHA256",
    Buffer.from(`${parts[0]}.${parts[1]}`),
    key,
    b64urlToBuf(parts[2]),
  );
  if (!valid) return {error: "bad_signature"};

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === "number" && payload.exp < now - 30) return {error: "token_expired"};
  if (payload.iss !== oauthIssuer()) return {error: "issuer_mismatch"};

  const aud = payload.aud;
  const auds = Array.isArray(aud) ? aud : aud ? [aud] : [];
  const resource = mcpResourceUrl();
  if (auds.length && !auds.includes(resource) && !auds.includes(process.env.WORKOS_CLIENT_ID || "")) {
    functions.logger.warn(
      `MCP OAuth: token aud [${auds.join(",")}] != resource ${resource}. ` +
        "Add the MCP URL as a Resource Indicator in WorkOS to enable strict audience binding.",
    );
  }

  if (typeof payload.sub !== "string") return {error: "missing_sub"};
  return {sub: payload.sub, email: typeof payload.email === "string" ? payload.email : undefined};
}

/** Look up a WorkOS user's email by id when the access token doesn't carry it. */
export async function fetchWorkOsEmail(userId: string): Promise<string | null> {
  const key = process.env.WORKOS_API_KEY;
  if (!key) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(
      `https://api.workos.com/user_management/users/${encodeURIComponent(userId)}`,
      {headers: {Authorization: `Bearer ${key}`}, signal: controller.signal},
    );
    if (!res.ok) {
      functions.logger.warn(`MCP OAuth: WorkOS user lookup ${res.status}`);
      return null;
    }
    const json = await res.json() as { email?: unknown };
    return typeof json.email === "string" ? json.email : null;
  } catch (err) {
    functions.logger.warn("MCP OAuth: WorkOS user lookup failed:", (err as Error).message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** RFC 9728 Protected Resource Metadata document. */
export function protectedResourceMetadata(): Record<string, unknown> {
  return {
    resource: mcpResourceUrl(),
    authorization_servers: [oauthIssuer()],
    jwks_uri: oauthJwksUri(),
    scopes_supported: ["openid", "profile", "email"],
    bearer_methods_supported: ["header"],
  };
}

/** The PRM discovery URL advertised in the WWW-Authenticate header on 401. */
export function protectedResourceMetadataUrl(): string {
  return `${mcpResourceUrl()}/.well-known/oauth-protected-resource`;
}
