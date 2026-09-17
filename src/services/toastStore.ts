// A tiny global toast store — no React Context anywhere else in this app, so this stays a
// plain module-level subscriber store instead of introducing the first Provider. Any
// component can call showToast() without being wired through props first.
export type ToastType = 'success' | 'error' | 'info';

export interface ToastItem {
  id: number;
  type: ToastType;
  text: string;
}

const MAX_VISIBLE = 2;
const AUTO_DISMISS_MS = 4500;

let nextId = 1;
let toasts: ToastItem[] = [];
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getToasts(): ToastItem[] {
  return toasts;
}

export function dismissToast(id: number): void {
  toasts = toasts.filter((t) => t.id !== id);
  notify();
}

// Newest two always visible: a third arrival drops the oldest rather than queuing, so a toast
// never shows up long after the moment it was about.
export function showToast(type: ToastType, text: string): void {
  const id = nextId++;
  toasts = [...toasts, { id, type, text }].slice(-MAX_VISIBLE);
  notify();
  setTimeout(() => dismissToast(id), AUTO_DISMISS_MS);
}
