import { Router, Request, Response } from 'express';
import axios from 'axios';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { prisma } from '../db/prisma';
import { AuthedRequest, requireAuth, signToken } from '../middleware/auth';
import { HttpError } from '../middleware/error';
import { ensureDefaultSender } from '../services/senders';

export const authRouter = Router();

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

function makeState(): string {
  return jwt.sign({ nonce: Math.random().toString(36).slice(2) }, env.jwtSecret, {
    expiresIn: '10m',
  });
}

function verifyState(state: string | undefined): void {
  if (!state) throw new HttpError(400, 'Missing OAuth state');
  try {
    jwt.verify(state, env.jwtSecret);
  } catch {
    throw new HttpError(400, 'Invalid or expired OAuth state');
  }
}

authRouter.get('/google', (_req: Request, res: Response) => {
  if (!env.google.enabled) {
    throw new HttpError(503, 'Google OAuth is not configured on the server');
  }
  const params = new URLSearchParams({
    client_id: env.google.clientId!,
    redirect_uri: env.google.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    prompt: 'select_account',
    state: makeState(),
  });
  res.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`);
});

authRouter.get('/google/callback', async (req: Request, res: Response) => {
  try {
    const { code, state } = req.query as { code?: string; state?: string };
    verifyState(state);
    if (!code) throw new HttpError(400, 'Missing authorization code');
    if (!env.google.enabled) throw new HttpError(503, 'Google OAuth is not configured');

    const { data: tokenData } = await axios.post(
      GOOGLE_TOKEN_URL,
      new URLSearchParams({
        client_id: env.google.clientId!,
        client_secret: env.google.clientSecret!,
        code,
        grant_type: 'authorization_code',
        redirect_uri: env.google.redirectUri,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    );

    const { data: profile } = await axios.get(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    const user = await prisma.user.upsert({
      where: { email: profile.email },
      update: {
        googleId: profile.sub,
        name: profile.name ?? null,
        avatarUrl: profile.picture ?? null,
      },
      create: {
        googleId: profile.sub,
        email: profile.email,
        name: profile.name ?? null,
        avatarUrl: profile.picture ?? null,
      },
    });

    const token = signToken({ id: user.id, email: user.email, name: user.name });
    await ensureDefaultSender(user.id).catch(() => undefined);
    res.cookie('token', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: env.isProd,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    res.redirect(`${env.webAppUrl}/auth/callback?token=${encodeURIComponent(token)}`);
  } catch (err) {
    const message = err instanceof HttpError ? err.message : 'Google login failed';
    res.redirect(`${env.webAppUrl}/login?error=${encodeURIComponent(message)}`);
  }
});

authRouter.get('/me', requireAuth, async (req: AuthedRequest, res: Response) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!user) throw new HttpError(404, 'User not found');
  const slack = await prisma.slackConnection.findUnique({ where: { userId: user.id } });
  res.json({
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    slackConnected: Boolean(slack),
  });
});

authRouter.post('/logout', (_req: Request, res: Response) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

/**
 * Development-only login as a seeded demo user. Lets you exercise the whole app
 * (scheduling, dashboard, Bull Board) before Google credentials are configured.
 * Disabled automatically in production.
 */
authRouter.post('/dev-login', async (_req: Request, res: Response) => {
  if (env.isProd) throw new HttpError(404, 'Not found');

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

  const token = signToken({ id: user.id, email: user.email, name: user.name });
  await ensureDefaultSender(user.id).catch(() => undefined);
  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.isProd,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
  res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
});
