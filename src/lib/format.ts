export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 KiB";
  if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + " KiB";
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + " MiB";
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + " GiB";
}

export function formatPlaytime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export function formatRelativeTime(epochSeconds: number): string {
  const diff = Math.max(0, Date.now() / 1000 - epochSeconds);
  if (!Number.isFinite(diff) || diff < 90) return "just now";
  const unit = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"} ago`;
  if (diff < 3600) return unit(Math.floor(diff / 60), "minute");
  if (diff < 86400) return unit(Math.floor(diff / 3600), "hour");
  if (diff < 86400 * 30) return unit(Math.floor(diff / 86400), "day");
  return new Date(epochSeconds * 1000).toLocaleDateString();
}
