import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';

// Fetch a GET endpoint. Returns { data, error, loading, reload, setData }.
export function useData(path, params) {
  const key = path ? path + JSON.stringify(params || {}) : null;
  const [state, setState] = useState({ data: null, error: null, loading: !!key });
  const seq = useRef(0);
  const paramsRef = useRef(params);
  paramsRef.current = params;

  const load = useCallback(async (quiet = false) => {
    if (!path) return;
    const n = ++seq.current;
    if (!quiet) setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await api.get(path, paramsRef.current);
      if (n === seq.current) setState({ data, error: null, loading: false });
    } catch (error) {
      if (n === seq.current) setState((s) => ({ ...s, error, loading: false }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => { load(); }, [load]);

  const setData = useCallback((d) => setState((s) => ({ ...s, data: typeof d === 'function' ? d(s.data) : d })), []);
  return { ...state, reload: () => load(true), setData };
}
