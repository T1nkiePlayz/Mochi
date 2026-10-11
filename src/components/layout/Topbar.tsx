import { memo, useEffect, useRef, useState } from "react";
import { Bell, Menu, Search, X } from "lucide-react";
import { MochiIcon } from "../MochiIcon";
import { shallowEqual, useAppSelector } from "../../state/AppContext";
import { BigPictureButton } from "../../bigpicture/EntryButton";
import { navLabel } from "../../lib/nav";
import { confirmAction } from "../../lib/confirm";
import { useDismiss } from "../ui/useDismiss";
import { useTranslation } from "../../lib/useTranslation";

export const Topbar = memo(function Topbar() {
  const { activeNav, pikoName, search, setSearch, showBell, platform, notifications, showNotifications, setNotifications, setShowNotifications, language } = useAppSelector((app) => ({
    activeNav: app.activeNav, pikoName: app.lib.selectedPiko.name, search: app.lib.search, setSearch: app.lib.setSearch,
    showBell: app.behavior.notificationsEnabled && app.behavior.inAppNotifications, platform: app.platformCapabilities?.platform,
    notifications: app.notifications.notifications, showNotifications: app.notifications.showNotifications,
    setNotifications: app.notifications.setNotifications, setShowNotifications: app.notifications.setShowNotifications, language: app.behavior.language,
  }), shallowEqual);
  const t = useTranslation();
  // Narrow windows (and large text sizes) hide the sidebar; the menu button shows it as a drawer.
  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => { setNavOpen(false); }, [activeNav]);
  useEffect(() => { document.documentElement.dataset.navOpen = navOpen ? "true" : "false"; }, [navOpen]);
  const menuButton = useRef<HTMLButtonElement>(null);
  const bellWrap = useRef<HTMLDivElement>(null);
  // The drawer is the sidebar itself (rendered elsewhere), so it counts as inside.
  useDismiss(menuButton, navOpen, () => setNavOpen(false), { inside: ".sidebar", returnFocus: menuButton });
  useDismiss(bellWrap, showNotifications, () => setShowNotifications(false));
  useEffect(() => () => { document.documentElement.dataset.navOpen = "false"; }, []);
  return <header className="topbar">
    <button type="button" ref={menuButton} className="mobile-menu icon-button" aria-label={t("Open menu")} aria-expanded={navOpen} onClick={() => setNavOpen((value) => !value)}><MochiIcon name="menu" fallback={Menu} size={18} /></button>
    <div className="breadcrumb"><span>Mochi</span><span className="breadcrumb-slash">/</span><strong>{activeNav === "Library" ? pikoName : navLabel(activeNav, language)}</strong></div>
    <div className="topbar-actions">
      <label className="search-box">
        <MochiIcon name="search" fallback={Search} size={16} />
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("Search your library")} aria-label={t("Search your library")} />
        {search && <button className="clear-search" aria-label={t("Clear search")} onClick={() => setSearch("")}><MochiIcon name="close" fallback={X} size={13} /></button>}
        {!search && <kbd>{platform === "macos" ? "⌘ K" : "Ctrl K"}</kbd>}
      </label>
      <BigPictureButton />
      {showBell && <div className="notification-wrap" ref={bellWrap}>
        <button type="button" className="icon-button" aria-label={t("Notifications")} aria-haspopup="dialog" aria-expanded={showNotifications} onClick={() => setShowNotifications(!showNotifications)}>
          <MochiIcon name="notifications" fallback={Bell} size={17} />{notifications.length > 0 && <span className="notification-dot" />}
        </button>
        {showNotifications && <div className="notification-popover" role="dialog" aria-label="Notifications">
          <div className="notification-heading"><strong>{t("Notifications")}</strong>{notifications.length > 0 && <button type="button" onClick={() => void confirmAction({ title: t("Clear all notifications?"), message: t(notifications.length === 1 ? "Removes {count} notification from the list." : "Removes {count} notifications from the list.").replace("{count}", String(notifications.length)), confirmLabel: t("Clear") }).then((ok) => ok && setNotifications([]))}>Clear</button>}</div>
          {notifications.length ? notifications.map((item) => <div className="notification-item" key={item.id}><strong>{item.title}</strong><span>{item.message}</span>{item.progress && <progress max={item.progress.total} value={item.progress.value} />}</div>) : <div className="notification-empty">{t("You’re all caught up.")}</div>}
        </div>}
      </div>}
    </div>
  </header>;
});
