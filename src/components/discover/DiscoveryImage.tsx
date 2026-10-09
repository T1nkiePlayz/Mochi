import { useEffect, useState } from "react";
import { PackageOpen } from "lucide-react";
import minecraftGrassBlock from "../../assets/minecraft-grass-block.svg";

export function MinecraftIcon() {
  return <span className="minecraft-discovery-icon" aria-hidden="true"><img src={minecraftGrassBlock} alt="" width={24} height={24} draggable={false} /></span>;
}

export function DiscoveryImage({ src, className, alt, label }: { src: string; className: string; alt: string; label: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (failed) return <span className={`${className} fallback`} aria-label={label}>{label.trim().slice(0, 1).toUpperCase() || <PackageOpen size={18}/>}</span>;
  return <img src={src} className={className} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(true)} />;
}
