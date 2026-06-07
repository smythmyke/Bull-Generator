import * as admin from "firebase-admin";
import { verifySlackSignature } from "./verify";

interface ReqLike {
  rawBody: Buffer | string;
  body: Record<string, unknown>;
  headers: Record<string, string | string[] | undefined>;
}

interface ResLike {
  status: (code: number) => { json: (data: unknown) => void; send: (body: string) => void };
}

/**
 * Slack Events API webhook. POST /slackBot/events.
 *
 * Handles:
 *   - `url_verification` — initial subscribe handshake; we echo the challenge.
 *   - `event_callback` with `event.type === "app_uninstalled"` — workspace
 *     removed the app. We revoke the linked API key and mark the install
 *     record as revoked so stale state doesn't accumulate.
 *
 * Signature-verified the same way as slash commands.
 */
export async function handleSlackEvent(req: ReqLike, res: ResLike): Promise<void> {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) {
    res.status(500).json({ error: "Slack integration not configured." });
    return;
  }

  const rawBody = typeof req.rawBody === "string" ? req.rawBody : req.rawBody.toString("utf8");
  const sig = pickHeader(req.headers, "x-slack-signature");
  const ts = pickHeader(req.headers, "x-slack-request-timestamp");
  if (!verifySlackSignature(rawBody, sig, ts, signingSecret)) {
    res.status(401).json({ error: "Invalid Slack signature." });
    return;
  }

  const body = req.body as { type?: string; challenge?: string; event?: { type?: string }; team_id?: string };

  // Initial endpoint verification when Slack first turns on event subscriptions.
  if (body.type === "url_verification") {
    res.status(200).json({ challenge: body.challenge });
    return;
  }

  if (body.type === "event_callback" && body.event?.type === "app_uninstalled") {
    const teamId = body.team_id;
    if (teamId) {
      console.log("[slack/events] app_uninstalled", { teamId });
      await revokeInstall(teamId);
    } else {
      console.warn("[slack/events] app_uninstalled missing team_id");
    }
    res.status(200).send("");
    return;
  }

  // Unknown / unhandled event — ack so Slack doesn't retry.
  res.status(200).send("");
}

async function revokeInstall(teamId: string): Promise<void> {
  const db = admin.firestore();
  const installRef = db.collection("slackInstalls").doc(teamId);
  const installSnap = await installRef.get();
  if (!installSnap.exists) {
    console.warn("[slack/events] no install doc to revoke", { teamId });
    return;
  }
  const data = installSnap.data() as { apiKeyId?: string; revokedAt?: unknown };
  if (data.revokedAt) {
    console.log("[slack/events] install already revoked", { teamId });
    return;
  }
  const now = admin.firestore.FieldValue.serverTimestamp();

  // Revoke the linked API key first so any in-flight slash commands stop
  // working. Then mark the install doc.
  if (data.apiKeyId) {
    await db.collection("apiKeys").doc(data.apiKeyId).update({ revokedAt: now }).catch((e) => {
      console.error("[slack/events] apiKey revoke failed", { teamId, apiKeyId: data.apiKeyId, error: e?.message });
    });
  }
  await installRef.update({ revokedAt: now });
  console.log("[slack/events] install revoked", { teamId, apiKeyId: data.apiKeyId });
}

function pickHeader(
  headers: Record<string, string | string[] | undefined>,
  key: string
): string | undefined {
  const v = headers[key] ?? headers[key.toLowerCase()];
  if (Array.isArray(v)) return v[0];
  return v;
}
