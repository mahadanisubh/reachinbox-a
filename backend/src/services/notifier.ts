import { prisma } from '../db/prisma';
import { deliver } from './slack';
import { claimSlackNotification } from './rateLimit';

export interface RateLimitEvent {
  userId: string;
  senderId: string;
  senderEmail: string;
  scope: 'per-sender' | 'global';
  limit: number;
  retryAt: number;
}

/**
 * Fire a Slack alert when a sender hits its hourly cap.
 *
 * - If the user has no Slack connection, this is a silent no-op (never throws).
 * - At most one alert per sender per hour window (dedupe via Redis).
 * - Connection is read fresh per event, so connecting Slack later starts
 *   working immediately with no redeploy.
 */
export async function notifyRateLimitHit(event: RateLimitEvent): Promise<void> {
  try {
    const conn = await prisma.slackConnection.findUnique({ where: { userId: event.userId } });
    if (!conn) return;

    const isFirstThisWindow = await claimSlackNotification(event.senderId);
    if (!isFirstThisWindow) return;

    const scopeLabel =
      event.scope === 'global' ? 'global hourly limit' : 'sender hourly limit';
    const retryIso = new Date(event.retryAt).toISOString();
    const text = [
      ':rotating_light: *ReachInbox rate limit hit*',
      `Sender: \`${event.senderEmail}\``,
      `Trigger: ${scopeLabel} of *${event.limit} emails/hour* reached.`,
      `Action: further sends for this sender are deferred to the next window (${retryIso}).`,
      `No emails were dropped — they will resume automatically.`,
    ].join('\n');

    await deliver(conn, text);
    console.log(`[slack] rate-limit alert sent for sender ${event.senderEmail}`);
  } catch (err) {
    console.error('[slack] notify failed:', (err as Error).message);
  }
}
