/** Themed PIN entry, like `confirmAction`: resolves with the typed PIN, or null when cancelled. Rendered by `<PinHost />`. */
export type PinRequest = { title: string; message: string; /** Shown under the field after a wrong try. */ error?: string };
type Pending = PinRequest & { id: number; resolve: (pin: string | null) => void };
type Listener = (queue: Pending[]) => void;

let queue: Pending[] = [];
let seq = 0;
const listeners = new Set<Listener>();
const emit = () => listeners.forEach((listener) => listener(queue));

export const askPin = (request: PinRequest): Promise<string | null> => listeners.size
  ? new Promise((resolve) => { queue = [...queue, { ...request, id: ++seq, resolve }]; emit(); })
  : Promise.resolve(null);

export function answerPin(id: number, pin: string | null) {
  const item = queue.find((entry) => entry.id === id);
  if (!item) return;
  queue = queue.filter((entry) => entry.id !== id);
  emit();
  item.resolve(pin);
}

export function subscribePin(listener: Listener): () => void { listeners.add(listener); listener(queue); return () => { listeners.delete(listener); }; }
export type PendingPin = Pending;
