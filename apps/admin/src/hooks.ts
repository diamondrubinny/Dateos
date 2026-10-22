import { useCallback, useEffect, useState } from 'react';
import type { ApiError } from './api';

export interface AsyncState<T> {
  data: T | undefined;
  error: ApiError | Error | undefined;
  loading: boolean;
  reload: () => void;
}

export function useAsync<T>(load: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<ApiError | Error>();
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  // Callers pass the real dependencies of `load`.
  const run = useCallback(load, deps);

  useEffect(() => {
    let active = true;
    setLoading(true);
    run()
      .then((value) => {
        if (!active) return;
        setData(value);
        setError(undefined);
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [run, tick]);

  return { data, error, loading, reload: () => setTick((n) => n + 1) };
}

/** Minimal hash router: #/reports, #/reports/<id>, #/verifications, #/audit. */
export function useRoute(): string[] {
  const read = () => window.location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const [parts, setParts] = useState(read);
  useEffect(() => {
    const onChange = () => setParts(read());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return parts;
}
