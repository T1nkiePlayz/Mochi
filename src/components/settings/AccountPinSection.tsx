import { useState } from "react";
import { useTranslation } from "../../lib/useTranslation";
import { useApp } from "../../state/AppContext";
import { hasPin, PIN_PATTERN, removePin, setPin, verifyPin } from "../../lib/accountPin";
import { askPin } from "../../lib/pinPrompt";
import { SettingsGroup, ToggleRow } from "./Section";

/** Optional PIN for switching to a saved account. Off by default. */
export function AccountPinSection() {
  const t = useTranslation();
  const { behavior, setBehavior, account } = useApp();
  const user = account.user;
  const [version, setVersion] = useState(0);
  const [note, setNote] = useState("");
  const protectedNow = Boolean(user) && hasPin(user!.id) && version >= 0;

  const choose = async () => {
    if (!user) return;
    setNote("");
    if (hasPin(user.id)) {
      const current = await askPin({ title: t("Current PIN"), message: t("Enter the current PIN to change it.") });
      if (current === null) return;
      if (!await verifyPin(user.id, current)) { setNote(t("That is not the current PIN.")); return; }
    }
    const first = await askPin({ title: t("New PIN"), message: t("Choose 4 to 8 digits.") });
    if (first === null || !PIN_PATTERN.test(first)) return;
    const again = await askPin({ title: t("Repeat the PIN"), message: t("Type it once more to confirm.") });
    if (again !== first) { if (again !== null) setNote(t("The two PINs did not match.")); return; }
    await setPin(user.id, first);
    setVersion((value) => value + 1);
    setNote(t("PIN saved on this device."));
  };
  const remove = async () => {
    if (!user) return;
    const current = await askPin({ title: t("Remove PIN"), message: t("Enter the current PIN to remove it.") });
    if (current === null) return;
    if (!await verifyPin(user.id, current)) { setNote("That is not the current PIN."); return; }
    removePin(user.id);
    setVersion((value) => value + 1);
    setNote(t("PIN removed."));
  };

  return <SettingsGroup title="Account PINs" subtitle="Keep other people on this computer out of your account" id="settings-accountpin">
    <ToggleRow title="Ask for a PIN when switching accounts" description="Only accounts that have a PIN ask for it. PINs stay on this device and are stored as a salted hash. This stops casual switching; it does not replace your sign-in security." checked={behavior.accountPins} onChange={(accountPins) => setBehavior((current) => ({ ...current, accountPins }))} />
    {behavior.accountPins && (user
      ? <div className="setting-row"><span><strong>PIN for {user.email?.split("@")[0] || "this account"}</strong><small>{protectedNow ? "A PIN is set." : "No PIN is set, so anyone can switch to this account."}</small></span>
        <span className="settings-number-wrap"><button type="button" className="secondary-button" onClick={() => void choose()}>{protectedNow ? "Change PIN" : "Set PIN"}</button>
          {protectedNow && <button type="button" className="secondary-button danger-outline" onClick={() => void remove()}>Remove</button>}</span></div>
      : <p className="metadata-note settings-note">Sign in to set a PIN for your account.</p>)}
    {note && <p className="metadata-note settings-note" role="status">{note}</p>}
  </SettingsGroup>;
}
