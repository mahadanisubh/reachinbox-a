import { Router, Response } from 'express';
import { z } from 'zod';
import { env } from '../config/env';
import { prisma } from '../db/prisma';
import { AuthedRequest, requireAuth } from '../middleware/auth';
import { HttpError } from '../middleware/error';
import { createSender } from '../services/senders';

export const sendersRouter = Router();

sendersRouter.use(requireAuth);

const createSchema = z.object({
  name: z.string().min(1).max(80),
  email: z.string().email().optional(),
  hourlyLimit: z.number().int().positive().optional(),
});

sendersRouter.get('/', async (req: AuthedRequest, res: Response) => {
  const senders = await prisma.sender.findMany({
    where: { userId: req.user!.id },
    orderBy: { createdAt: 'asc' },
  });
  res.json(
    senders.map((s) => ({
      id: s.id,
      name: s.name,
      email: s.email,
      hourlyLimit: s.hourlyLimit ?? env.worker.maxPerHourPerSender,
      createdAt: s.createdAt,
    })),
  );
});

sendersRouter.post('/', async (req: AuthedRequest, res: Response) => {
  const body = createSchema.parse(req.body);

  const sender = await createSender(req.user!.id, {
    name: body.name,
    email: body.email,
    hourlyLimit: body.hourlyLimit ?? null,
  });

  res.status(201).json({
    id: sender.id,
    name: sender.name,
    email: sender.email,
    hourlyLimit: sender.hourlyLimit ?? env.worker.maxPerHourPerSender,
  });
});

sendersRouter.delete('/:id', async (req: AuthedRequest, res: Response) => {
  const sender = await prisma.sender.findFirst({
    where: { id: req.params.id, userId: req.user!.id },
  });
  if (!sender) throw new HttpError(404, 'Sender not found');
  await prisma.sender.delete({ where: { id: sender.id } });
  res.json({ ok: true });
});
