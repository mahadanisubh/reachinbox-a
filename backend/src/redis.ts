import IORedis, { Redis } from 'ioredis';
import { env } from './config/env';

export function createRedisConnection(label = 'redis'): Redis {
  const client = new IORedis(env.redisUrl, {
    // Required by BullMQ for blocking connections.
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: false,
  });
  client.on('error', (err) => {
    console.error(`[${label}] error:`, err.message);
  });
  return client;
}

// Shared app-level connection (rate-limit counters, locks, dedupe flags).
export const redis = createRedisConnection('redis');

export async function disconnectRedis(): Promise<void> {
  await redis.quit().catch(() => undefined);
}
