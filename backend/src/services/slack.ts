import axios from 'axios';
import { env } from '../config/env';

const SLACK_API = 'https://slack.com/api';
// NOTE: the user-facing authorize endpoint is /oauth/v2/authorize (NOT /api/...).
// Token exchange uses the Web API base (/api/oauth.v2.access).
const SLACK_AUTHORIZE_URL = 'https://slack.com/oauth/v2/authorize';

export const SLACK_SCOPES = ['chat:write', 'incoming-webhook', 'channels:read'].join(',');

export function buildAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: env.slack.clientId ?? '',
    scope: SLACK_SCOPES,
    redirect_uri: env.slack.redirectUri,
    state,
  });
  return `${SLACK_AUTHORIZE_URL}?${params.toString()}`;
}

export interface SlackOAuthResult {
  botToken: string;
  teamId: string | null;
  teamName: string | null;
  channelId: string;
  channelName: string | null;
  incomingWebhookUrl: string | null;
}

export async function exchangeCode(code: string): Promise<SlackOAuthResult> {
  const { data } = await axios.post(
    `${SLACK_API}/oauth.v2.access`,
    new URLSearchParams({
      client_id: env.slack.clientId ?? '',
      client_secret: env.slack.clientSecret ?? '',
      code,
      redirect_uri: env.slack.redirectUri,
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
  );

  if (!data.ok) {
    throw new Error(`Slack OAuth failed: ${data.error ?? 'unknown_error'}`);
  }

  const channelId: string | undefined =
    data.incoming_webhook?.channel_id ?? data.authed_user?.id;

  if (!data.access_token || !channelId) {
    throw new Error('Slack OAuth response missing bot token or channel');
  }

  return {
    botToken: data.access_token,
    teamId: data.team?.id ?? null,
    teamName: data.team?.name ?? null,
    channelId,
    channelName: data.incoming_webhook?.channel ?? null,
    incomingWebhookUrl: data.incoming_webhook?.url ?? null,
  };
}

export async function postMessage(
  botToken: string,
  channel: string,
  text: string,
): Promise<void> {
  const { data } = await axios.post(
    `${SLACK_API}/chat.postMessage`,
    { channel, text },
    { headers: { Authorization: `Bearer ${botToken}`, 'Content-Type': 'application/json; charset=utf-8' } },
  );
  if (!data.ok) {
    const reason = data.error ?? 'unknown_error';
    const hint =
      reason === 'messages_tab_disabled'
        ? ' (enable the Messages tab in your Slack app, or install the app to a public channel)'
        : '';
    throw new Error(`Slack chat.postMessage failed: ${reason}${hint}`);
  }
}

export interface SlackTarget {
  botToken: string;
  channelId: string;
  incomingWebhookUrl?: string | null;
}

/**
 * Deliver a Slack message to a stored connection.
 *
 * Prefers the incoming webhook URL (works regardless of the app's Messages tab
 * setting), and falls back to the bot token + chat.postMessage.
 */
export async function deliver(target: SlackTarget, text: string): Promise<void> {
  if (target.incomingWebhookUrl) {
    try {
      const { data } = await axios.post(
        target.incomingWebhookUrl,
        { text },
        { headers: { 'Content-Type': 'application/json; charset=utf-8' } },
      );
      if (typeof data === 'string' && !data.startsWith('ok')) {
        throw new Error(`webhook response: ${data}`);
      }
      return;
    } catch (err) {
      console.warn(`[slack] incoming webhook failed (${(err as Error).message}), falling back to chat.postMessage`);
    }
  }
  await postMessage(target.botToken, target.channelId, text);
}
