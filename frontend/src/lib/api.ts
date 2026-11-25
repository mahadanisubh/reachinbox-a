import type {
  EmailListResponse,
  EmailStats,
  ScheduleRequest,
  ScheduleResponse,
  Sender,
  User,
} from '../types';

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

const TOKEN_KEY = 'reachinbox_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const payload = isJson ? await res.json() : null;

  if (!res.ok) {
    const message = payload?.message ?? res.statusText ?? 'Request failed';
    throw new ApiError(res.status, message);
  }
  return payload as T;
}

export const api = {
  me: () => request<User>('/api/auth/me'),
  devLogin: () =>
    request<{ token: string; user: User }>('/api/auth/dev-login', { method: 'POST' }),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),

  senders: () => request<Sender[]>('/api/senders'),

  createSender: (body: { name: string; email?: string; hourlyLimit?: number }) =>
    request<Sender>('/api/senders', { method: 'POST', body: JSON.stringify(body) }),

  schedule: (body: ScheduleRequest) =>
    request<ScheduleResponse>('/api/emails/schedule', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  emails: (params: {
    tab: 'scheduled' | 'sent';
    search?: string;
    page?: number;
    pageSize?: number;
    senderId?: string;
    status?: string;
    from?: string;
    to?: string;
    sortBy?: string;
    sortDir?: 'asc' | 'desc';
    signal?: AbortSignal;
  }) => {
    const q = new URLSearchParams({ tab: params.tab });
    if (params.search) q.set('search', params.search);
    if (params.page) q.set('page', String(params.page));
    if (params.pageSize) q.set('pageSize', String(params.pageSize));
    if (params.senderId) q.set('senderId', params.senderId);
    if (params.status) q.set('status', params.status);
    if (params.from) q.set('from', params.from);
    if (params.to) q.set('to', params.to);
    if (params.sortBy) q.set('sortBy', params.sortBy);
    if (params.sortDir) q.set('sortDir', params.sortDir);
    return request<EmailListResponse>(`/api/emails?${q.toString()}`, {
      signal: params.signal,
    });
  },

  stats: (signal?: AbortSignal) =>
    request<EmailStats>('/api/emails/stats', { signal }),

  cancelEmail: (id: string) =>
    request<{ ok: boolean }>(`/api/emails/${id}`, { method: 'DELETE' }),

  slackStatus: () =>
    request<{ connected: boolean; teamName: string | null; channelName: string | null }>(
      '/api/slack/status',
    ),
  slackConnectUrl: () => `${API_BASE}/api/slack/connect`,
  slackTest: () => request<{ ok: boolean }>('/api/slack/test', { method: 'POST' }),
  slackUnsubscribe: () =>
    request<{ ok: boolean }>('/api/slack/unsubscribe', { method: 'POST' }),
};

export const googleLoginUrl = `${API_BASE}/api/auth/google`;
