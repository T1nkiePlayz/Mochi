let announced = false;

/** The text of the once-per-session notice, or null when it was already shown or nothing needed a fallback. */
export function fallbackNoticeOnce(unavailable: readonly string[], using: string): string | null {
  if (announced || unavailable.length === 0) return null;
  announced = true;
  const names = unavailable.length === 1 ? `“${unavailable[0]}”` : unavailable.map((id) => `“${id}”`).join(", ");
  return `The sound pack ${names} ${unavailable.length === 1 ? "is" : "are"} missing or could not be loaded, so Mochi is using “${using}” instead.`;
}

/** For tests. */
export const resetFallbackNotice = () => { announced = false; };
