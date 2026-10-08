"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "@/lib/errors";

interface AsyncState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

/** Loads data on mount and exposes `reload`. Ignores results that arrive after unmount. */
export function useLoader<T>(
  load: () => Promise<T>,
): AsyncState<T> & { reload: () => void; setData: (data: T) => void } {
  const [state, setState] = useState<AsyncState<T>>({ data: null, error: null, loading: true });
  const loadRef = useRef(load);
  const alive = useRef(true);

  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  const fetchNow = useCallback(() => {
    loadRef.current().then(
      (data) => {
        if (alive.current) setState({ data, error: null, loading: false });
      },
      (error: unknown) => {
        if (alive.current) setState((current) => ({ ...current, error: errorMessage(error), loading: false }));
      },
    );
  }, []);

  const reload = useCallback(() => {
    setState((current) => ({ ...current, loading: true, error: null }));
    fetchNow();
  }, [fetchNow]);

  // Initial load. State starts as "loading", so nothing is set synchronously here.
  useEffect(() => {
    alive.current = true;
    fetchNow();
    return () => {
      alive.current = false;
    };
  }, [fetchNow]);

  const setData = useCallback((data: T) => setState({ data, error: null, loading: false }), []);
  return { ...state, reload, setData };
}

/** Runs one action at a time and reports a human-readable error. */
export function useAction(): {
  pending: boolean;
  error: string | null;
  clearError: () => void;
  run: <T>(action: () => Promise<T>, onSuccess?: (result: T) => void) => Promise<void>;
} {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async <T>(action: () => Promise<T>, onSuccess?: (result: T) => void) => {
    setPending(true);
    setError(null);
    try {
      const result = await action();
      onSuccess?.(result);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  }, []);
  return { pending, error, clearError: useCallback(() => setError(null), []), run };
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
