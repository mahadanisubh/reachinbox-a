import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { prisma } from '../db/prisma';
import { AuthedRequest, requireAuth } from '../middleware/auth';
import { HttpError } from '../middleware/error';
import { buildAuthorizeUrl, deliver, exchangeCode } from '../services/slack';

export const slackRouter = Router();

const STATE_TTL = '10m';

slackRouter.get('/connect', requireAuth, (req: AuthedRequest, res: Response) => {
  if (!env.slack.enabled) throw new HttpError(503, 'Slack OAuth is not configured on the server');
  const state = jwt.sign({ userId: req.user!.id }, env.jwtSecret, { expiresIn: STATE_TTL });
  res.redirect(buildAuthorizeUrl(state));
});

slackRouter.get('/callback', async (req: Request, res: Response) => {
  const { code, state, error } = req.query as {
    code?: string;
    state?: string;
    error?: string;
  };
  const redirectBack = (status: string) =>
    res.redirect(`${env.webAppUrl}/dashboard?slack=${status}`);

  if (error) return redirectBack('denied');
  if (!code || !state) return redirectBack('error');

  let userId: string;
  try {
    const payload = jwt.verify(state, env.jwtSecret) as jwt.JwtPayload;
    userId = String(payload.userId);
  } catch {
    return redirectBack('error');
  }

  try {
    const result = await exchangeCode(code);
    await prisma.slackConnection.upsert({
      where: { userId },
      update: {
        teamId: result.teamId,
        teamName: result.teamName,
        botToken: result.botToken,
        channelId: result.channelId,
        channelName: result.channelName,
        incomingWebhookUrl: result.incomingWebhookUrl,
      },
      create: {
        userId,
        teamId: result.teamId,
        teamName: result.teamName,
        botToken: result.botToken,
        channelId: result.channelId,
        channelName: result.channelName,
        incomingWebhookUrl: result.incomingWebhookUrl,
      },
    });
    return redirectBack('connected');
  } catch (err) {
    console.error('[slack] callback failed:', (err as Error).message);
    return redirectBack('error');
  }
});

slackRouter.get('/status', requireAuth, async (req: AuthedRequest, res: Response) => {
  const conn = await prisma.slackConnection.findUnique({ where: { userId: req.user!.id } });
  res.json({
    connected: Boolean(conn),
    teamName: conn?.teamName ?? null,
    channelName: conn?.channelName ?? null,
  });
});

slackRouter.post('/unsubscribe', requireAuth, async (req: AuthedRequest, res: Response) => {
  await prisma.slackConnection
    .delete({ where: { userId: req.user!.id } })
    .catch(() => undefined);
  res.json({ ok: true, connected: false });
});

slackRouter.post('/test', requireAuth, async (req: AuthedRequest, res: Response) => {
  const conn = await prisma.slackConnection.findUnique({ where: { userId: req.user!.id } });
  if (!conn) throw new HttpError(400, 'Slack is not connected');
  await deliver(
    conn,
    ':white_check_mark: ReachInbox test notification — your Slack connection works.',
  );
  res.json({ ok: true });
});
