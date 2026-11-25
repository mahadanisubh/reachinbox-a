import { lazy, Suspense, useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { useEmails, SORT_OPTIONS, type Tab, type SortBy } from '../hooks/useEmails';
import { useEmailStats } from '../hooks/useEmailStats';
import { Header } from '../components/Header';
import { Button, Spinner } from '../components/Button';
import { Input, Select } from '../components/Field';
import { EmailsTable } from '../components/EmailsTable';
import { Pagination } from '../components/Pagination';
import { EmptyState } from '../components/EmptyState';
import { OverlayLoader } from '../components/Loader';
import { StatsCards } from '../components/StatsCards';
import type { Sender } from '../types';

// Loaded only when the user opens Compose - keeps the initial bundle lean.
const ComposeModal = lazy(() => import('../components/ComposeModal'));

interface SlackState {
  connected: boolean;
  teamName: string | null;
  channelName: string | null;
}

const TABS: Tab[] = ['scheduled', 'sent'];

function InboxIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 7.5A2.5 2.5 0 0 1 5.5 5h13A2.5 2.5 0 0 1 21 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5v-9Z"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path d="m4 7 8 6 8-6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
      <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function RefreshIcon({ spinning }: { spinning?: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={spinning ? 'animate-spin' : undefined}
    >
      <path
        d="M20 12a8 8 0 1 1-2.34-5.66M20 4v4h-4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ArrowUpDownIcon({ dir }: { dir: 'asc' | 'desc' }) {
  return dir === 'asc' ? (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 19V5m0 0-6 6m6-6 6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ) : (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 5v14m0 0 6-6m-6 6-6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function DashboardPage() {
  const { user, logout } = useAuth();
  const { notify } = useToast();
  const [params, setParams] = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const {
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
    toggleSortDir,
    page,
    setPage,
    pageSize,
    setPageSize,
    items,
    total,
    totalPages,
    isLoading,
    isFetching,
    error,
    reload,
  } = useEmails('scheduled');

  const { stats, isLoading: statsLoading, refresh: refreshStats } = useEmailStats();

  const [composeOpen, setComposeOpen] = useState(false);
  const [senders, setSenders] = useState<Sender[]>([]);
  const [slack, setSlack] = useState<SlackState>({
    connected: false,
    teamName: null,
    channelName: null,
  });

  const slackMenuRef = useRef<HTMLDetailsElement>(null);
  const closeSlackMenu = useCallback(() => {
    if (slackMenuRef.current) slackMenuRef.current.open = false;
  }, []);

  useEffect(() => {
    api
      .senders()
      .then(setSenders)
      .catch(() => undefined);
  }, []);

  const refreshSlack = useCallback(() => {
    api.slackStatus().then(setSlack).catch(() => undefined);
  }, []);

  useEffect(() => {
    refreshSlack();
  }, [refreshSlack]);

  // Surface the result of the Slack OAuth redirect.
  useEffect(() => {
    const status = params.get('slack');
    if (!status) return;
    if (status === 'connected') notify('Slack connected', 'success');
    else if (status === 'error') notify('Slack connection failed', 'error');
    else if (status === 'denied') notify('Slack connection denied', 'error');
    refreshSlack();
    params.delete('slack');
    setParams(params, { replace: true });
  }, [params, setParams, notify, refreshSlack]);

  const changeTab = useCallback(
    (next: Tab) => {
      startTransition(() => setTab(next));
    },
    [setTab],
  );

  const cancel = useCallback(
    async (id: string) => {
      try {
        await api.cancelEmail(id);
        notify('Email cancelled', 'success');
        reload();
        refreshStats();
      } catch (err) {
        notify(err instanceof ApiError ? err.message : 'Cancel failed', 'error');
      }
    },
    [notify, reload, refreshStats],
  );

  const handleScheduled = useCallback(() => {
    startTransition(() => setTab('scheduled'));
    setPage(1);
    reload();
    refreshStats();
  }, [setTab, setPage, reload, refreshStats]);

  const connectSlack = () => {
    closeSlackMenu();
    window.location.href = api.slackConnectUrl();
  };

  const testSlack = async () => {
    closeSlackMenu();
    try {
      await api.slackTest();
      notify('Test message sent to Slack', 'success');
    } catch (err) {
      notify(err instanceof ApiError ? err.message : 'Slack test failed', 'error');
    }
  };

  const disconnectSlack = async () => {
    closeSlackMenu();
    await api.slackUnsubscribe();
    setSlack({ connected: false, teamName: null, channelName: null });
    notify('Slack disconnected', 'success');
  };

  if (!user) return null;

  const searching = search.length > 0;
  const noMatches = searching || hasFilters;

  return (
    <div className="flex min-h-full flex-col">
      <Header user={user} onLogout={() => void logout()} />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:py-8">
        {/* Page header */}
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">Emails</h1>
            <p className="mt-0.5 text-sm text-slate-500">
              Schedule, monitor and search your outreach.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <details ref={slackMenuRef} className="relative">
              <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    slack.connected ? 'bg-emerald-500' : 'bg-slate-300'
                  }`}
                />
                <span>Slack</span>
                <span className="max-w-[9rem] truncate font-normal text-slate-500">
                  {slack.connected ? slack.teamName ?? 'connected' : 'not connected'}
                </span>
                <ChevronDownIcon />
              </summary>
              <div className="absolute right-0 z-20 mt-1 w-52 overflow-hidden rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
                <div className="flex items-center gap-2 px-2.5 py-1.5 text-xs text-slate-500">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      slack.connected ? 'bg-emerald-500' : 'bg-slate-300'
                    }`}
                  />
                  {slack.connected
                    ? `Connected${slack.teamName ? ` · ${slack.teamName}` : ''}`
                    : 'Not connected'}
                </div>
                <div className="my-1 h-px bg-slate-100" />
                <button
                  onClick={connectSlack}
                  className="flex w-full items-center rounded-md px-2.5 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
                >
                  {slack.connected ? 'Reconnect Slack' : 'Connect Slack'}
                </button>
                <button
                  onClick={testSlack}
                  disabled={!slack.connected}
                  className="flex w-full items-center rounded-md px-2.5 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  Send test message
                </button>
                <button
                  onClick={disconnectSlack}
                  disabled={!slack.connected}
                  className="flex w-full items-center rounded-md px-2.5 py-2 text-left text-sm text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  Disconnect
                </button>
              </div>
            </details>
            <Button onClick={() => setComposeOpen(true)}>
              <PlusIcon />
              Compose New Email
            </Button>
          </div>
        </div>

        {/* KPI strip */}
        <div className="mb-4">
          <StatsCards stats={stats} loading={statsLoading} />
        </div>

        {/* Control card */}
        <div className="mb-4 rounded-xl border border-slate-200 bg-white">
          <div className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div role="tablist" aria-label="Email folders" className="inline-flex items-center gap-1 rounded-lg bg-slate-100 p-1">
              {TABS.map((t) => {
                const active = tab === t;
                return (
                  <button
                    key={t}
                    role="tab"
                    aria-selected={active}
                    onClick={() => changeTab(t)}
                    className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium capitalize transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 ${
                      active
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {active && <span className="h-1.5 w-1.5 rounded-full bg-brand" />}
                    {t}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-2">
              <div className="relative w-full sm:w-64">
                <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400">
                  <SearchIcon />
                </span>
                <Input
                  type="search"
                  placeholder="Search emails…"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  aria-label="Search emails"
                  className="h-9 pl-9 pr-8"
                />
                {isPending && (
                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400">
                    <Spinner size={14} />
                  </span>
                )}
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={reload}
                disabled={isFetching}
                aria-label="Refresh"
                title="Refresh"
                className="!h-9 !px-2.5"
              >
                <RefreshIcon spinning={isFetching} />
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-x-3 gap-y-2 border-t border-slate-100 p-3">
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
              Sender
              <div className="w-44">
                <Select
                  value={filters.senderId}
                  onChange={(e) => setFilter('senderId', e.target.value)}
                  aria-label="Filter by sender"
                >
                  <option value="">All senders</option>
                  {senders.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </div>
            </label>

            <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
              Status
              <div className="w-36">
                <Select
                  value={filters.status}
                  onChange={(e) => setFilter('status', e.target.value)}
                  aria-label="Filter by status"
                >
                  <option value="">All statuses</option>
                  {(tab === 'sent'
                    ? [
                        { value: 'SENT', label: 'Sent' },
                        { value: 'FAILED', label: 'Failed' },
                      ]
                    : [
                        { value: 'SCHEDULED', label: 'Scheduled' },
                        { value: 'RATE_LIMITED', label: 'Rate limited' },
                      ]
                  ).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </div>
            </label>

            <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
              Scheduled from
              <div className="w-36">
                <Input
                  type="date"
                  value={filters.from}
                  onChange={(e) => setFilter('from', e.target.value)}
                  aria-label="Scheduled from date"
                />
              </div>
            </label>

            <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
              Scheduled to
              <div className="w-36">
                <Input
                  type="date"
                  value={filters.to}
                  onChange={(e) => setFilter('to', e.target.value)}
                  aria-label="Scheduled to date"
                />
              </div>
            </label>

            {hasFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            )}

            <div className="ml-auto flex items-end gap-2">
              <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
                Sort by
                <div className="w-40">
                  <Select
                    value={sort.by}
                    onChange={(e) => setSortBy(e.target.value as SortBy)}
                    aria-label="Sort by"
                  >
                    {SORT_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                </div>
              </label>
              <Button
                variant="secondary"
                size="sm"
                onClick={toggleSortDir}
                title="Toggle sort direction"
                aria-label={`Sort direction: ${sort.dir === 'asc' ? 'ascending' : 'descending'}`}
                className="h-[38px] gap-1.5"
              >
                <ArrowUpDownIcon dir={sort.dir} />
                {sort.dir === 'asc' ? 'Asc' : 'Desc'}
              </Button>
            </div>
          </div>
        </div>

        {isLoading ? (
          <EmailsTable rows={[]} tab={tab} loading />
        ) : error ? (
          <EmptyState
            title="Couldn't load emails"
            description={error}
            action={
              <Button size="sm" onClick={reload}>
                Try again
              </Button>
            }
          />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<InboxIcon />}
            title={
              noMatches
                ? searching
                  ? `No matches for “${search}”`
                  : 'No emails match these filters'
                : tab === 'scheduled'
                  ? 'No scheduled emails yet'
                  : 'No sent emails yet'
            }
            description={
              noMatches
                ? 'Try loosening the search or filters, or clear them to see everything.'
                : tab === 'scheduled'
                  ? 'Compose a new email to schedule your first outreach.'
                  : 'Emails you send will appear here with their delivery status.'
            }
            action={
              noMatches ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setSearchInput('');
                    clearFilters();
                  }}
                >
                  Clear search & filters
                </Button>
              ) : tab === 'scheduled' ? (
                <Button size="sm" onClick={() => setComposeOpen(true)}>
                  <PlusIcon />
                  Compose New Email
                </Button>
              ) : undefined
            }
          />
        ) : (
          <EmailsTable
            rows={items}
            tab={tab}
            onCancel={cancel}
            footer={
              <Pagination
                page={page}
                pageSize={pageSize}
                total={total}
                totalPages={totalPages}
                isFetching={isFetching}
                onPage={setPage}
                onPageSize={setPageSize}
              />
            }
          />
        )}
      </main>

      {composeOpen && (
        <Suspense fallback={<OverlayLoader label="Opening composer…" />}>
          <ComposeModal open onClose={() => setComposeOpen(false)} onScheduled={handleScheduled} />
        </Suspense>
      )}
    </div>
  );
}

export default DashboardPage;