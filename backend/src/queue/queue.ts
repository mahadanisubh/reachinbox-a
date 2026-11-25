import { Queue, JobsOptions } from 'bullmq';
import { Redis } from 'ioredis';
import { env } from '../config/env';
import { createRedisConnection } from '../redis';

export const EMAIL_QUEUE_NAME = 'emails';

/**
 * Deterministic job id for an email. BullMQ custom ids may not contain ":".
 * Being deterministic means re-enqueueing the same email is a no-op.
 */
export function jobIdFor(emailId: string): string {
  return `email-${emailId}`;
}

export interface EmailJobData {
  emailId: string;
  senderId: string;
  userId: string;
  toEmail: string;
  subject: string;
  scheduledAt: string;
}

const defaultJobOptions: JobsOptions = {
  attempts: env.worker.maxAttempts,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: { age: 3600, count: 5000 },
  removeOnFail: { age: 24 * 3600 },
};

let queue: Queue<EmailJobData> | null = null;
let queueConnection: Redis | null = null;

export function getQueue(): Queue<EmailJobData> {
  if (!queue) {
    queueConnection = createRedisConnection('queue');
    queue = new Queue<EmailJobData>(EMAIL_QUEUE_NAME, {
      connection: queueConnection,
      defaultJobOptions,
    });
  }
  return queue;
}

/**
 * Enqueue an email as a BullMQ delayed job.
 *
 * The job id is deterministic, so re-enqueueing the same email never creates a
 * duplicate job - this is how we guarantee idempotency across restarts/retries.
 */
export async function enqueueEmail(
  data: EmailJobData,
  delayMs: number,
): Promise<string> {
  const jobId = jobIdFor(data.emailId);
  const job = await getQueue().add('send-email', data, {
    jobId,
    delay: Math.max(0, delayMs),
  });
  return job.id ?? jobId;
}

export async function closeQueue(): Promise<void> {
  if (queue) {
    await queue.close();
    queue = null;
  }
  if (queueConnection) {
    await queueConnection.quit().catch(() => undefined);
    queueConnection = null;
  }
}
