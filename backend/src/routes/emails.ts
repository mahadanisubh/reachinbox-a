import { Router, Response } from 'express';
import { z } from 'zod';
import { createHash } from 'crypto';
import { EmailStatus, Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import { AuthedRequest, requireAuth } from '../middleware/auth';
import { HttpError } from '../middleware/error';
import { enqueueEmail, getQueue, jobIdFor } from '../queue/queue';
import { indexEmail, searchEmails } from '../services/elastic';

export const emailsRouter = Router();

emailsRouter.use(requireAuth);

const scheduleSchema = z.object({
  senderId: z.string().min(1),
  subject: z.string().min(1).max(300),
  body: z.string().min(1),
  recipients: z.array(z.string().email()).min(1).max(5000),
  startTime: z.string().datetime().optional(),
  scheduledAt: z.string().datetime().optional(),
  delaySeconds: z.number().int().min(0).max(86400).default(0),
  hourlyLimit: z.number().int().positive().max(100000).optional(),
});

emailsRouter.post('/schedule', async (req: AuthedRequest, res: Response) => {
  const body = scheduleSchema.parse(req.body);
  const userId = req.user!.id;

  const sender = await prisma.sender.findFirst({
    where: { id: body.senderId, userId },
  });
  if (!sender) throw new HttpError(404, 'Sender not found');

  const startMs = new Date(body.startTime ?? body.scheduledAt ?? Date.now()).getTime();
  const baseMs = Math.max(startMs, Date.now());
  const recipients = Array.from(new Set(body.recipients.map((r) => r.toLowerCase())));

  if (body.hourlyLimit && sender.hourlyLimit !== body.hourlyLimit) {
    await prisma.sender.update({
      where: { id: sender.id },
      data: { hourlyLimit: body.hourlyLimit },
    });
  }

  const created: string[] = [];
  let duplicates = 0;

  for (let i = 0; i < recipients.length; i += 1) {
    const toEmail = recipients[i];
    const scheduledAt = new Date(baseMs + i * body.delaySeconds * 1000);
    const idempotencyKey = createHash('sha256')
      .update([userId, sender.id, toEmail, body.subject, scheduledAt.toISOString()].join('|'))
      .digest('hex');

    try {
      const email = await prisma.email.create({
        data: {
          userId,
          senderId: sender.id,
          toEmail,
          subject: body.subject,
          body: body.body,
          scheduledAt,
          status: EmailStatus.SCHEDULED,
          idempotencyKey,
        },
      });
      const jobId = await enqueueEmail(
        {
          emailId: email.id,
          senderId: sender.id,
          userId,
          toEmail,
          subject: body.subject,
          scheduledAt: scheduledAt.toISOString(),
        },
        scheduledAt.getTime() - Date.now(),
      );
      await prisma.email.update({ where: { id: email.id }, data: { bullJobId: jobId } });
      // Fire-and-forget: indexing must never slow down (or fail) scheduling.
      void indexEmail({
        id: email.id,
        userId,
        senderId: sender.id,
        senderEmail: sender.email,
        toEmail,
        subject: body.subject,
        body: body.body,
        status: EmailStatus.SCHEDULED,
        scheduledAt: scheduledAt.toISOString(),
        createdAt: email.createdAt.toISOString(),
      });
      created.push(email.id);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        duplicates += 1;
        continue;
      }
      throw err;
    }
  }

  res.status(201).json({
    scheduled: created.length,
    duplicatesSkipped: duplicates,
    totalRecipients: recipients.length,
    emailIds: created,
  });
});

const SORT_FIELDS = ['scheduledAt', 'sentAt', 'toEmail', 'subject', 'status', 'createdAt'] as const;

