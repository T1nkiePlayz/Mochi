// "Mods may not load" prompt shown before a launch, like lib/confirm: promise based, one at a time, rendered by <ConflictPromptHost />.
import type { Piko, Tofu } from "../../models";
import type { Issue } from "./conflicts";

export type ConflictChoice = "launch" | "cancel" | "launch-and-silence";
export type ConflictRequest = { piko: Pick<Piko, "name" | "tofus">; tofu: Tofu; issues: Issue[] };
type Pending = ConflictRequest & { id: number; resolve: (choice: ConflictChoice) => void };
type Listener = (queue: Pending[]) => void;

let queue: Pending[] = [];
let seq = 0;
const listeners = new Set<Listener>();
const emit = () => listeners.forEach((listener) => listener(queue));

/** Resolves with what the user chose. Without a mounted host (tests, early start-up) it resolves "launch": the check never blocks a launch. */
export function askConflictChoice(request: ConflictRequest): Promise<ConflictChoice> {
  if (!listeners.size) return Promise.resolve("launch");
  return new Promise((resolve) => { queue = [...queue, { ...request, id: ++seq, resolve }]; emit(); });
}

export function answerConflict(id: number, choice: ConflictChoice) {
  const item = queue.find((entry) => entry.id === id);
  if (!item) return;
  queue = queue.filter((entry) => entry.id !== id);
  emit();
  item.resolve(choice);
}

export function subscribeConflicts(listener: Listener): () => void {
  listeners.add(listener);
  listener(queue);
  return () => { listeners.delete(listener); };
}

export type { Pending as PendingConflict };
