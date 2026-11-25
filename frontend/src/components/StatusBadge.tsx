import { memo } from 'react';
import type { EmailStatus } from '../types';

const map: Record<EmailStatus, { label: string; className: string; dot: string }> = {
  SCHEDULED: { label: 'Scheduled', className: 'bg-indigo-50 text-indigo-700', dot: 'bg-indigo-500' },
  RATE_LIMITED: { label: 'Rate limited', className: 'bg-amber-50 text-amber-700', dot: 'bg-amber-500' },
  SENT: { label: 'Sent', className: 'bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500' },
  FAILED: { label: 'Failed', className: 'bg-red-50 text-red-700', dot: 'bg-red-500' },
  CANCELLED: { label: 'Cancelled', className: 'bg-slate-100 text-slate-600', dot: 'bg-slate-400' },
};

export const StatusBadge = memo(function StatusBadge({ status }: { status: EmailStatus }) {
  const s = map[status] ?? map.SCHEDULED;
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${s.className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} aria-hidden="true" />
      {s.label}
    </span>
  );
});
