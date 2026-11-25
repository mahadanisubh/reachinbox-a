import { Client, estypes } from '@elastic/elasticsearch';
import { env } from '../config/env';

let client: Client | null = null;

function describeElasticError(err: unknown): string {
  const e = err as {
    name?: string;
    message?: string;
    meta?: { statusCode?: number; body?: { error?: { reason?: string } } };
  };
  const reason = e?.meta?.body?.error?.reason;
  const parts = [
    e?.name,
    e?.meta?.statusCode ? `HTTP ${e.meta.statusCode}` : undefined,
    reason ?? e?.message,
  ].filter(Boolean);
  return parts.join(' | ') || 'unknown error';
}

function getClient(): Client | null {
  if (!env.elastic.enabled) return null;
  if (!client) {
    client = new Client({
      node: env.elastic.node!,
      auth: env.elastic.apiKey ? { apiKey: env.elastic.apiKey } : undefined,
      maxRetries: 2,
      requestTimeout: 8000,
    });
  }
  return client;
}

export interface EmailDoc {
  id: string;
  userId: string;
  senderId: string;
  senderEmail?: string;
  toEmail: string;
  subject: string;
  body: string;
  status: string;
  scheduledAt: string;
  sentAt?: string | null;
  createdAt: string;
}

/**
 * Ensure the index + mapping exist. Failures are swallowed: search/index are
 * best-effort optimisations, never a hard dependency of the scheduler.
 */
export async function ensureIndex(): Promise<void> {
  const es = getClient();
  if (!es) {
    console.warn('[elastic] disabled (ELASTIC_NODE not set) - search falls back to DB');
    return;
  }
  try {
    const exists = await es.indices.exists({ index: env.elastic.index });
    if (!exists) {
      await es.indices.create({
        index: env.elastic.index,
        mappings: {
          properties: {
            id: { type: 'keyword' },
            userId: { type: 'keyword' },
            senderId: { type: 'keyword' },
            senderEmail: { type: 'keyword' },
            toEmail: { type: 'keyword' },
            subject: { type: 'text' },
            body: { type: 'text' },
            status: { type: 'keyword' },
            scheduledAt: { type: 'date' },
            sentAt: { type: 'date' },
            createdAt: { type: 'date' },
          },
        },
      });
      console.log(`[elastic] created index "${env.elastic.index}"`);
    } else {
      console.log(`[elastic] index "${env.elastic.index}" ready`);
    }
  } catch (err) {
    console.error('[elastic] ensureIndex failed:', describeElasticError(err));
  }
}

export async function indexEmail(doc: EmailDoc): Promise<void> {
  const es = getClient();
  if (!es) return;
  try {
    await es.index({
      index: env.elastic.index,
      id: doc.id,
      document: doc,
      refresh: false,
    });
  } catch (err) {
    console.error('[elastic] indexEmail failed:', describeElasticError(err));
  }
}

export interface SearchOptions {
  userId: string;
  query?: string;
  status?: string;
  from?: number;
  size?: number;
}

export interface SearchResult {
  ids: string[];
  total: number;
}

/**
 * Full-text search across to/subject/body. Returns the matching email ids
 * (ordered by relevance/scheduledAt). Callers fall back to Postgres when
 * Elasticsearch is unavailable.
 */
export async function searchEmails(options: SearchOptions): Promise<SearchResult> {
  const es = getClient();
  if (!es) throw new Error('ELASTIC_DISABLED');

  const filters: estypes.QueryDslQueryContainer[] = [{ term: { userId: options.userId } }];
  if (options.status) filters.push({ term: { status: options.status } });

  const must = options.query
    ? [
        {
          multi_match: {
            query: options.query,
            fields: ['subject^3', 'toEmail^2', 'body'],
            fuzziness: 'AUTO',
          },
        },
      ]
    : [{ match_all: {} }];

  const res = await es.search({
    index: env.elastic.index,
    from: options.from ?? 0,
    size: options.size ?? 100,
    query: { bool: { must, filter: filters } },
    sort: options.query ? ['_score', { scheduledAt: 'desc' }] : [{ scheduledAt: 'desc' }],
  });

  const hits = res.hits.hits;
  const total =
    typeof res.hits.total === 'number' ? res.hits.total : res.hits.total?.value ?? hits.length;

  return { ids: hits.map((h) => (h._source as EmailDoc).id), total };
}
