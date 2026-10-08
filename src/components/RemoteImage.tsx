import { useState, type ImgHTMLAttributes, type ReactNode } from "react";

/** An <img> for remote artwork that swaps to `fallback` (or nothing) when it cannot load, e.g. offline. */
export function RemoteImage({ fallback = null, onError, ...props }: ImgHTMLAttributes<HTMLImageElement> & { fallback?: ReactNode }) {
  const [failed, setFailed] = useState(false);
  if (failed || !props.src) return <>{fallback}</>;
  return <img {...props} alt={props.alt ?? ""} onError={(event) => { setFailed(true); onError?.(event); }} />;
}
