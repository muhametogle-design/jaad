import { useEffect, useRef, useState } from 'react';
import { useApp } from './AppProvider';

export interface AsyncState<T> {
  data?: T;
  loading: boolean;
  error?: string;
}

/**
 * Tiny data-fetch hook bound to the app refresh bus: any mutation that
 * calls `bump()` re-runs every subscribed query. Keeps the UI honest
 * without a heavy state library.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: ReadonlyArray<unknown>): AsyncState<T> {
  const { version } = useApp();
  const [state, setState] = useState<AsyncState<T>>({ loading: true });
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    let active = true;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    fnRef
      .current()
      .then((data) => {
        if (active) setState({ data, loading: false });
      })
      .catch((e: unknown) => {
        if (active) {
          setState({
            data: undefined,
            loading: false,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version]);

  return state;
}
