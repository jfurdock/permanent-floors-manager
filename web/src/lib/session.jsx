import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, getToken, setToken } from './api.js';
import { navigate } from './router.jsx';

const Ctx = createContext(null);

export function SessionProvider({ children }) {
  const [state, setState] = useState({ status: 'loading', user: null, settings: {} });

  const refresh = useCallback(async () => {
    if (!getToken()) { setState({ status: 'signed-out', user: null, settings: {} }); return; }
    try {
      const me = await api.get('/auth/me');
      setState({ status: 'ready', user: me.user, settings: me.settings });
    } catch (e) {
      if (e.status === 401 || e.status === 403) { setToken(null); setState({ status: 'signed-out', user: null, settings: {} }); }
      else setState({ status: 'error', error: e, user: null, settings: {} });
    }
  }, []);

  useEffect(() => {
    refresh();
    const onOut = () => setState({ status: 'signed-out', user: null, settings: {} });
    window.addEventListener('pf:signed-out', onOut);
    return () => window.removeEventListener('pf:signed-out', onOut);
  }, [refresh]);

  const signIn = useCallback(async (token) => { setToken(token); navigate('/', { replace: true }); await refresh(); }, [refresh]);
  const signOut = useCallback(async () => {
    try { await api.post('/auth/logout'); } catch { /* already signed out */ }
    setToken(null);
    navigate('/', { replace: true });
    setState({ status: 'signed-out', user: null, settings: {} });
  }, []);
  const setSettings = useCallback((settings) => setState((s) => ({ ...s, settings })), []);

  const role = state.user?.role;
  const value = {
    ...state,
    refresh, signIn, signOut, setSettings,
    isInstaller: role === 'installer',
    isManager: role === 'admin' || role === 'manager',
    demo: __DEMO__ || state.settings?.demo_mode === '1',
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useSession = () => useContext(Ctx);
