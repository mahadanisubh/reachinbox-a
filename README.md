# ReachInbox — Email Job Scheduler

A production-style email scheduler service + dashboard.

- **Backend**: TypeScript, Express, BullMQ (Redis), PostgreSQL (Prisma), Ethereal SMTP, Elasticsearch
- **Frontend**: React + TypeScript + Tailwind CSS (Vite)
- **No cron**: all scheduling is BullMQ delayed jobs (Redis-backed)

---

## 1. Repository layout

```
reachinbox-a/
├─ backend/                 Express API + BullMQ worker
│  ├─ prisma/schema.prisma  DB schema (Postgres)
│  ├─ prisma/seed.ts        Creates demo user + Ethereal sender
│  └─ src/
│     ├─ config/env.ts      Typed, validated env config
│     ├─ db/prisma.ts       Prisma client
│     ├─ redis.ts           Shared ioredis connections
│     ├─ queue/             BullMQ queue + worker (rate limiting lives here)
│     ├─ services/          mailer (Ethereal), elastic, slack, notifier, rateLimit
│     ├─ routes/            auth (Google), senders, emails, slack
│     ├─ middleware/        auth (JWT), error handling
│     ├─ app.ts             Express app + Bull Board
│     └─ index.ts           API + worker bootstrap
└─ frontend/                React dashboard (Vite + Tailwind)
   └─ src/
      ├─ lib/api.ts         Typed API client
      ├─ context/           Auth context
      ├─ components/        Reusable UI (Button, Input, Modal, Table, Toast…)
      └─ pages/             Login, OAuth callback, Dashboard
```

---

## 2. Prerequisites

| Dependency | Notes |
|---|---|
| Node.js 20+ | built/tested on Node 22 |
| PostgreSQL | any recent version, local or cloud |
| Redis | required by BullMQ (local or cloud URL e.g. Upstash/Redis Cloud) |
| Elasticsearch | optional but recommended (cloud node; app runs without it) |
| Google OAuth app | for "Continue with Google" login |
| Slack app | for rate-limit notifications |

> Docker is **not** required.

---

## 3. Backend setup

```powershell
cd backend
npm install
copy .env.example .env      # then edit .env
```

Minimum `.env` values:

```ini
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/reachinbox?schema=public
REDIS_URL=redis://127.0.0.1:6379
JWT_SECRET=some-long-random-string
```

Create the database and schema, then seed:

```powershell
# create DB (once)
& "C:\Program Files\PostgreSQL\<ver>\bin\psql.exe" -U postgres -h localhost -c "CREATE DATABASE reachinbox;"

npx prisma migrate dev --name init   # or: npx prisma migrate deploy
npm run seed                         # demo user + one Ethereal sender
```

Run the API **and** worker together (single process):

```powershell
npm run dev
```

…or scale the worker separately (API only / worker only):

```powershell
npm run dev      # API (also starts a worker)
npm run worker   # extra dedicated worker process
```

Endpoints of interest:

- API: `http://localhost:4000`
- Live BullMQ dashboard (Bull Board): `http://localhost:4000/admin/queues`
- Health: `http://localhost:4000/health`

### Ethereal SMTP (fake SMTP)

Nothing to configure: `npm run seed` (and the "create sender" API) call
`nodemailer.createTestAccount()` to mint an ephemeral Ethereal account per sender.
Each sent message returns a **preview URL** (`https://ethereal.email/message/...`)
which the dashboard links to in the *Sent Emails* table. To use a fixed account
instead, set `ETHEREAL_USER` / `ETHEREAL_PASS` in `.env`.

---

## 4. Frontend setup

```powershell
cd frontend
npm install
copy .env.example .env      # VITE_API_URL can stay empty in dev (Vite proxy)
npm run dev
```

Open `http://localhost:5173`. In development the Vite dev server proxies
`/api` → `http://localhost:4000`, so no CORS setup is needed.

**Demo login**: if Google credentials are not configured yet, click
*Use demo account* (this endpoint is disabled automatically in production).

