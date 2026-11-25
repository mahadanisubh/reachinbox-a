import { memo, type ReactNode } from 'react';
import type { EmailStats } from '../types';
import { formatRelative, fullTimestamp } from '../lib/format';

interface Props {
  stats: EmailStats | null;
  loading: boolean;
}

type Tone = 'indigo' | 'emerald' | 'red' | 'amber';

const chipTone: Record<Tone, string> = {
  indigo: 'bg-indigo-50 text-indigo-600',
  emerald: 'bg-emerald-50 text-emerald-600',
  red: 'bg-red-50 text-red-600',
  amber: 'bg-amber-50 text-amber-600',
};

function ClockIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 7.5V12l3 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M21 4 3 11l7 2 2 7 9-16Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="m10 13 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 4 3 20h18L12 4Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M12 10v4m0 3v.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function HourglassIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7 4h10M7 20h10M8 4c0 4 8 4 8 8s-8 4-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

const StatCard = memo(function StatCard({
  label,
  value,
  subline,
  tone,
  icon,
  loading,
  title,
}: {
  label: string;
  value: number;
  subline: string;
  tone: Tone;
  icon: ReactNode;
  loading: boolean;
  title?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
        <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${chipTone[tone]}`}>
          {icon}
        </span>
      </div>
      {loading ? (
        <div className="mt-2 h-8 w-12 animate-pulse rounded-md bg-slate-200/70" aria-hidden="true" />
      ) : (
        <p className="mt-1.5 text-2xl font-semibold tracking-tight text-slate-900 tnum" title={title}>
          {value.toLocaleString()}
        </p>
      )}
      <p className="mt-0.5 truncate text-xs text-slate-500" title={title}>
        {subline}
      </p>
    </div>
  );
});

export function StatsCards({ stats, loading }: Props) {
  const next = stats?.nextSendAt ?? null;
  const failed = stats?.failed ?? 0;
  const rateLimited = stats?.rateLimited ?? 0;

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatCard
        label="Scheduled"
        value={stats?.scheduled ?? 0}
        subline={next ? `Next ${formatRelative(next)}` : 'Nothing queued'}
        title={next ? fullTimestamp(next) : undefined}
        tone="indigo"
        icon={<ClockIcon />}
        loading={loading}
      />
      <StatCard
        label="Sent"
        value={stats?.sent ?? 0}
        subline="Delivered (simulated)"
        tone="emerald"
        icon={<SendIcon />}
        loading={loading}
      />
      <StatCard
        label="Failed"
        value={failed}
        subline={failed > 0 ? 'Needs attention' : 'None'}
        tone="red"
        icon={<AlertIcon />}
        loading={loading}
      />
      <StatCard
        label="Rate limited"
        value={rateLimited}
        subline={rateLimited > 0 ? 'Deferring to next window' : 'None'}
        tone="amber"
        icon={<HourglassIcon />}
        loading={loading}
      />
    </div>
  );
}