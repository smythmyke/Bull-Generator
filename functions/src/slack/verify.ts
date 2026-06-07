import * as crypto from "crypto";

const MAX_AGE_SECONDS = 60 * 5;

/**
 * Verify Slack's request signature.
 * https://api.slack.com/authentication/verifying-requests-from-slack
 *
 * Slack signs each request with:
 *   X-Slack-Signature: v0=<hex hmac-sha256>
 *   X-Slack-Request-Timestamp: <unix seconds>
 * The HMAC is computed over `v0:{timestamp}:{rawBody}` using the signing secret.
 * Requests older than 5 minutes are rejected to prevent replay.
 */
export function verifySlackSignature(
  rawBody: string,
  signature: string | undefined,
  timestamp: string | undefined,
  signingSecret: string
): boolean {
  if (!signature || !timestamp) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > MAX_AGE_SECONDS) return false;

  const baseString = `v0:${timestamp}:${rawBody}`;
  const expected = "v0=" + crypto
    .createHmac("sha256", signingSecret)
    .update(baseString)
    .digest("hex");

  const supplied = Buffer.from(signature);
  const computed = Buffer.from(expected);
  if (supplied.length !== computed.length) return false;
  return crypto.timingSafeEqual(supplied, computed);
}
