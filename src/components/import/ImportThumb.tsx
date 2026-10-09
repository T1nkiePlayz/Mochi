import { memo, useState } from "react";
import { Gamepad2 } from "lucide-react";

/** Small Steam store capsule (~5-10KB) for `steam:<appid>` ids; null for anything else (e.g. non-Steam shortcuts). */
export function steamCapsuleUrl(id: string): string | null {
  const match = /^steam:(\d+)$/.exec(id);
  return match ? `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${match[1]}/capsule_184x69.jpg` : null;
}

// Remembered across unmount/remount (virtualised scrolling) so a known-404 is never refetched.
const failed = new Set<string>();

export const ImportThumb = memo(function ImportThumb({ id }: { id: string }) {
  const url = steamCapsuleUrl(id);
  const [errored, setErrored] = useState(() => failed.has(id));
  const [loaded, setLoaded] = useState(false);
  const placeholder = <Gamepad2 size={16} />;
  if (!url || errored) return placeholder;
  return (
    <>
      {!loaded && placeholder}
      <img
        className={"sgp-thumb-img" + (loaded ? " loaded" : "")} src={url} alt="" width={72} height={34} loading="lazy" decoding="async"
        onLoad={() => setLoaded(true)} onError={() => { failed.add(id); setErrored(true); }}
      />
    </>
  );
});
