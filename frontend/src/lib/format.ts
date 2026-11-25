const dateTimeFmt = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : dateTimeFmt.format(d);
}

/** Relative label for upcoming/past timestamps (e.g. "in 4m", "2h ago"). */
export function formatRelative(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const diff = t - now;
  const abs = Math.abs(diff);
  const min = 60_000;
  const hour = 60 * min;
  const day = 24 * hour;

  if (abs < min) return diff >= 0 ? 'now' : 'just now';
  const unit =
    abs < hour
      ? [Math.round(abs / min), 'm']
      : abs < day
        ? [Math.round(abs / hour), 'h']
        : [Math.round(abs / day), 'd'];
  return diff >= 0 ? `in ${unit[0]}${unit[1]}` : `${unit[0]}${unit[1]} ago`;
}

/** Full date/time plus a relative hint, for a title attribute. */
export function fullTimestamp(iso: string | null | undefined): string {
  const abs = formatDateTime(iso);
  if (abs === '—') return abs;
  return `${abs} (${formatRelative(iso)})`;
}
