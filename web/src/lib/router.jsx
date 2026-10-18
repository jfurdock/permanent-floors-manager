// Tiny router. Uses the URL hash in the installed app (so the phone's back button works)
// and an in-memory history in the demo, where the page's URL can't be changed.
import { useSyncExternalStore } from 'react';

const memoryMode = __DEMO__;
const stack = ['/'];
const listeners = new Set();
const scrollMemo = new Map();
let lastNav = 'push';
let navCount = 0;

const emit = () => listeners.forEach((l) => l());
const current = () => (memoryMode ? stack[stack.length - 1] : decodeURI(window.location.hash.slice(1)) || '/');

let pending = null; // 'push' | 'back' while our own navigation is in flight
if (!memoryMode) {
  window.addEventListener('hashchange', () => {
    if (pending) { lastNav = pending; pending = null; } else { lastNav = 'back'; navCount = Math.max(0, navCount - 1); }
    emit();
  });
}

export function navigate(to, { replace = false } = {}) {
  scrollMemo.set(current(), window.scrollY);
  if (memoryMode) {
    if (replace) stack[stack.length - 1] = to; else stack.push(to);
    lastNav = 'push';
    emit();
    return;
  }
  if (replace) {
    window.history.replaceState(null, '', `#${to}`);
    lastNav = 'push';
    emit();
  } else {
    if (current() === to) return;
    navCount += 1;
    pending = 'push';
    window.location.hash = to;
  }
}

export function back(fallback = '/') {
  scrollMemo.set(current(), window.scrollY);
  if (memoryMode) {
    if (stack.length > 1) stack.pop(); else stack[0] = fallback;
    lastNav = 'back';
    emit();
    return;
  }
  if (navCount > 0) {
    navCount -= 1;
    pending = 'back';
    window.history.back();
  } else navigate(fallback, { replace: true });
}

export const lastNavigation = () => lastNav;
export const savedScroll = (path) => scrollMemo.get(path) || 0;

function subscribe(cb) { listeners.add(cb); return () => listeners.delete(cb); }

export function useRoute() {
  const full = useSyncExternalStore(subscribe, current, current);
  const [beforeAnchor, anchor = ''] = full.split('#');
  const [path, qs] = beforeAnchor.split('?');
  return { full, path: path || '/', anchor, query: Object.fromEntries(new URLSearchParams(qs || '').entries()) };
}

export function match(pattern, path) {
  const keys = [];
  const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}/?$`);
  const m = path.match(re);
  if (!m) return null;
  return Object.fromEntries(keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
}

export function Link({ to, children, onClick, replace, ...rest }) {
  return (
    <a
      href={`#${to}`}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(to, { replace });
      }}
      {...rest}
    >
      {children}
    </a>
  );
}
