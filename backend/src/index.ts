import { env } from './config/env';
import { installDnsFallback } from './lib/dns';
import { createApp } from './app';
import { prisma } from './db/prisma';
import { disconnectRedis } from './redis';
import { closeQueue, getQueue } from './queue/queue';
import { startWorker, stopWorker } from './queue/worker';
import { ensureIndex } from './services/elastic';

async function main(): Promise<void> {
  installDnsFallback();

  // Touch the queue early so misconfiguration fails fast.
  getQueue();

  await ensureIndex();

  const app = createApp();
  const server = app.listen(env.port, () => {
    console.log(`[api] listening on ${env.apiPublicUrl} (port ${env.port})`);
  });

  startWorker();

  const shutdown = async (signal: string) => {
    console.log(`[api] ${signal} received, shutting down...`);
    server.close();
    await stopWorker();
    await closeQueue();
    await disconnectRedis();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[api] fatal startup error:', err);
  process.exit(1);
});
