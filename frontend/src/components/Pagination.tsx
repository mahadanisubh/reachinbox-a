import { memo } from 'react';
import { PAGE_SIZES } from '../hooks/useEmails';
import { Button } from './Button';

interface Props {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  isFetching: boolean;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}

export const Pagination = memo(function Pagination({
  page,
  pageSize,
  total,
  totalPages,
  isFetching,
  onPage,
  onPageSize,
}: Props) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <nav
      aria-label="Pagination"
      className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-xs"
    >
      <p className="text-slate-500 tnum" aria-live="polite">
        {total === 0 ? (
          'No results'
        ) : (
          <>
            <span className="font-medium text-slate-700">
              {from.toLocaleString()}–{to.toLocaleString()}
            </span>{' '}
            of <span className="font-medium text-slate-700">{total.toLocaleString()}</span>
          </>
        )}
        {isFetching && <span className="ml-2 text-slate-400">updating…</span>}
      </p>

      <div className="flex items-center gap-3">
        <label className="flex items-center gap-1.5 text-slate-500">
          <span className="hidden sm:inline">Rows</span>
          <select
            value={pageSize}
            onChange={(e) => onPageSize(Number(e.target.value))}
            className="h-8 rounded-lg border border-slate-300 bg-white py-1 pl-2 pr-7 text-xs text-slate-700 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
            aria-label="Rows per page"
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-center gap-1.5">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onPage(page - 1)}
            disabled={page <= 1 || isFetching}
          >
            Previous
          </Button>
          <span className="px-1 text-slate-500 tnum" aria-current="page">
            Page <span className="font-medium text-slate-700">{page.toLocaleString()}</span> /{' '}
            {totalPages.toLocaleString()}
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onPage(page + 1)}
            disabled={page >= totalPages || isFetching}
          >
            Next
          </Button>
        </div>
      </div>
    </nav>
  );
});