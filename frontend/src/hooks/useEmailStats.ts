import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import type { EmailStats } from '../types';

const POLL_MS = 10_000;

/**
 * Lightweight KPI counters (per-user). Polls while the tab is visible; failures
 * are silent because stats are non-critical to the task.
 */
export function useEmailStats() {
  const [stats, setStats] = useState<EmailStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const data = await api.stats(controller.signal);
      setStats(data);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      // silent: keep last known stats
    } finally {
      if (abortRef.current === controller) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const id = setInterval(tick, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  useEffect(() => () => abortRef.current?.abort(), []);

  return { stats, isLoading, refresh };
}