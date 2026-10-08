import { useEffect, useState } from "react";
import { PackageOpen } from "lucide-react";

export function MinecraftIcon() {
  return <span className="minecraft-discovery-icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path fill="#91b85b" d="m12 1.5 10 4v12.8l-10 4.2-10-4.2V5.5z"/><path fill="#a8d16b" d="m2 5.5 10 4 10-4-10-4z"/><path fill="#5b4128" d="m2 5.5 10 4v13l-10-4.2z"/><path fill="#755536" d="m12 9.5 10-4v12.8l-10 4.2z"/></svg></span>;
}

export function DiscoveryImage({ src, className, alt, label }: { src: string; className: string; alt: string; label: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (failed) return <span className={`${className} fallback`} aria-label={label}>{label.trim().slice(0, 1).toUpperCase() || <PackageOpen size={18}/>}</span>;
  return <img src={src} className={className} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(true)} />;
}
