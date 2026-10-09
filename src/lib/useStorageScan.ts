import { useCallback, useEffect, useRef, useState } from "react";
import type { Piko } from "../models";
import { subscribeNative } from "./nativeEvents";
import { applyProgress, cancelStorageScan, scanRequestFor, scanStorage, type Measurement, type StorageLocation, type StorageProgress } from "./diskUsage";

/** Runs a storage scan on demand and fills `measurements` in as the native side reports each location. */
export function useStorageScan(library: Piko[]) {
  const [locations, setLocations] = useState<StorageLocation[]>([]);
  const [measurements, setMeasurements] = useState<Record<string, Measurement>>({});
  const [scanning, setScanning] = useState(false);
  const [started, setStarted] = useState(false);
  const [error, setError] = useState("");
  const job = useRef<number | null>(null);
  const starting = useRef(false);
  const early = useRef<StorageProgress[]>([]);
  const libraryRef = useRef(library);
  libraryRef.current = library;

  useEffect(() => {
    const offProgress = subscribeNative<StorageProgress>("storage-scan-progress", (event) => {
      // Events can beat the reply that carries the job id; keep them until it is known.
      if (job.current === null) { if (starting.current) early.current.push(event); return; }
      if (event.job === job.current) setMeasurements((current) => applyProgress(current, event));
    });
    const offFinished = subscribeNative<{ job: number; cancelled: boolean }>("storage-scan-finished", (event) => { if (event.job === job.current) setScanning(false); });
    return () => { offProgress(); offFinished(); if (job.current !== null) void cancelStorageScan(job.current).catch(() => {}); };
  }, []);

  const scan = useCallback(async () => {
    if (job.current !== null) void cancelStorageScan(job.current).catch(() => {});
    job.current = null; starting.current = true; early.current = [];
    setStarted(true); setScanning(true); setError(""); setMeasurements({}); setLocations([]);
    try {
      const reply = await scanStorage(scanRequestFor(libraryRef.current));
      job.current = reply.job; starting.current = false;
      setLocations(reply.locations);
      setMeasurements(early.current.filter((event) => event.job === reply.job).reduce(applyProgress, {} as Record<string, Measurement>));
      early.current = [];
    } catch (cause) {
      starting.current = false; setScanning(false);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  const cancel = useCallback(() => { if (job.current !== null) void cancelStorageScan(job.current).catch(() => {}); setScanning(false); }, []);
  return { locations, measurements, scanning, started, error, scan, cancel };
}
