import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, CheckCircle2, AlertCircle } from 'lucide-react';
import { IconButton, Button } from './kit.jsx';

let locks = 0;
function lockScroll() {
  locks += 1;
  if (locks === 1) document.body.style.overflow = 'hidden';
  return () => { locks -= 1; if (locks === 0) document.body.style.overflow = ''; };
}

export function Sheet({ title, onClose, children, footer, wide, initialFocus = true }) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const unlock = lockScroll();
    const prev = document.activeElement;
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeRef.current?.(); } };
    document.addEventListener('keydown', onKey);
    if (initialFocus) {
      requestAnimationFrame(() => {
        const el = ref.current?.querySelector('[data-autofocus], .sheet-body input:not([type=checkbox]), .sheet-body select, .sheet-body textarea');
        const isTouch = window.matchMedia?.('(pointer: coarse)').matches;
        if (el && (!isTouch || el.hasAttribute('data-autofocus'))) el.focus({ preventScroll: true });
        else ref.current?.focus({ preventScroll: true });
      });
    }
    return () => { unlock(); document.removeEventListener('keydown', onKey); prev?.focus?.({ preventScroll: true }); };
  }, [initialFocus]);
  return createPortal(
    <div className="sheet-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div ref={ref} tabIndex={-1} className={`sheet ${wide ? 'sheet-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <IconButton icon={X} label="Close" onClick={onClose} />
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

const FeedbackCtx = createContext(null);

export function FeedbackProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [confirmState, setConfirmState] = useState(null);

  const toast = useCallback((message, opts = {}) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t.slice(-2), { id, message, tone: opts.tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), opts.tone === 'error' ? 5000 : 2800);
  }, []);

  const confirm = useCallback((opts) => new Promise((resolve) => {
    setConfirmState({ ...opts, resolve });
  }), []);

  const close = (value) => {
    confirmState?.resolve(value);
    setConfirmState(null);
  };

  return (
    <FeedbackCtx.Provider value={{ toast, confirm }}>
      {children}
      <div className="toast-wrap" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone === 'error' ? 'toast-error' : ''}`}>
            {t.tone === 'error' ? <AlertCircle size={18} aria-hidden="true" /> : <CheckCircle2 size={18} aria-hidden="true" />}
            <span>{t.message}</span>
          </div>
        ))}
      </div>
      {confirmState && (
        <Sheet title={confirmState.title || 'Are you sure?'} onClose={() => close(false)}
          footer={(
            <>
              <Button onClick={() => close(false)}>{confirmState.cancelLabel || 'Keep it'}</Button>
              <Button variant="primary" data-autofocus onClick={() => close(true)}>{confirmState.confirmLabel || 'Continue'}</Button>
            </>
          )}>
          {confirmState.message && <p className="muted">{confirmState.message}</p>}
        </Sheet>
      )}
    </FeedbackCtx.Provider>
  );
}

export const useFeedback = () => useContext(FeedbackCtx);

// Run an async action with a busy flag; errors become a toast.
export function useAction() {
  const { toast } = useFeedback();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (fn, success) => {
    setBusy(true);
    try {
      const out = await fn();
      if (success) toast(typeof success === 'function' ? success(out) : success);
      return out;
    } catch (e) {
      toast(e.message || 'Something went wrong.', { tone: 'error' });
      return undefined;
    } finally {
      setBusy(false);
    }
  }, [toast]);
  return [run, busy];
}
