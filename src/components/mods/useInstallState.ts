import { useCallback, useEffect, useMemo, useState } from "react";
import { buildInstallIndex, installStateOf, type InstallState } from "../../lib/mods/installState";
import { listInstanceRecords, type ModRecord } from "../../lib/mods/instances";
import type { Tofu } from "../../models";
import { useApp } from "../../state/AppContext";
import { useTofuUpdates } from "../../state/modUpdates";

const NONE: InstallState = { kind: "none" };

/**
 * What each listed mod is in `tofu`: not there, downloading (with progress), downloaded, or out of date. Built from the
 * Tofu's install records (kept on disk, so it survives restarts), the live download list and the in-memory update check.
 */
export function useInstallState(tofu: Pick<Tofu, "id"> | null): (item: { source: string; id: string }) => InstallState {
  const { downloads } = useApp();
  const updates = useTofuUpdates(tofu?.id);
  const [records, setRecords] = useState<ModRecord[]>([]);
  const finished = downloads.filter((download) => download.tofuId === tofu?.id && download.status === "completed").length;
  useEffect(() => {
    if (!tofu) { setRecords([]); return; }
    let live = true;
    void listInstanceRecords(tofu.id).then((next) => { if (live) setRecords(next); }).catch(() => undefined);
    return () => { live = false; };
  }, [tofu?.id, finished, updates.check?.checkedAt, updates.updating.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const index = useMemo(() => (tofu ? buildInstallIndex(tofu.id, records, downloads, updates.check?.items ?? []) : null), [tofu?.id, records, downloads, updates.check]); // eslint-disable-line react-hooks/exhaustive-deps
  return useCallback((item) => (index ? installStateOf(index, item) : NONE), [index]);
}
