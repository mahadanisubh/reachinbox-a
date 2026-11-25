import { prisma } from '../src/db/prisma';
import { env } from '../src/config/env';
import { createEtherealAccount } from '../src/services/mailer';

async function main(): Promise<void> {
  console.log('[seed] creating demo user + sender...');

  const user = await prisma.user.upsert({
    where: { email: 'demo@reachinbox.local' },
    update: {},
    create: {
      googleId: 'demo-user',
      email: 'demo@reachinbox.local',
      name: 'Demo User',
      avatarUrl: null,
    },
  });

  const existing = await prisma.sender.findFirst({
    where: { userId: user.id },
  });
  if (existing) {
    console.log(`[seed] sender already exists: ${existing.email}`);
    return;
  }

  const ethereal = await createEtherealAccount('Demo Sender');
  const sender = await prisma.sender.create({
    data: {
      userId: user.id,
      name: 'Demo Sender',
      email: ethereal.email,
      smtpHost: env.ethereal.user ? env.ethereal.host : ethereal.host,
      smtpPort: env.ethereal.user ? env.ethereal.port : ethereal.port,
      smtpSecure: false,
      smtpUser: env.ethereal.user ?? ethereal.user,
      smtpPass: env.ethereal.pass ?? ethereal.pass,
    },
  });

  console.log(`[seed] user:   ${user.email}`);
  console.log(`[seed] sender: ${sender.email} (Ethereal test account)`);
}

main()
  .catch((err) => {
    console.error('[seed] failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
