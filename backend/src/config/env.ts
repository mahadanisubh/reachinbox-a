import 'dotenv/config';
import { z } from 'zod';

const boolStr = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

const optionalStr = z
  .string()
  .optional()
  .transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined));

const intFromStr = (def: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : Number(v)))
    .pipe(z.number().int());

const rawSchema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.string().optional().default('4000'),

  API_PUBLIC_URL: z.string().default('http://localhost:4000'),
  WEB_APP_URL: z.string().default('http://localhost:5173'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

  JWT_SECRET: z.string().min(8, 'JWT_SECRET is required'),

  GOOGLE_CLIENT_ID: optionalStr,
  GOOGLE_CLIENT_SECRET: optionalStr,
  GOOGLE_REDIRECT_URI: optionalStr,

  SLACK_CLIENT_ID: optionalStr,
  SLACK_CLIENT_SECRET: optionalStr,
  SLACK_REDIRECT_URI: optionalStr,

  ELASTIC_NODE: optionalStr,
  ELASTIC_API_KEY: optionalStr,
  ELASTIC_INDEX: z.string().default('emails'),

  // Optional: comma-separated DNS servers used as a fallback when the OS
  // resolver fails (e.g. an ISP/router refusing *.elastic.cloud). Empty = off.
  DNS_SERVERS: optionalStr,

  WORKER_CONCURRENCY: intFromStr(5),
  EMAIL_MIN_DELAY_MS: intFromStr(2000),
  MAX_EMAILS_PER_HOUR_PER_SENDER: intFromStr(200),
  MAX_EMAILS_PER_HOUR: intFromStr(0),
  EMAIL_MAX_ATTEMPTS: intFromStr(3),

  WORKER_LIMITER_MAX: intFromStr(0),
  WORKER_LIMITER_DURATION_MS: intFromStr(1000),
  ENABLE_BULL_BOARD: boolStr,

  ETHEREAL_HOST: z.string().default('smtp.ethereal.email'),
  ETHEREAL_PORT: intFromStr(587),
  ETHEREAL_USER: optionalStr,
  ETHEREAL_PASS: optionalStr,
});

const parsed = rawSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const data = parsed.data;

export const env = {
  nodeEnv: data.NODE_ENV,
  isProd: data.NODE_ENV === 'production',
  port: Number(data.PORT),

  apiPublicUrl: data.API_PUBLIC_URL.replace(/\/$/, ''),
  webAppUrl: data.WEB_APP_URL.replace(/\/$/, ''),

  databaseUrl: data.DATABASE_URL,
  redisUrl: data.REDIS_URL,

  jwtSecret: data.JWT_SECRET,

  google: {
    clientId: data.GOOGLE_CLIENT_ID,
    clientSecret: data.GOOGLE_CLIENT_SECRET,
    redirectUri:
      data.GOOGLE_REDIRECT_URI ?? `${data.API_PUBLIC_URL}/api/auth/google/callback`,
    enabled: Boolean(data.GOOGLE_CLIENT_ID && data.GOOGLE_CLIENT_SECRET),
  },

  slack: {
    clientId: data.SLACK_CLIENT_ID,
    clientSecret: data.SLACK_CLIENT_SECRET,
    redirectUri:
      data.SLACK_REDIRECT_URI ?? `${data.API_PUBLIC_URL}/api/slack/callback`,
    enabled: Boolean(data.SLACK_CLIENT_ID && data.SLACK_CLIENT_SECRET),
  },

  elastic: {
    node: data.ELASTIC_NODE,
    apiKey: data.ELASTIC_API_KEY,
    index: data.ELASTIC_INDEX,
    enabled: Boolean(data.ELASTIC_NODE),
  },

  dnsServers: data.DNS_SERVERS
    ? data.DNS_SERVERS.split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [],

  worker: {
    concurrency: data.WORKER_CONCURRENCY,
    minDelayMs: data.EMAIL_MIN_DELAY_MS,
    maxPerHourPerSender: data.MAX_EMAILS_PER_HOUR_PER_SENDER,
    maxPerHourGlobal: data.MAX_EMAILS_PER_HOUR,
    maxAttempts: data.EMAIL_MAX_ATTEMPTS,
    limiterMax: data.WORKER_LIMITER_MAX,
    limiterDurationMs: data.WORKER_LIMITER_DURATION_MS,
  },

  bullBoardEnabled: data.ENABLE_BULL_BOARD,

  ethereal: {
    host: data.ETHEREAL_HOST,
    port: data.ETHEREAL_PORT,
    user: data.ETHEREAL_USER,
    pass: data.ETHEREAL_PASS,
  },
};
