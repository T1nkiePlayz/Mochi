import { useApp } from "../../state/AppContext";
import { SettingsGroup, ToggleRow } from "./Section";

export function GeneralSection() {
  const { behavior, setBehavior, account, notifications, storage } = useApp();
  const set = (patch: Partial<typeof behavior>) => setBehavior((current) => ({ ...current, ...patch }));
  return <SettingsGroup title="General" subtitle="Launcher behavior" id="settings-general">
    <ToggleRow title="Launch Mochi on startup" description="Open the launcher when you sign in to your computer." checked={behavior.launchOnStartup} onChange={(launchOnStartup) => set({ launchOnStartup })} />
    <ToggleRow title="Notifications" description="Enable or disable all Mochi notifications." checked={behavior.notificationsEnabled} onChange={(notificationsEnabled) => { set({ notificationsEnabled }); if (!notificationsEnabled) notifications.setShowNotifications(false); }} />
    <ToggleRow title="In-app notifications" description="Show the notification button and updates inside Mochi." checked={behavior.inAppNotifications} disabled={!behavior.notificationsEnabled} onChange={(inAppNotifications) => { set({ inAppNotifications }); if (!inAppNotifications) notifications.setShowNotifications(false); }} />
    <ToggleRow title="System notifications" description="Allow Mochi to send desktop notifications." checked={behavior.systemNotifications} disabled={!behavior.notificationsEnabled} onChange={(systemNotifications) => set({ systemNotifications })} />
    <ToggleRow title="Separate account profiles" description={account.user ? "Keep libraries, preferences, and notifications separate for each signed-in account." : "Sign in before enabling separate profiles for multiple accounts."} checked={storage.multipleAccountsEnabled} disabled={!account.user} onChange={storage.setMultipleAccountProfiles} />
    <div className="setting-row"><span><strong>System tray service</strong><small>Closing the Mochi window keeps the launcher running in the tray. Use Quit Mochi from the tray menu to fully exit.</small></span><span className="metadata-note">Always active</span></div>
  </SettingsGroup>;
}
