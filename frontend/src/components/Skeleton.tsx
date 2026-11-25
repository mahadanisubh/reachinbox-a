export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-md bg-slate-200/70 ${className}`}
      aria-hidden="true"
    />
  );
}

interface TableSkeletonProps {
  rows?: number;
}

/** Placeholder rows*/
export function TableSkeleton({ rows = 9 }: TableSkeletonProps) {
  return (
    <div className="divide-y divide-slate-100" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="grid grid-cols-1 gap-2 px-4 py-3.5 sm:grid-cols-[minmax(0,1.5fr)_minmax(0,1.6fr)_minmax(0,1fr)_7rem_5.5rem] sm:items-center sm:gap-3"
        >
          <Skeleton className="h-4 w-40 max-w-full" />
          <Skeleton className="h-4 w-56 max-w-full" />
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="h-4 w-12 justify-self-end" />
        </div>
      ))}
    </div>
  );
}
