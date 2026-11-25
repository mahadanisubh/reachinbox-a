import { Sender } from '@prisma/client';
import { env } from '../config/env';
import { prisma } from '../db/prisma';
import { createEtherealAccount } from './mailer';

export interface CreateSenderInput {
  name: string;
  email?: string;
  hourlyLimit?: number | null;
}

/**
 * Create a sender. If no SMTP credentials are supplied we mint an ephemeral
 * Ethereal (fake SMTP) account so the sender is immediately usable.
 */
export async function createSender(userId: string, input: CreateSenderInput): Promise<Sender> {
  const ethereal = await createEtherealAccount(input.name);
  return prisma.sender.create({
    data: {
      userId,
      name: input.name,
      email: input.email ?? ethereal.email,
      smtpHost: env.ethereal.user ? env.ethereal.host : ethereal.host,
      smtpPort: env.ethereal.user ? env.ethereal.port : ethereal.port,
      smtpSecure: false,
      smtpUser: env.ethereal.user ?? ethereal.user,
      smtpPass: env.ethereal.pass ?? ethereal.pass,
      hourlyLimit: input.hourlyLimit ?? null,
    },
  });
}

/**
 * Give a user at least one sender so the "from" picker is never empty.
 * No-op if the user already has one. Returns the sender created, if any.
 */
export async function ensureDefaultSender(userId: string, name = 'Default Sender'): Promise<Sender | null> {
  const count = await prisma.sender.count({ where: { userId } });
  if (count > 0) return null;
  return createSender(userId, { name });
}