---

## 5. Google OAuth setup

1. Google Cloud Console → **APIs & Services → Credentials → Create OAuth client ID (Web)**.
2. Authorized redirect URI: `http://localhost:4000/api/auth/google/callback`.
3. Put the values in `backend/.env`:

```ini
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://localhost:4000/api/auth/google/callback
```

Flow: `GET /api/auth/google` → Google consent → `GET /api/auth/google/callback`
→ backend upserts the user, signs a JWT, sets an httpOnly cookie **and** redirects
to `${WEB_APP_URL}/auth/callback?token=...` (the SPA stores it and calls
`/api/auth/me`).

## 6. Slack OAuth setup (rate-limit alerts)

1. api.slack.com → **Create app → From scratch**.
2. **OAuth & Permissions → Bot Token Scopes**: `chat:write`, `channels:read`,
   `incoming-webhook`.
3. **Redirect URLs**: `http://localhost:4000/api/slack/callback`.
4. Put values in `backend/.env`:

```ini
SLACK_CLIENT_ID=...
SLACK_CLIENT_SECRET=...
SLACK_REDIRECT_URI=http://localhost:4000/api/slack/callback
```

In the dashboard click **Connect Slack** → real OAuth authorize → the backend
stores the **bot token + channel** per user. When a sender hits its hourly cap the
worker posts a real `chat.postMessage` to that channel. If the user never
connected Slack, hits are silent no-ops; connecting later starts working
immediately (no redeploy) because the connection is read fresh per event.

## 7. Elasticsearch setup

Use a cloud node (recommended, so the same code works in deployment):

```ini
ELASTIC_NODE=https://your-cluster.es.io:443
ELASTIC_API_KEY=...        # or leave blank for basic/none
ELASTIC_INDEX=emails
```

On startup the app ensures the index exists. **Indexing is non-fatal**: if ES is
down/absent, the scheduler keeps working and email search falls back to Postgres
(`ILIKE`). When ES is present, the Emails list returns `"source": "elasticsearch"`.

---

## 8. Architecture

### Scheduling flow

```
POST /api/emails/schedule
   ├─ validate payload (zod)
   ├─ insert one Email row per recipient (status=SCHEDULED)
   ├─ enqueue a BullMQ delayed job per email, jobId = "email-<emailId>"
   └─ index the doc in Elasticsearch (best-effort)
Worker (concurrency = WORKER_CONCURRENCY)
   ├─ per-sender min spacing  → Redis "throttle" slot
   ├─ per-sender hourly cap   → Redis hourly counter
   ├─ global hourly cap       → Redis hourly counter
   ├─ send via Ethereal SMTP  → status=SENT (+ preview URL)
   └─ on failure              → BullMQ exponential backoff retry → FAILED
```

### Persistence across restarts (no duplicates, no restart-from-scratch)

- BullMQ stores **delayed jobs in Redis**, so future sends survive an API/worker
  restart and fire at the correct time.
- Job ids are **deterministic** (`email-<emailId>`), so re-enqueueing never
  duplicates a job.
- On worker startup, `reconcilePendingEmails()` re-enqueues any `SCHEDULED` /
  `RATE_LIMITED` rows that have **no job in Redis** (covers the case where Redis
  itself was flushed). Existing jobs are left untouched → idempotent.
- The processor is **idempotent**: it re-reads the row and returns early if the
  email is already `SENT`/`CANCELLED`, so a redelivered job never double-sends.

### Rate limiting & concurrency (required)

- **Concurrency**: `WORKER_CONCURRENCY` (default 5) jobs processed in parallel.
- **Min delay between sends**: enforced **per sender** in Redis with an atomic
  Lua script (`claimSenderSendSlot`). `EMAIL_MIN_DELAY_MS` (default **2000 ms**),
  so a single sender never fires two emails less than 2 s apart. This keeps
  concurrency useful — different senders still send in parallel.
