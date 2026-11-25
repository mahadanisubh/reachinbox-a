import { redis } from '../redis';

const HOUR_MS = 60 * 60 * 1000;

/**
 * Atomically reserve one send slot for `senderId` in the current hour window.
 *
 * Safe across any number of workers/instances because the check+increment
 * happens inside a single Redis script. Returns the new count, or -1 when the
 * hourly limit is already reached.
 */
const ACQUIRE_HOURLY = `
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
local limit = tonumber(ARGV[1])
if current >= limit then
  return -1
end
local next = redis.call('INCR', KEYS[1])
if next == 1 then
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2]))
end
return next
`;

/**
 * Atomically claim the right to send now for `senderId`, enforcing a minimum
 * spacing between sends from the same sender.
 *
 * Returns the epoch-ms at which this sender is next allowed to send. If the
 * returned value is greater than `now`, the caller must wait/delay until then.
 */
const CLAIM_SEND_SLOT = `
local next_at = tonumber(redis.call('GET', KEYS[1]) or '0')
local now = tonumber(ARGV[1])
local delay = tonumber(ARGV[2])
if next_at > now then
  return next_at
end
redis.call('SET', KEYS[1], now + delay, 'PX', delay + 1000)
return now
`;

redis.defineCommand('rsAcquireHourly', { numberOfKeys: 1, lua: ACQUIRE_HOURLY });
redis.defineCommand('rsClaimSendSlot', { numberOfKeys: 1, lua: CLAIM_SEND_SLOT });

declare module 'ioredis' {
  interface RedisCommander<Context> {
    rsAcquireHourly(key: string, limit: string, ttlSeconds: string): Promise<number>;
    rsClaimSendSlot(key: string, nowMs: string, delayMs: string): Promise<number>;
  }
}

export function hourWindowStart(now = Date.now()): number {
  return Math.floor(now / HOUR_MS) * HOUR_MS;
}

function secondsUntilWindowEnd(windowStart: number, now: number): number {
  // +60s buffer so the key outlives the window edge deterministically.
  return Math.ceil((windowStart + HOUR_MS - now) / 1000) + 60;
}

export interface RateCheckResult {
  allowed: boolean;
  /** When not allowed, the epoch-ms of the next hour window to retry in. */
  retryAt: number;
  count: number;
  limit: number;
}

/**
 * Enforce the per-sender hourly limit (Redis-backed, atomic).
 * Configurable via MAX_EMAILS_PER_HOUR_PER_SENDER; a sender can override it
 * through its own `hourlyLimit` column.
 */
export async function checkSenderHourlyLimit(
  senderId: string,
  limit: number,
  now = Date.now(),
): Promise<RateCheckResult> {
  const windowStart = hourWindowStart(now);
  const key = `rl:sender:${senderId}:${windowStart}`;
  const ttl = secondsUntilWindowEnd(windowStart, now);
  const count = await redis.rsAcquireHourly(key, String(limit), String(ttl));

  if (count === -1) {
    return { allowed: false, retryAt: windowStart + HOUR_MS, count: limit, limit };
  }
  return { allowed: true, retryAt: now, count, limit };
}

/** Global hourly cap across every sender (disabled when limit <= 0). */
export async function checkGlobalHourlyLimit(
  limit: number,
  now = Date.now(),
): Promise<RateCheckResult> {
  if (limit <= 0) return { allowed: true, retryAt: now, count: 0, limit: 0 };
  const windowStart = hourWindowStart(now);
  const key = `rl:global:${windowStart}`;
  const ttl = secondsUntilWindowEnd(windowStart, now);
  const count = await redis.rsAcquireHourly(key, String(limit), String(ttl));
  if (count === -1) {
    return { allowed: false, retryAt: windowStart + HOUR_MS, count: limit, limit };
  }
  return { allowed: true, retryAt: now, count, limit };
}

/**
 * Enforce the minimum delay between two consecutive sends from the same sender.
 * Returns the epoch-ms at which this sender may send next.
 */
export async function claimSenderSendSlot(
  senderId: string,
  minDelayMs: number,
  now = Date.now(),
): Promise<number> {
  if (minDelayMs <= 0) return now;
  return redis.rsClaimSendSlot(`throttle:sender:${senderId}`, String(now), String(minDelayMs));
}

/**
 * Returns true only for the first caller within the hour window. Used to make
 * sure we fire exactly one Slack alert per sender per hour on rate-limit hits.
 */
export async function claimSlackNotification(
  senderId: string,
  now = Date.now(),
): Promise<boolean> {
  const windowStart = hourWindowStart(now);
  const ttl = secondsUntilWindowEnd(windowStart, now);
  const res = await redis.set(`slack:rl:${senderId}:${windowStart}`, '1', 'EX', ttl, 'NX');
  return res === 'OK';
}
