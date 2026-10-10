import { useApp } from "../../state/AppContext";
import { SettingsGroup, ToggleRow } from "./Section";

/** The optional Deals tab and game news. Both are off by default. */
export function DealsSection() {
  const { behavior, setBehavior } = useApp();
  return <SettingsGroup title="Deals & news" subtitle="Optional. Nothing is checked while these are off" id="settings-deals">
    <ToggleRow title="Show the Deals tab" description="Adds a Deals tab with free games, sales and price watches for your wishlist, checked at most every few hours (metadata only). Notifications are only sent for games on your wishlist." checked={behavior.showDeals} onChange={(showDeals) => setBehavior((current) => ({ ...current, showDeals }))} />
    <ToggleRow title="Game news" description="Checks Steam news for your Steam games and updates for your installed mods, and lists them in the Deals tab." checked={behavior.gameNews} onChange={(gameNews) => setBehavior((current) => ({ ...current, gameNews }))} />
  </SettingsGroup>;
}
