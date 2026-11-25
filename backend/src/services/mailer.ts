import nodemailer, { Transporter } from 'nodemailer';
import { env } from '../config/env';

export interface SenderAccount {
  id: string;
  name: string;
  email: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPass: string;
}

export interface SendResult {
  messageId: string;
  previewUrl: string | null;
  accepted: string[];
}

const transporterCache = new Map<string, Transporter>();

function keyOf(sender: SenderAccount): string {
  return `${sender.smtpHost}:${sender.smtpPort}:${sender.smtpUser}`;
}

function getTransporter(sender: SenderAccount): Transporter {
  const key = keyOf(sender);
  const cached = transporterCache.get(key);
  if (cached) return cached;

  const transporter = nodemailer.createTransport({
    host: sender.smtpHost,
    port: sender.smtpPort,
    secure: sender.smtpSecure,
    auth: { user: sender.smtpUser, pass: sender.smtpPass },
  });
  transporterCache.set(key, transporter);
  return transporter;
}

export async function sendEmail(
  sender: SenderAccount,
  to: string,
  subject: string,
  body: string,
): Promise<SendResult> {
  const transporter = getTransporter(sender);
  const info = await transporter.sendMail({
    from: `"${sender.name}" <${sender.email}>`,
    to,
    subject,
    text: body,
    html: body.includes('<') ? body : undefined,
  });

  return {
    messageId: info.messageId,
    accepted: (info.accepted as string[]) ?? [to],
    previewUrl: nodemailer.getTestMessageUrl(info) || null,
  };
}

export interface EtherealAccount {
  user: string;
  pass: string;
  host: string;
  port: number;
  email: string;
  name: string;
}

/**
 * Create an ephemeral Ethereal (fake SMTP) account. Used by the seed script so
 * every sender has a working SMTP credential without manual setup.
 */
export async function createEtherealAccount(displayName: string): Promise<EtherealAccount> {
  const account = await nodemailer.createTestAccount();
  return {
    user: account.user,
    pass: account.pass,
    host: env.ethereal.host,
    port: env.ethereal.port,
    email: account.user,
    name: displayName,
  };
}
