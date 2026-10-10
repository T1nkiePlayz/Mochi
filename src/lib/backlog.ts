import type { Piko } from "../models";

export type BacklogStatus = NonNullable<Piko["backlog"]>["status"];
export type Backlog = NonNullable<Piko["backlog"]>;

export const backlogStatuses: Array<{ id: BacklogStatus; label: string }> = [
  { id: "want", label: "Want to play" },
  { id: "playing", label: "Playing" },
  { id: "finished", label: "Finished" },
  { id: "dropped", label: "Dropped" },
];

export const backlogLabel = (status: BacklogStatus) => backlogStatuses.find((item) => item.id === status)?.label ?? status;
export const NOTE_MAX = 280;

/** In the backlog = still to be played (wanted or in progress); finished and dropped games leave it. */
export const isInBacklog = (piko: Piko) => piko.backlog?.status === "want" || piko.backlog?.status === "playing";

/** Queued as "Next up": still to be played and marked by the user. */
export const isNextUp = (piko: Piko) => isInBacklog(piko) && piko.backlog?.nextUp === true;

/** Adds or removes the "Next up" mark. Needs an existing entry; a finished or dropped game cannot be queued. */
export function withNextUp(current: Backlog | undefined, nextUp: boolean): Backlog | undefined {
  if (!current) return current;
  const { nextUp: _old, ...rest } = current;
  return nextUp && (current.status === "want" || current.status === "playing") ? { ...rest, nextUp: true } : rest;
}

/** The next backlog value for a status change: `null` status clears it; the note and original add time are kept. */
export function withBacklogStatus(current: Backlog | undefined, status: BacklogStatus | null, now = Date.now()): Backlog | undefined {
  if (!status) return undefined;
  // Finished and dropped games leave the "Next up" queue.
  const { nextUp, ...rest } = current ?? {};
  return { ...rest, status, addedAt: current?.addedAt ?? now, ...(nextUp && (status === "want" || status === "playing") ? { nextUp: true } : {}) };
}

/** Updates the note (trimmed, capped); an empty note is removed. Needs an existing entry. */
export function withBacklogNote(current: Backlog | undefined, note: string, now = Date.now()): Backlog {
  const clean = note.trim().slice(0, NOTE_MAX);
  const { note: _old, ...rest } = current ?? { status: "want" as const, addedAt: now };
  return clean ? { ...rest, note: clean } : rest;
}

/** Load-time safety: a stored backlog value with an unknown status or bad fields is dropped. */
export function sanitizeBacklog(value: unknown): Backlog | undefined {
  if (!value || typeof value !== "object") return undefined;
  const { status, note, addedAt, nextUp } = value as Record<string, unknown>;
  if (!backlogStatuses.some((item) => item.id === status)) return undefined;
  return { status: status as BacklogStatus, ...(typeof note === "string" && note ? { note: note.slice(0, NOTE_MAX) } : {}), addedAt: typeof addedAt === "number" && Number.isFinite(addedAt) ? addedAt : 0, ...(nextUp === true && (status === "want" || status === "playing") ? { nextUp: true } : {}) };
}
