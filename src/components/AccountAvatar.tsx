import { useEffect, useState } from "react";
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

  useEffect(() => {
    let cancelled = false;
    const email = user?.email?.trim();

    if (!email) {
      setGravatarUrl(null);
      return;
    }

    void sha256(email).then((hash) => {
      if (!cancelled) {
        setGravatarUrl(`https://0.gravatar.com/avatar/${hash}?s=${size * 2}&d=identicon&r=pg`);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [user?.email, size]);

  if (!user) {
    return <span className={`account-avatar ${className}`} style={{ width: size, height: size }} aria-hidden="true">A</span>;
  }

  const providerAvatar = typeof user.user_metadata?.avatar_url === "string"
    ? user.user_metadata.avatar_url
    : typeof user.user_metadata?.picture === "string"
      ? user.user_metadata.picture
      : null;

  return (
    <span className={`account-avatar ${className}`} style={{ width: size, height: size }}>
      {(providerAvatar || gravatarUrl) ? (
        <img src={providerAvatar || gravatarUrl || ""} alt="" referrerPolicy="no-referrer" />
      ) : (
        <span>{user.email?.slice(0, 1).toUpperCase() ?? "U"}</span>
      )}
    </span>
  );
}
