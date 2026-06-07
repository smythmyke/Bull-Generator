import * as admin from "firebase-admin";
import * as crypto from "crypto";
import * as functions from "firebase-functions";
import { oauthV2Access } from "./client";
import { generateRawApiKey, hashApiKey, keyPrefixForDisplay } from "../auth";
import { DEFAULT_SCOPES } from "../keys";
import { SlackInstallDoc } from "./types";

const SESSION_TTL_MS = 10 * 60 * 1000;
const SLACK_SCOPES = "commands,chat:write";
const REDIRECT_URI =
  "https://us-central1-solicitation-matcher-extension.cloudfunctions.net/slackBot/install/callback";

/**
 * Step 1 of the install dance.
 * Creates a short-lived install session keyed to a Firebase uid and returns
 * the Slack OAuth URL the user clicks to authorize the workspace.
 */
export async function beginInstall(
  uid: string
): Promise<{ sessionId: string; expiresAt: string; slackOauthUrl: string }> {
  const clientId = process.env.SLACK_CLIENT_ID;
  if (!clientId) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Slack OAuth not configured (SLACK_CLIENT_ID missing)"
    );
  }

  const sessionId = crypto.randomBytes(24).toString("base64url");
  const expiresAt = admin.firestore.Timestamp.fromMillis(Date.now() + SESSION_TTL_MS);
  const db = admin.firestore();
  await db.collection("slackInstallSessions").doc(sessionId).set({
    uid,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt,
  });

  const params = new URLSearchParams({
    client_id: clientId,
    scope: SLACK_SCOPES,
    redirect_uri: REDIRECT_URI,
    state: sessionId,
  });
  const slackOauthUrl = `https://slack.com/oauth/v2/authorize?${params}`;

  return {
    sessionId,
    expiresAt: expiresAt.toDate().toISOString(),
    slackOauthUrl,
  };
}

/**
 * Status check for the signed-in user — returns whether they have any active
 * Slack installs. Used by the extension's Admin tab.
 */
export async function getInstallStatus(
  uid: string
): Promise<{
  connected: boolean;
  installs: Array<{ teamId: string; teamName: string; installedAt: string | null }>;
}> {
  const db = admin.firestore();
  const snap = await db
    .collection("slackInstalls")
    .where("linkedUserUid", "==", uid)
    .where("revokedAt", "==", null)
    .limit(10)
    .get();

  const installs = snap.docs.map((doc) => {
    const data = doc.data();
    const ts = data.installedAt as admin.firestore.Timestamp | undefined;
    return {
      teamId: data.teamId,
      teamName: data.teamName,
      installedAt: ts && ts.toDate ? ts.toDate().toISOString() : null,
    };
  });
  return { connected: installs.length > 0, installs };
}

/**
 * Step 2: Slack OAuth redirect (GET) with code + state.
 * Exchanges the code for a bot token, mints a Bull-Generator API key for the
 * authenticated user, and persists the install doc.
 */
export async function completeInstall(
  code: string,
  state: string
): Promise<{ teamId: string; teamName: string; uid: string }> {
  const clientId = process.env.SLACK_CLIENT_ID;
  const clientSecret = process.env.SLACK_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Slack OAuth not configured (SLACK_CLIENT_ID / SLACK_CLIENT_SECRET missing)"
    );
  }

  const db = admin.firestore();
  const sessionRef = db.collection("slackInstallSessions").doc(state);
  const sessionSnap = await sessionRef.get();
  if (!sessionSnap.exists) {
    throw new functions.https.HttpsError("invalid-argument", "Invalid or expired install session");
  }
  const session = sessionSnap.data() as { uid: string; expiresAt: admin.firestore.Timestamp };
  if (session.expiresAt.toMillis() < Date.now()) {
    await sessionRef.delete().catch(() => {});
    throw new functions.https.HttpsError("invalid-argument", "Install session expired");
  }
  const uid = session.uid;

  const oauth = await oauthV2Access({ clientId, clientSecret, code, redirectUri: REDIRECT_URI });
  if (!oauth.ok || !oauth.access_token || !oauth.team) {
    throw new functions.https.HttpsError(
      "permission-denied",
      `Slack OAuth exchange failed: ${oauth.error ?? "unknown"}`
    );
  }

  const teamId = oauth.team.id;
  const teamName = oauth.team.name;
  const botToken = oauth.access_token;
  const botUserId = oauth.bot_user_id ?? "";
  const installedBySlackUserId = oauth.authed_user?.id ?? "";
  const scopes = (oauth.scope ?? "").split(",").filter(Boolean);

  // Mint a Bull-Generator API key for this install. Reuses existing apiKeys schema.
  const rawKey = generateRawApiKey("live");
  const keyHash = hashApiKey(rawKey);
  const prefix = keyPrefixForDisplay(rawKey);
  const apiKeyRef = db.collection("apiKeys").doc();
  await apiKeyRef.set({
    uid,
    name: `Slack: ${teamName}`,
    keyHash,
    prefix,
    environment: "live",
    scopes: DEFAULT_SCOPES,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    lastUsedAt: null,
    revokedAt: null,
  });

  // Upsert install doc. Re-install replaces the old bot token (Slack revokes it).
  const installRef = db.collection("slackInstalls").doc(teamId);
  const installDoc: Partial<SlackInstallDoc> = {
    teamId,
    teamName,
    botToken,
    botUserId,
    installedBySlackUserId,
    linkedUserUid: uid,
    apiKeyId: apiKeyRef.id,
    scopes,
    installedAt: admin.firestore.FieldValue.serverTimestamp(),
    lastUsedAt: null,
    revokedAt: null,
  };
  await installRef.set(installDoc, { merge: false });

  // Burn the install session so it can't be replayed.
  await sessionRef.delete().catch(() => {});

  return { teamId, teamName, uid };
}

export async function getActiveInstall(
  teamId: string
): Promise<SlackInstallDoc | null> {
  const db = admin.firestore();
  const snap = await db.collection("slackInstalls").doc(teamId).get();
  if (!snap.exists) return null;
  const data = snap.data() as SlackInstallDoc;
  if (data.revokedAt) return null;
  return data;
}

export async function touchInstallLastUsed(teamId: string): Promise<void> {
  const db = admin.firestore();
  await db
    .collection("slackInstalls")
    .doc(teamId)
    .update({ lastUsedAt: admin.firestore.FieldValue.serverTimestamp() })
    .catch(() => {});
}
