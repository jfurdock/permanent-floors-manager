import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, getToken, setToken, accessStatus } from './api.js';
import { navigate } from './router.jsx';

const Ctx = createContext(null);

export function SessionProvider({ children }) {
  const [state, setState] = useState({ status: 'loading', user: null, settings: {} });

  const refresh = useCallback(async () => {
    try {
      const access = await accessStatus();
      if (access.required && !access.ok) { setState({ status: 'access', user: null, settings: {} }); return; }
    } catch (e) {
      setState({ status: 'error', error: e, user: null, settings: {} });
      return;
    }
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
    const onAccess = () => setState({ status: 'access', user: null, settings: {} });
    window.addEventListener('pf:signed-out', onOut);
    window.addEventListener('pf:access-required', onAccess);
    return () => { window.removeEventListener('pf:signed-out', onOut); window.removeEventListener('pf:access-required', onAccess); };
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
