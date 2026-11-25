import { Spinner } from './Button';

/** Full-viewport loader for route/auth transitions (no layout shift). */
export function FullScreenLoader({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex min-h-full items-center justify-center" role="status" aria-live="polite">
      <div className="flex flex-col items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand text-lg font-bold text-white">
          R
        </div>
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner size={16} />
          <span>{label}</span>
        </div>
      </div>
    </div>
  );
}

/** Centered overlay for lazily-loaded chunks (e.g. the compose modal). */
export function OverlayLoader({ label = 'Loading…' }: { label?: string }) {
  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/20 motion-safe:animate-fade-in"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-2 rounded-xl bg-white px-4 py-3 text-sm text-slate-600 shadow-lg">
        <Spinner size={18} />
        <span>{label}</span>
      </div>
    </div>
  );
}