- **Emails per hour — per sender**: `MAX_EMAILS_PER_HOUR_PER_SENDER` (default 200),
  overridable per sender (`Sender.hourlyLimit`). Enforced with an **atomic Redis
  Lua counter** keyed by `rl:sender:<senderId>:<hourWindow>` — safe across any
  number of workers/instances (NOT in-memory).
- **Emails per hour — global** (optional): `MAX_EMAILS_PER_HOUR` (0 = disabled).
- **When a limit is hit**: the job is **not** dropped or failed. The worker calls
  `job.moveToDelayed(nextWindowStart)` and throws `DelayedError`, so the email is
  re-queued into the **next hour window**, preserving per-sender order as much as
  possible. Its DB status becomes `RATE_LIMITED` until it actually sends.
- **Optional BullMQ limiter**: set `WORKER_LIMITER_MAX` > 0 for an additional
  queue-wide throttle (max jobs per `WORKER_LIMITER_DURATION_MS`).

### Behavior under load (e.g. 1000+ emails at the same time)

1. All 1000 become delayed jobs at ~the same time; the worker picks them up at
   `WORKER_CONCURRENCY` in parallel.
2. Redis hourly counters cap how many each sender actually sends per hour; the
   rest are transparently `moveToDelayed`'d to the next window(s).
3. Per-sender min-delay spreads sends out; Slack is notified (once per sender per
   window) the moment a cap is hit. **Nothing is lost or permanently failed.**

### Slack alerting

`notifyRateLimitHit()` reads the caller's `SlackConnection` fresh, dedupes to one
alert per sender per hour window (Redis `SET NX`), and posts `chat.postMessage`.
Missing connection → silent no-op.

---

## 9. API reference (summary)

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Liveness |
| GET | `/api/auth/google` | Start Google OAuth |
| GET | `/api/auth/google/callback` | Google OAuth callback |
| POST | `/api/auth/dev-login` | Demo login (non-prod) |
| GET | `/api/auth/me` | Current user (requires bearer/JWT cookie) |
| POST | `/api/auth/logout` | Clear session |
| GET | `/api/senders` | List senders |
| POST | `/api/senders` | Create sender (auto Ethereal account) |
| DELETE | `/api/senders/:id` | Delete sender |
| POST | `/api/emails/schedule` | Schedule emails to many recipients |
| GET | `/api/emails?tab=scheduled\|sent&search=&page=&pageSize=` | List + search + filter + sort |
| DELETE | `/api/emails/:id` | Cancel a scheduled email |
| GET | `/api/slack/connect` | Start Slack OAuth |
| GET | `/api/slack/callback` | Slack OAuth callback |
| GET | `/api/slack/status` | Connection status |
| POST | `/api/slack/test` | Send a test message |
| POST | `/api/slack/unsubscribe` | Disconnect Slack |
| GET | `/admin/queues` | Live BullMQ dashboard (Bull Board) |

List query params (`GET /api/emails`) — all server-side, compose freely:

| Param | Values | Notes |
|---|---|---|
| `tab` | `scheduled` \| `sent` \| `all` | Default `all` |
| `search` | free text | Elasticsearch-backed; Postgres fallback |
| `page`, `pageSize` | ints | `pageSize` ≤ 200 |
| `senderId` | sender uuid | filter by sender |
| `status` | `SCHEDULED`\|`SENT`\|`FAILED`\|`RATE_LIMITED`\|`CANCELLED` | intersected with the tab's set |
| `from`, `to` | ISO datetime | filter `scheduledAt` range |
| `sortBy` | `scheduledAt`\|`sentAt`\|`toEmail`\|`subject`\|`status`\|`createdAt` | default `scheduledAt` |
| `sortDir` | `asc`\|`desc` | default `desc` |

Schedule request body:

```json
{
  "senderId": "uuid",
  "subject": "Quick intro",
  "body": "Hi there…",
  "recipients": ["a@x.com", "b@y.com"],
  "startTime": "2026-01-01T09:00:00.000Z",
  "delaySeconds": 2,
  "hourlyLimit": 200
}
```

