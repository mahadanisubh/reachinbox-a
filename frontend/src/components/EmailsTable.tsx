import { memo, useRef, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { EmailRow } from '../types';
import type { Tab } from '../hooks/useEmails';
import { StatusBadge } from './StatusBadge';
import { Button } from './Button';
import { TableSkeleton } from './Skeleton';
import { formatDateTime, formatRelative, fullTimestamp } from '../lib/format';

interface Props {
  rows: EmailRow[];
  tab: Tab;
  loading?: boolean;
  onCancel?: (id: string) => void;
  footer?: ReactNode;
}

const ROW_ESTIMATE = 58;
const OVERSCAN = 12;

/** Cells only - rendered inside a `role="row"` element by the table. */
const EmailRowCells = memo(function EmailRowCells({
  row,
  tab,
  onCancel,
}: {
  row: EmailRow;
  tab: Tab;
  onCancel?: (id: string) => void;
}) {
  const when = tab === 'sent' ? row.sentAt ?? row.scheduledAt : row.scheduledAt;

  const action =
    tab === 'scheduled' ? (
      onCancel && row.status !== 'CANCELLED' ? (
        <Button variant="ghost" size="sm" onClick={() => onCancel(row.id)}>
          Cancel
        </Button>
      ) : null
    ) : row.previewUrl ? (
      <a
        href={row.previewUrl}
        target="_blank"
        rel="noreferrer"
        className="text-xs font-medium text-brand hover:underline"
      >
        Preview
      </a>
    ) : null;

  return (
    <>
      <div role="cell" className="eg-email">
        <span className="block truncate font-medium text-slate-800" title={row.toEmail}>
          {row.toEmail}
        </span>
      </div>

      <div role="cell" className="eg-subject">
        <span className="block truncate text-slate-700" title={row.subject}>
          {row.subject}
        </span>
        {row.error && (
          <span className="block truncate text-xs text-red-600" title={row.error}>
            {row.error}
          </span>
        )}
        <span className="mt-0.5 block text-xs text-slate-500 sm:hidden tnum" title={fullTimestamp(when)}>
          {formatDateTime(when)}
        </span>
      </div>

      <div
        role="cell"
        className="eg-time hidden text-slate-500 sm:block tnum"
        title={fullTimestamp(when)}
      >
        {formatDateTime(when)}
        <span className="ml-1.5 text-xs text-slate-400">{formatRelative(when)}</span>
      </div>

      <div role="cell" className="eg-status">
        <StatusBadge status={row.status} />
      </div>

      <div role="cell" className="eg-action sm:text-right">
        {action}
      </div>
    </>
  );
});

export function EmailsTable({ rows, tab, loading = false, onCancel, footer }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_ESTIMATE,
    overscan: OVERSCAN,
    getItemKey: (index) => rows[index]?.id ?? index,
  });

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div
        ref={scrollRef}
        role="table"
        aria-rowcount={rows.length}
        aria-label={`${tab} emails`}
        className="h-[58vh] max-h-[620px] min-h-[240px] overflow-auto overscroll-contain"
      >
        <div role="rowgroup" className="sticky top-0 z-10">
          <div
            role="row"
            className="email-grid hidden border-b border-slate-200 bg-slate-50/95 px-4 py-3 backdrop-blur sm:grid"
          >
            <span role="columnheader" className="eg-email text-xs font-medium uppercase tracking-wide text-slate-500">
              Email
            </span>
            <span role="columnheader" className="eg-subject text-xs font-medium uppercase tracking-wide text-slate-500">
              Subject
            </span>
            <span
              role="columnheader"
              className="eg-time hidden text-xs font-medium uppercase tracking-wide text-slate-500 sm:block"
            >
              {tab === 'sent' ? 'Sent time' : 'Scheduled time'}
            </span>
            <span role="columnheader" className="eg-status text-xs font-medium uppercase tracking-wide text-slate-500">
              Status
            </span>
            <span
              role="columnheader"
              className="eg-action hidden text-xs font-medium uppercase tracking-wide text-slate-500 sm:block"
            />
          </div>
        </div>

        {loading ? (
          <TableSkeleton />
        ) : (
          <div
            role="rowgroup"
            style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative', width: '100%' }}
          >
            {virtualizer.getVirtualItems().map((item) => {
              const row = rows[item.index];
              if (!row) return null;
              return (
                <div
                  key={item.key}
                  data-index={item.index}
                  ref={virtualizer.measureElement}
                  role="row"
                  aria-rowindex={item.index + 1}
                  className="email-grid absolute left-0 top-0 w-full border-b border-slate-100 px-4 py-3 text-sm transition-colors hover:bg-slate-50/70"
                  style={{ transform: `translateY(${item.start}px)` }}
                >
                  <EmailRowCells row={row} tab={tab} onCancel={onCancel} />
                </div>
              );
            })}
          </div>
        )}
      </div>
      {footer && <div className="border-t border-slate-100">{footer}</div>}
    </div>
  );
}
