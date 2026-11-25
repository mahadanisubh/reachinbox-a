import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api } from '../lib/api';
import { useDebouncedValue } from './useDebouncedValue';
import type { EmailListResponse, EmailRow } from '../types';

export type Tab = 'scheduled' | 'sent';
export type SortBy = 'scheduledAt' | 'sentAt' | 'toEmail' | 'subject' | 'status' | 'createdAt';
export type SortDir = 'asc' | 'desc';

export interface EmailFilters {
  senderId: string;
  status: string;
  from: string;
  to: string;
}

export const EMPTY_FILTERS: EmailFilters = { senderId: '', status: '', from: '', to: '' };

export const PAGE_SIZES = [25, 50, 100, 200] as const;
export const DEFAULT_PAGE_SIZE = 25;

export const SORT_OPTIONS: { value: SortBy; label: string }[] = [
  { value: 'scheduledAt', label: 'Scheduled time' },
  { value: 'sentAt', label: 'Sent time' },
  { value: 'toEmail', label: 'Email' },
  { value: 'subject', label: 'Subject' },
  { value: 'status', label: 'Status' },
  { value: 'createdAt', label: 'Created' },
];

export interface UseEmailsResult {
  tab: Tab;
  setTab: (tab: Tab) => void;
  searchInput: string;
  setSearchInput: (value: string) => void;
  search: string;
  filters: EmailFilters;
  setFilter: (key: keyof EmailFilters, value: string) => void;
  clearFilters: () => void;
  hasFilters: boolean;
  sort: { by: SortBy; dir: SortDir };
  setSortBy: (by: SortBy) => void;
  setSortDir: (dir: SortDir) => void;
  toggleSortDir: () => void;
  page: number;
  setPage: (page: number) => void;
  pageSize: number;
  setPageSize: (size: number) => void;
  items: EmailRow[];
  total: number;
  totalPages: number;
  source: EmailListResponse['source'] | null;
  isLoading: boolean;
  isFetching: boolean;
  error: string | null;
  reload: () => void;
}

const POLL_MS = 8000;

function dayStartIso(day: string): string | undefined {
  const d = new Date(`${day}T00:00:00`);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function dayEndIso(day: string): string | undefined {
  const d = new Date(`${day}T23:59:59.999`);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/**
 * Owns email-list state: tab, debounced search, filters, sorting, server-side
 * pagination and background polling.
 *
 * - In-flight requests are aborted when the query changes (no stale overwrite).
 * - Previous data is kept while refetching (no empty flash).
 * - Polling runs only while the tab is visible and refreshes on refocus.
 */
export function useEmails(initialTab: Tab = 'scheduled'): UseEmailsResult {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput, 300);
  const [filters, setFilters] = useState<EmailFilters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<{ by: SortBy; dir: SortDir }>({
    by: 'scheduledAt',
    dir: 'desc',
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [data, setData] = useState<EmailListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isFetching, setIsFetching] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  // Sensible default sort per tab; drop a status filter that no longer applies.
  useEffect(() => {
    setSort({ by: tab === 'sent' ? 'sentAt' : 'scheduledAt', dir: 'desc' });
    setFilters((prev) => (prev.status ? { ...prev, status: '' } : prev));
  }, [tab]);

  // Any query change starts at page 1.
  useEffect(() => {
    setPage(1);
  }, [tab, search, pageSize, filters, sort]);

  const setFilter = useCallback((key: keyof EmailFilters, value: string) => {
    setFilters((prev) => (prev[key] === value ? prev : { ...prev, [key]: value }));
  }, []);

  const clearFilters = useCallback(() => setFilters(EMPTY_FILTERS), []);

  const setSortBy = useCallback((by: SortBy) => setSort((prev) => ({ ...prev, by })), []);
  const setSortDir = useCallback((dir: SortDir) => setSort((prev) => ({ ...prev, dir })), []);
  const toggleSortDir = useCallback(
    () => setSort((prev) => ({ ...prev, dir: prev.dir === 'asc' ? 'desc' : 'asc' })),
    [],
  );

  const fetchPage = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setIsFetching(true);
    try {
      const res = await api.emails({
        tab,
        search: search || undefined,
        page,
        pageSize,
        senderId: filters.senderId || undefined,
        status: filters.status || undefined,
        from: filters.from ? dayStartIso(filters.from) : undefined,
        to: filters.to ? dayEndIso(filters.to) : undefined,
        sortBy: sort.by,
        sortDir: sort.dir,
        signal: controller.signal,
      });
      setData(res);
      setError(null);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setError(err instanceof ApiError ? err.message : 'Failed to load emails');
    } finally {
      if (abortRef.current === controller) setIsFetching(false);
    }
  }, [tab, search, page, pageSize, filters, sort]);

  useEffect(() => {
    void fetchPage();
  }, [fetchPage]);

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible') void fetchPage();
    };
    const id = setInterval(tick, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void fetchPage();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [fetchPage]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const reload = useCallback(() => {
    void fetchPage();
  }, [fetchPage]);

  const total = data?.total ?? 0;
  const hasFilters = Boolean(filters.senderId || filters.status || filters.from || filters.to);

  return {
    tab,
    setTab,
    searchInput,
    setSearchInput,
    search,
    filters,
    setFilter,
    clearFilters,
    hasFilters,
    sort,
    setSortBy,
    setSortDir,
    toggleSortDir,
    page,
    setPage,
    pageSize,
    setPageSize,
    items: data?.items ?? [],
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    source: data?.source ?? null,
    isLoading: data === null && error === null,
    isFetching,
    error,
    reload,
  };
}
