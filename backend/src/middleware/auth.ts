import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';

export interface AuthUser {
  id: string;
  email: string;
  name?: string | null;
}

export interface AuthedRequest extends Request {
  user?: AuthUser;
}

export function signToken(user: AuthUser): string {
  return jwt.sign({ sub: user.id, email: user.email, name: user.name }, env.jwtSecret, {
    expiresIn: '7d',
  });
}

function extractToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  const cookieToken = (req as Request & { cookies?: Record<string, string> }).cookies?.token;
  return cookieToken;
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ error: 'unauthorized', message: 'Missing auth token' });
    return;
  }
  try {
    const payload = jwt.verify(token, env.jwtSecret) as jwt.JwtPayload;
    req.user = { id: String(payload.sub), email: String(payload.email), name: payload.name };
    next();
  } catch {
    res.status(401).json({ error: 'unauthorized', message: 'Invalid or expired token' });
  }
}