const listQuerySchema = z.object({
  tab: z.enum(['scheduled', 'sent', 'all']).default('all'),
  search: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  senderId: z.string().min(1).optional(),
  status: z
    .enum(['SCHEDULED', 'SENT', 'FAILED', 'RATE_LIMITED', 'CANCELLED'])
    .optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  sortBy: z.enum(SORT_FIELDS).default('scheduledAt'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});

function tabStatuses(tab: 'scheduled' | 'sent' | 'all'): EmailStatus[] {
  if (tab === 'scheduled') return [EmailStatus.SCHEDULED, EmailStatus.RATE_LIMITED];
  if (tab === 'sent') return [EmailStatus.SENT, EmailStatus.FAILED];
  return [
    EmailStatus.SCHEDULED,
    EmailStatus.RATE_LIMITED,
    EmailStatus.SENT,
    EmailStatus.FAILED,
    EmailStatus.CANCELLED,
  ];
}

emailsRouter.get('/', async (req: AuthedRequest, res: Response) => {
  const q = listQuerySchema.parse(req.query);
  const userId = req.user!.id;

  // Status filter must stay within what the tab represents.
  const allowed = tabStatuses(q.tab);
  const statusFilter =
    q.status && allowed.includes(q.status as EmailStatus)
      ? [q.status as EmailStatus]
      : allowed;

  const where: Prisma.EmailWhereInput = { userId, status: { in: statusFilter } };

  if (q.senderId) where.senderId = q.senderId;
  if (q.from || q.to) {
    where.scheduledAt = {
      ...(q.from ? { gte: new Date(q.from) } : {}),
      ...(q.to ? { lte: new Date(q.to) } : {}),
    };
  }

  // Elasticsearch resolves free-text search to a set of ids; filtering, sorting
  // and pagination then happen consistently in Postgres.
  let source: 'elasticsearch' | 'postgres' = 'postgres';
  if (q.search) {
    let ids: string[] | null = null;
    try {
      ids = (await searchEmails({ userId, query: q.search, from: 0, size: 1000 })).ids;
    } catch {
      ids = null;
    }
    if (ids && ids.length > 0) {
      where.id = { in: ids };
      source = 'elasticsearch';
    } else {
      // ES empty (refresh latency) or unavailable - fall back to a DB text match.
      where.OR = [
        { toEmail: { contains: q.search, mode: 'insensitive' } },
        { subject: { contains: q.search, mode: 'insensitive' } },
      ];
    }
  }

  const orderBy = { [q.sortBy]: q.sortDir } as Prisma.EmailOrderByWithRelationInput;

  const [items, count] = await Promise.all([
    prisma.email.findMany({
      where,
      include: { sender: { select: { name: true, email: true } } },
      orderBy,
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    prisma.email.count({ where }),
  ]);

  res.json({
    items: items.map(mapEmail),
    total: count,
    page: q.page,
    pageSize: q.pageSize,
    source,
  });
});

emailsRouter.get('/stats', async (req: AuthedRequest, res: Response) => {
  const userId = req.user!.id;

  const [grouped, next] = await Promise.all([
    prisma.email.groupBy({
      by: ['status'],
      where: { userId },
      _count: { _all: true },
    }),
    prisma.email.findFirst({
      where: {
        userId,
        status: { in: [EmailStatus.SCHEDULED, EmailStatus.RATE_LIMITED] },
        scheduledAt: { gte: new Date() },
      },
      orderBy: { scheduledAt: 'asc' },
      select: { scheduledAt: true },
    }),
  ]);

  const counts: Partial<Record<EmailStatus, number>> = {};
  let total = 0;
  for (const g of grouped) {
    counts[g.status] = g._count._all;
    total += g._count._all;
  }

  res.json({
    scheduled: counts[EmailStatus.SCHEDULED] ?? 0,
    rateLimited: counts[EmailStatus.RATE_LIMITED] ?? 0,
    sent: counts[EmailStatus.SENT] ?? 0,
    failed: counts[EmailStatus.FAILED] ?? 0,
    cancelled: counts[EmailStatus.CANCELLED] ?? 0,
    total,
    nextSendAt: next?.scheduledAt ?? null,
  });
});

emailsRouter.delete('/:id', async (req: AuthedRequest, res: Response) => {
  const email = await prisma.email.findFirst({
    where: { id: req.params.id, userId: req.user!.id },
  });
  if (!email) throw new HttpError(404, 'Email not found');
  if (email.status === EmailStatus.SENT) {
    throw new HttpError(409, 'Cannot cancel an email that was already sent');
  }
  const job = await getQueue().getJob(jobIdFor(email.id));
  await job?.remove().catch(() => undefined);
  await prisma.email.update({
    where: { id: email.id },
    data: { status: EmailStatus.CANCELLED },
  });
  res.json({ ok: true });
});

function mapEmail(email: {
  id: string;
  toEmail: string;
  subject: string;
  status: EmailStatus;
  scheduledAt: Date;
  sentAt: Date | null;
  attempts: number;
  error: string | null;
  previewUrl: string | null;
  createdAt: Date;
  sender?: { name: string; email: string } | null;
}) {
  return {
    id: email.id,
    toEmail: email.toEmail,
    subject: email.subject,
    status: email.status,
    scheduledAt: email.scheduledAt,
    sentAt: email.sentAt,
    attempts: email.attempts,
    error: email.error,
    previewUrl: email.previewUrl,
    createdAt: email.createdAt,
    sender: email.sender
      ? { name: email.sender.name, email: email.sender.email }
      : undefined,
  };
}
