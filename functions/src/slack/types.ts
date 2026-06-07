import * as admin from "firebase-admin";

export interface SlackInstallDoc {
  teamId: string;
  teamName: string;
  botToken: string;
  botUserId: string;
  installedBySlackUserId: string;
  linkedUserUid: string;
  apiKeyId: string;
  scopes: string[];
  installedAt: admin.firestore.FieldValue | admin.firestore.Timestamp;
  lastUsedAt: admin.firestore.Timestamp | null;
  revokedAt: admin.firestore.Timestamp | null;
}

export interface SlackOauthV2Response {
  ok: boolean;
  error?: string;
  app_id?: string;
  authed_user?: { id: string };
  scope?: string;
  token_type?: string;
  access_token?: string;
  bot_user_id?: string;
  team?: { id: string; name: string };
  enterprise?: { id: string; name: string } | null;
}

export interface SlackSlashCommandBody {
  token?: string;
  team_id: string;
  team_domain?: string;
  channel_id: string;
  channel_name?: string;
  user_id: string;
  user_name?: string;
  command: string;
  text: string;
  response_url: string;
  trigger_id?: string;
}
