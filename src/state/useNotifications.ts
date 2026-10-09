import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Behavior } from "./settings";
import { createNotifyBatcher, type NotifyBatcher } from "../lib/notifyBatch";

export type AppNotification = { id: string; title: string; message: string; createdAt: number; progress?: { value: number; total: number } };

export function useNotifications(behavior: Behavior) {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const behaviorRef = useRef(behavior);
  behaviorRef.current = behavior;

  const deliver = useCallback((title: string, message: string) => {
    const current = behaviorRef.current;
    if (!current.notificationsEnabled) return;
    if (current.inAppNotifications) setNotifications((list) => [{ id: crypto.randomUUID(), title, message, createdAt: Date.now() }, ...list].slice(0, 20));
    if (current.systemNotifications) void invoke("send_system_notification", { title, body: message }).catch(() => {});
  }, []);

  const batcher = useRef<NotifyBatcher | null>(null);
  if (!batcher.current) batcher.current = createNotifyBatcher((_group, notice) => deliver(notice.title, notice.message));
  useEffect(() => () => batcher.current?.flushAll(), []);

  /** Stable across renders so effects and timers can call it without going stale. Same-`group` notices in a burst become one. */
  const notify = useCallback((title: string, message: string, opts?: { group?: string; item?: string }) => {
    if (!behaviorRef.current.notificationsEnabled) return;
    if (opts?.group) batcher.current?.add(opts.group, { title, message, item: opts.item });
    else deliver(title, message);
  }, [deliver]);

  const startProgress = useCallback((title: string, message: string, total: number) => {
    const id = crypto.randomUUID();
    const current = behaviorRef.current;
    if (current.notificationsEnabled && current.inAppNotifications) {
      setNotifications((list) => [{ id, title, message, createdAt: Date.now(), progress: { value: 0, total } }, ...list].slice(0, 20));
    }
    return id;
  }, []);

  const updateProgress = useCallback((id: string, progress: { value: number; total: number }, message: string) => {
    setNotifications((list) => list.map((item) => (item.id === id ? { ...item, message, progress } : item)));
  }, []);

  return { notifications, setNotifications, showNotifications, setShowNotifications, notify, startProgress, updateProgress };
}
