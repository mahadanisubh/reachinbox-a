import { Worker, Job, DelayedError, UnrecoverableError } from 'bullmq';
import { EmailStatus } from '@prisma/client';
import { env } from '../config/env';
import { prisma } from '../db/prisma';
import { createRedisConnection } from '../redis';
import { EMAIL_QUEUE_NAME, EmailJobData, enqueueEmail, getQueue, jobIdFor } from './queue';
import { sendEmail } from '../services/mailer';
import { indexEmail } from '../services/elastic';
import { notifyRateLimitHit } from '../services/notifier';
import {
  checkGlobalHourlyLimit,
  checkSenderHourlyLimit,
  claimSenderSendSlot,
} from '../services/rateLimit';

let worker: Worker<EmailJobData> | null = null;

async function processor(job: Job<EmailJobData>, token?: string): Promise<void> {
  const { emailId } = job.data;

  const email = await prisma.email.findUnique({
    where: { id: emailId },
    include: { sender: true },
  });

  if (!email) {
    throw new UnrecoverableError(`Email ${emailId} no longer exists`);
  }

  // Idempotency: never send the same email twice if it is already sent/cancelled.
  if (email.status === EmailStatus.SENT) return;
  if (email.status === EmailStatus.CANCELLED) return;

  const sender = email.sender;
  const now = Date.now();

  // 1) Minimum spacing between sends from the SAME sender.
  const allowedAt = await claimSenderSendSlot(sender.id, env.worker.minDelayMs, now);
  if (allowedAt > now + 25) {
    await job.moveToDelayed(allowedAt, token);
    throw new DelayedError();
  }

  // 2) Per-sender hourly cap (Redis-backed, atomic across workers).
  const senderLimit = sender.hourlyLimit ?? env.worker.maxPerHourPerSender;
  const senderCheck = await checkSenderHourlyLimit(sender.id, senderLimit, now);
  if (!senderCheck.allowed) {
    await notifyRateLimitHit({
      userId: email.userId,
      senderId: sender.id,
      senderEmail: sender.email,
      scope: 'per-sender',
      limit: senderCheck.limit,
      retryAt: senderCheck.retryAt,
    });
    await prisma.email.update({
      where: { id: email.id },
      data: { status: EmailStatus.RATE_LIMITED, error: null },
    });
    await job.moveToDelayed(senderCheck.retryAt, token);
    throw new DelayedError();
  }

  // 3) Optional global hourly cap across all senders.
  const globalCheck = await checkGlobalHourlyLimit(env.worker.maxPerHourGlobal, now);
  if (!globalCheck.allowed) {
    await notifyRateLimitHit({
      userId: email.userId,
      senderId: sender.id,
      senderEmail: sender.email,
      scope: 'global',
      limit: globalCheck.limit,
      retryAt: globalCheck.retryAt,
    });
    await prisma.email.update({
      where: { id: email.id },
      data: { status: EmailStatus.RATE_LIMITED, error: null },
    });
    await job.moveToDelayed(globalCheck.retryAt, token);
    throw new DelayedError();
  }

  // 4) Actually send via (fake) SMTP.
  try {
    const result = await sendEmail(sender, email.toEmail, email.subject, email.body);
    await prisma.email.update({
      where: { id: email.id },
      data: {
        status: EmailStatus.SENT,
        sentAt: new Date(),
        messageId: result.messageId,
        previewUrl: result.previewUrl,
        error: null,
        attempts: job.attemptsMade + 1,
      },
    });
    await indexEmail({
      id: email.id,
      userId: email.userId,
      senderId: sender.id,
      senderEmail: sender.email,
      toEmail: email.toEmail,
      subject: email.subject,
      body: email.body,
      status: EmailStatus.SENT,
      scheduledAt: email.scheduledAt.toISOString(),
      sentAt: new Date().toISOString(),
      createdAt: email.createdAt.toISOString(),
    });
  } catch (err) {
    const attemptsMade = job.attemptsMade + 1;
    const maxAttempts = job.opts.attempts ?? env.worker.maxAttempts;
    const exhausted = attemptsMade >= maxAttempts;
    await prisma.email.update({
      where: { id: email.id },
      data: {
        status: exhausted ? EmailStatus.FAILED : EmailStatus.SCHEDULED,
        attempts: attemptsMade,
        error: (err as Error).message,
      },
    });
    throw err;
  }
}

/**
 * Re-enqueue any emails that should still be pending but have no job in Redis.
 * Combined with deterministic job ids this is idempotent: a job that already
 * exists (e.g. survived a restart) is left untouched, and one that was lost is
 * recreated so future sends are neither skipped nor duplicated.
 */
export async function reconcilePendingEmails(): Promise<number> {
  const pending = await prisma.email.findMany({
    where: { status: { in: [EmailStatus.SCHEDULED, EmailStatus.RATE_LIMITED] } },
    select: { id: true, senderId: true, userId: true, toEmail: true, subject: true, scheduledAt: true },
  });

  let restored = 0;
  for (const email of pending) {
    const queue = getQueue();
    const existing = await queue.getJob(jobIdFor(email.id));
    if (existing) continue;
    const delay = Math.max(0, email.scheduledAt.getTime() - Date.now());
    await enqueueEmail(
      {
        emailId: email.id,
        senderId: email.senderId,
        userId: email.userId,
        toEmail: email.toEmail,
        subject: email.subject,
        scheduledAt: email.scheduledAt.toISOString(),
      },
      delay,
    );
    restored += 1;
  }
  if (restored > 0) console.log(`[worker] reconciled ${restored} pending email(s) into the queue`);
  else console.log('[worker] reconciliation complete (no missing jobs)');
  return restored;
}

export function startWorker(): Worker<EmailJobData> {
  if (worker) return worker;

  const connection = createRedisConnection('worker');
  worker = new Worker<EmailJobData>(EMAIL_QUEUE_NAME, processor, {
    connection,
    concurrency: env.worker.concurrency,
    limiter:
      env.worker.limiterMax > 0
        ? { max: env.worker.limiterMax, duration: env.worker.limiterDurationMs }
        : undefined,
  });

  worker.on('completed', (job) => console.log(`[worker] job ${job.id} completed`));
  worker.on('failed', (job, err) =>
    console.warn(`[worker] job ${job?.id} failed: ${err.message}`),
  );
  worker.on('error', (err) => console.error('[worker] error:', err.message));

  console.log(
    `[worker] started (concurrency=${env.worker.concurrency}, minDelay=${env.worker.minDelayMs}ms, perSenderPerHour=${env.worker.maxPerHourPerSender})`,
  );

  void reconcilePendingEmails().catch((err) =>
    console.error('[worker] reconcile failed:', err.message),
  );

  return worker;
}

export async function stopWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
  }
}

if (require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('../lib/dns').installDnsFallback();
  startWorker();
  const shutdown = async () => {
    console.log('[worker] shutting down...');
    await stopWorker();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
