import { SlackOauthV2Response } from "./types";

const SLACK_API = "https://slack.com/api";
const USER_AGENT = "patent-search-slack/0.1.0";

export async function oauthV2Access(params: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}): Promise<SlackOauthV2Response> {
  const body = new URLSearchParams({
    client_id: params.clientId,
    client_secret: params.clientSecret,
    code: params.code,
    redirect_uri: params.redirectUri,
  });
  const res = await fetch(`${SLACK_API}/oauth.v2.access`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": USER_AGENT,
    },
    body: body.toString(),
  });
  return (await res.json()) as SlackOauthV2Response;
}

async function slackPost<T>(
  method: string,
  token: string,
  body: Record<string, unknown>
): Promise<T> {
  const res = await fetch(`${SLACK_API}/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
      "User-Agent": USER_AGENT,
    },
    body: JSON.stringify(body),
  });
  return (await res.json()) as T;
}

export async function chatPostMessage(
  token: string,
  channel: string,
  text: string,
  opts: { thread_ts?: string; blocks?: unknown[] } = {}
): Promise<{ ok: boolean; ts?: string; error?: string }> {
  return slackPost("chat.postMessage", token, { channel, text, ...opts });
}

export async function chatPostEphemeral(
  token: string,
  channel: string,
  user: string,
  text: string,
  opts: { blocks?: unknown[] } = {}
): Promise<{ ok: boolean; error?: string }> {
  return slackPost("chat.postEphemeral", token, { channel, user, text, ...opts });
}

export async function postResponseUrl(
  responseUrl: string,
  payload: { text?: string; blocks?: unknown[]; response_type?: "ephemeral" | "in_channel"; replace_original?: boolean }
): Promise<void> {
  await fetch(responseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "User-Agent": USER_AGENT,
    },
    body: JSON.stringify(payload),
  });
}
