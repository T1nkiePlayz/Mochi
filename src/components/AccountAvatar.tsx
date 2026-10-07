import { useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";

type AccountAvatarProps = {
  user: User | null;
  size?: number;
  className?: string;
};

async function sha256(value: string) {
  const data = new TextEncoder().encode(value.trim().toLowerCase());
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function AccountAvatar({ user, size = 34, className = "" }: AccountAvatarProps) {
  const [gravatarUrl, setGravatarUrl] = useState<string | null>(null);
  const [providerFailed, setProviderFailed] = useState(false);
  const [gravatarFailed, setGravatarFailed] = useState(false);

  const providerAvatar = useMemo(() => {
    const avatar = user?.user_metadata?.avatar_url;
    if (typeof avatar === "string" && avatar.trim()) return avatar.trim();
    const picture = user?.user_metadata?.picture;
    return typeof picture === "string" && picture.trim() ? picture.trim() : null;
  }, [user]);

  useEffect(() => {
    let cancelled = false;
    setProviderFailed(false);
    setGravatarFailed(false);
    setGravatarUrl(null);

    const email = user?.email?.trim();
    if (!email) return;

    void sha256(email).then((hash) => {
      if (!cancelled) {
        setGravatarUrl(`https://0.gravatar.com/avatar/${hash}?s=${Math.max(64, size * 2)}&d=identicon&r=pg`);
      }
    }).catch(() => {
      if (!cancelled) setGravatarUrl(null);
    });

    return () => {
      cancelled = true;
    };
  }, [user?.email, size]);

  const fallbackLetter = user?.email?.trim().slice(0, 1).toUpperCase() ?? "U";
  const imageUrl = user && !providerFailed ? providerAvatar : null;
  const secondaryUrl = gravatarUrl && !gravatarFailed ? gravatarUrl : null;

  return (
    <span
      className={`account-avatar ${className}`}
      style={{ width: size, height: size, minWidth: size, minHeight: size, aspectRatio: "1 / 1" }}
      aria-hidden={user ? undefined : "true"}
    >
      {imageUrl ? (
        <img
          className="account-avatar-image"
          src={imageUrl}
          alt=""
          width={size}
          height={size}
          referrerPolicy="no-referrer"
          onError={() => setProviderFailed(true)}
        />
      ) : secondaryUrl ? (
        <img
          className="account-avatar-image"
          src={secondaryUrl}
          alt=""
          width={size}
          height={size}
          referrerPolicy="no-referrer"
          onError={() => setGravatarFailed(true)}
        />
      ) : user ? (
        <span>{fallbackLetter}</span>
      ) : (
        <span>U</span>
      )}
    </span>
  );
}
