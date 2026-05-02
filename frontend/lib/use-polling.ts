"use client";

import { useState, useEffect, useCallback, useRef } from "react";

/// Lifted from the prior Delibera frontend (battle-tested) and trimmed.
/// Polls `fetcher` every `intervalMs`, exposes `data`, `error`, and a manual
/// `refresh`. `error` is a boolean: true when the most recent fetch returned
/// null/threw, false when it returned data.
export function usePolling<T>(
  fetcher: () => Promise<T | null>,
  intervalMs: number = 2000,
): { data: T | null; error: boolean; refresh: () => Promise<void> } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState(false);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const result = await fetcher();
      if (!mountedRef.current) return;
      if (result !== null && result !== undefined) {
        setData(result);
        setError(false);
      } else {
        setError(true);
      }
    } catch {
      if (!mountedRef.current) return;
      setError(true);
    }
  }, [fetcher]);

  useEffect(() => {
    mountedRef.current = true;
    refresh();
    const id = setInterval(refresh, intervalMs);
    return () => {
      mountedRef.current = false;
      clearInterval(id);
    };
  }, [refresh, intervalMs]);

  return { data, error, refresh };
}
