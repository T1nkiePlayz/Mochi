import { memo, useEffect, useRef, useState } from "react";
import { Bell, Menu, Search, X } from "lucide-react";
import { MochiIcon } from "../MochiIcon";
import { shallowEqual, useAppSelector } from "../../state/AppContext";
import { BigPictureButton } from "../../bigpicture/EntryButton";
import { navLabel } from "../../lib/nav";
import { confirmAction } from "../../lib/confirm";
import { useDismiss } from "../ui/useDismiss";
import { useExperimental } from "../../state/useExperimental";
import { markNewsRead, useGameNews } from "../../state/gameNewsStore";
import { unreadCount } from "../../lib/gameNews";
import { openExternalUrl } from "../../lib/platform";
import { DealsPanel } from "../DealsPanel";

export const Topbar = memo(function Topbar() {
  const { activeNav, dealsEnabled, pikoName, search, setSearch, showBell, platform, notifications, showNotifications, setNotifications, setShowNotifications } = useAppSelector((app) => ({
    activeNav: app.activeNav, dealsEnabled: app.deals.enabled, pikoName: app.lib.selectedPiko.name, search: app.lib.search, setSearch: app.lib.setSearch,
    showBell: app.behavior.notificationsEnabled && app.behavior.inAppNotifications, platform: app.platformCapabilities?.platform,
    notifications: app.notifications.notifications, showNotifications: app.notifications.showNotifications,
    setNotifications: app.notifications.setNotifications, setShowNotifications: app.notifications.setShowNotifications,
  }), shallowEqual);
  // Narrow windows (and large text sizes) hide the sidebar; the menu button shows it as a drawer.
  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => { setNavOpen(false); }, [activeNav]);
  useEffect(() => { document.documentElement.dataset.navOpen = navOpen ? "true" : "false"; }, [navOpen]);
  const menuButton = useRef<HTMLButtonElement>(null);
  const bellWrap = useRef<HTMLDivElement>(null);
  const newsOn = useExperimental("game-news");
  const { news, mods } = useGameNews();
  const [tab, setTab] = useState<"all" | "news">("all");
  const unreadNews = newsOn ? unreadCount(news, mods.length) : 0;
  const showNews = newsOn && tab === "news";
  useEffect(() => { if (showNews && showNotifications) markNewsRead(); }, [showNews, showNotifications]);
  // The drawer is the sidebar itself (rendered elsewhere), so it counts as inside.
  useDismiss(menuButton, navOpen, () => setNavOpen(false), { inside: ".sidebar", returnFocus: menuButton });
  useDismiss(bellWrap, showNotifications, () => setShowNotifications(false));
  useEffect(() => () => { document.documentElement.dataset.navOpen = "false"; }, []);
  return <header className="topbar">
    <button type="button" ref={menuButton} className="mobile-menu icon-button" aria-label="Open menu" aria-expanded={navOpen} onClick={() => setNavOpen((value) => !value)}><MochiIcon name="menu" fallback={Menu} size={18} /></button>
    <div className="breadcrumb"><span>Mochi</span><span className="breadcrumb-slash">/</span><strong>{activeNav === "Library" ? pikoName : navLabel(activeNav)}</strong></div>
    <div className="topbar-actions">
      <label className="search-box">
        <MochiIcon name="search" fallback={Search} size={16} />
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search your library" aria-label="Search your library" />
        {search && <button className="clear-search" aria-label="Clear search" onClick={() => setSearch("")}><MochiIcon name="close" fallback={X} size={13} /></button>}
        {!search && <kbd>{platform === "macos" ? "⌘ K" : "Ctrl K"}</kbd>}
      </label>
      <BigPictureButton />
      {showBell && <div className="notification-wrap" ref={bellWrap}>
        <button type="button" className="icon-button" aria-label="Notifications" aria-haspopup="dialog" aria-expanded={showNotifications} onClick={() => setShowNotifications(!showNotifications)}>
          <MochiIcon name="notifications" fallback={Bell} size={17} />{(notifications.length > 0 || unreadNews > 0) && <span className="notification-dot" />}
        </button>
        {showNotifications && <div className="notification-popover" role="dialog" aria-label="Notifications">
          <div className="notification-heading"><strong>Notifications</strong>{!showNews && notifications.length > 0 && <button type="button" onClick={() => void confirmAction({ title: "Clear all notifications?", message: `Removes ${notifications.length} notification${notifications.length === 1 ? "" : "s"} from the list.`, confirmLabel: "Clear" }).then((ok) => ok && setNotifications([]))}>Clear</button>}</div>
          {newsOn && <div className="workspace-tabs notification-tabs" role="tablist" aria-label="Notification views">
            <button type="button" role="tab" aria-selected={!showNews} className={showNews ? "" : "active"} onClick={() => setTab("all")}>All</button>
            <button type="button" role="tab" aria-selected={showNews} className={showNews ? "active" : ""} onClick={() => setTab("news")}>News{unreadNews > 0 ? ` (${unreadNews})` : ""}</button>
          </div>}
          {showNews ? <div className="notification-news" role="tabpanel" aria-label="News">
            {mods.slice(0, 20).map((mod) => <div className="notification-item" key={mod.key}><strong>Mod update: {mod.title}</strong><span>{mod.tofu} {mod.version}</span></div>)}
            {news.items.slice(0, 40).map((item) => <button type="button" className="notification-item notification-news-item" key={item.gid} onClick={() => void openExternalUrl(item.url).catch(() => {})}><strong>{item.game}: {item.title}</strong><span>{item.summary || item.feedLabel}</span><small>{new Date(item.date * 1000).toLocaleDateString()}{item.feedLabel ? ` · ${item.feedLabel}` : ""}</small></button>)}
            {!mods.length && !news.items.length && <div className="notification-empty">No news yet. Steam games are checked every few hours while Mochi is open.</div>}
          </div> : notifications.length ? notifications.map((item) => <div className="notification-item" key={item.id}><strong>{item.title}</strong><span>{item.message}</span>{item.progress && <progress max={item.progress.total} value={item.progress.value} />}</div>) : <div className="notification-empty">You’re all caught up.</div>}
          {dealsEnabled && !showNews && <DealsPanel />}
        </div>}
      </div>}
    </div>
  </header>;
});
