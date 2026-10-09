/**
 * App-wide "Are you sure?" prompts. `confirmAction` resolves true/false once the user answers the themed
 * dialog rendered by `<ConfirmHost />` (mounted once in AppProvider). Usable from hooks and plain functions,
 * so no flow needs `window.confirm` (which is unthemed and blocks the WebView).
 */
export type ConfirmRequest = {
  title: string;
  /** One or two sentences: what happens and what is kept. */
  message: string;
  confirmLabel: string;
  /** Red confirm button; use for anything that deletes or cannot be undone. */
  danger?: boolean;
  /** Exactly what will be deleted, listed under the message (names, counts). */
  items?: string[];
};

type Pending = ConfirmRequest & { id: number; resolve: (ok: boolean) => void };
type Listener = (queue: Pending[]) => void;

let queue: Pending[] = [];
let seq = 0;
const listeners = new Set<Listener>();
const emit = () => listeners.forEach((listener) => listener(queue));

export function confirmAction(request: ConfirmRequest): Promise<boolean> {
  // Without a mounted host (tests, early start-up) fall back to the native prompt rather than silently proceeding.
  if (!listeners.size) {
    try { return Promise.resolve(typeof window !== "undefined" && window.confirm(`${request.title}\n\n${request.message}`)); } catch { return Promise.resolve(false); }
  }
  return new Promise((resolve) => {
    queue = [...queue, { ...request, id: ++seq, resolve }];
    emit();
  });
}

/** Answers the oldest open request. */
export function answerConfirm(id: number, ok: boolean) {
  const item = queue.find((entry) => entry.id === id);
  if (!item) return;
  queue = queue.filter((entry) => entry.id !== id);
  emit();
  item.resolve(ok);
}

export function subscribeConfirm(listener: Listener): () => void {
  listeners.add(listener);
  listener(queue);
  return () => { listeners.delete(listener); };
}

export type { Pending as PendingConfirm };