---

## 10. Feature checklist (mapped to the brief)

**Backend**

- ✅ Schedule via API, stored in Postgres
- ✅ BullMQ delayed jobs (no cron anywhere)
- ✅ Multiple senders, Ethereal SMTP
- ✅ Elasticsearch indexing + search (graceful Postgres fallback)
- ✅ Live BullMQ dashboard (Bull Board at `/admin/queues`)
- ✅ Persistence across restart + reconciliation, idempotent sends
- ✅ Worker concurrency (configurable)
- ✅ Min delay between sends per sender (configurable)
- ✅ Emails-per-hour limit per sender + optional global (Redis Lua counters)
- ✅ Rate-limited jobs delayed to next window (never dropped/failed)
- ✅ Slack OAuth + live notification on rate-limit hit (dedupe, disconnect/reconnect)

**Frontend**

- ✅ Google OAuth login (+ dev login), header with name/email/avatar, logout
- ✅ Dashboard tabs: Scheduled / Sent
- ✅ Compose modal: subject, body, CSV/text lead upload with count, start time,
  delay, hourly limit
- ✅ Scheduled & Sent tables with status, loading states, empty states, search,
  cancel, Ethereal preview links
- ✅ Server-side **pagination + filters** (sender, status, scheduled-date range) and
  **sorting** (field + asc/desc), **virtualized** rows (large lists), skeletons,
  route/component code-splitting
- ✅ Reusable UI components, typed API layer, toasts/error handling

---

## 11. Assumptions, shortcuts & trade-offs

- **No Docker**: Postgres + Redis are expected to be installed/available locally or
  provided as URLs; all connection info comes from env. No containers are used.
- **Search**: against a cloud ES node via `ELASTIC_NODE`; Postgres `ILIKE` is the
  fallback so the app never hard-depends on ES.
- **JWT in localStorage** (SPA) plus an httpOnly cookie on the OAuth callback for
  convenience. For a hardened deployment, prefer the cookie-only flow with CSRF.
- **Slack**: alerts are posted to the channel selected during install
  (`incoming-webhook.channel_id`). Slack tokens are stored in plaintext in the DB —
  wrap with KMS/secret storage in production.
- **Compose "hourly limit"** updates the selected sender's hourly cap (the cap is
  a per-sender, not per-batch, concept). Multiple concurrent batches from the same
  sender share one hourly budget — which matches real provider throttling.
- **Demo login** exists purely so the app can be exercised before Google creds are
  set; it is disabled when `NODE_ENV=production`.
- **Reconciliation** deliberately re-adds only pending jobs (deterministic ids make
  this safe) — we never re-send anything that is already `SENT`.
- **Redis**: BullMQ is sensitive to the Redis eviction policy — use `noeviction`
  (BullMQ prints a warning otherwise). Managed tiers default to `volatile-lru`;
  set it to `noeviction` for production so delayed jobs are never evicted. Cloud
  `redis://`/`rediss://` URLs work as-is; only `REDIS_URL` changes between
  environments.

---

## 12. Troubleshooting

- **Slack "There's been a glitch" on Connect Slack**: the authorize endpoint must be
  `https://slack.com/oauth/v2/authorize` (the user-facing URL), **not**
  `https://slack.com/api/...`. Token exchange uses the Web API base
  (`https://slack.com/api/oauth.v2.access`). Also ensure the Redirect URL in the
  Slack app exactly matches `SLACK_REDIRECT_URI` and that the Bot Token Scopes
  (`chat:write`, `incoming-webhook`, `channels:read`) are added.
- **"No senders available" in Compose**: senders are **per-user** DB rows, not env
  values. Every user is auto-provisioned one Ethereal sender on first login; use
  the **New** button next to the sender picker to add more.
- **Search shows nothing right after scheduling**: Elasticsearch is near-real-time;
  indexing is fire-and-forget and search falls back to Postgres when ES has no
  hits yet, so results appear immediately regardless.
