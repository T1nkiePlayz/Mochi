import { Bell, Menu, Search, X } from "lucide-react";
import { MochiIcon } from "../MochiIcon";
import { useApp } from "../../state/AppContext";

export function Topbar() {
  const { activeNav, lib, behavior, platformCapabilities, notifications: n } = useApp();
  const { search, setSearch } = lib;
  const showBell = behavior.notificationsEnabled && behavior.inAppNotifications;
  return <header className="topbar">
    <button className="mobile-menu icon-button" aria-label="Open menu"><MochiIcon name="menu" fallback={Menu} size={18} /></button>
    <div className="breadcrumb"><span>Mochi</span><span className="breadcrumb-slash">/</span><strong>{activeNav === "Library" ? lib.selectedPiko.name : activeNav}</strong></div>
    <div className="topbar-actions">
      <label className="search-box">
        <MochiIcon name="search" fallback={Search} size={16} />
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search your library" aria-label="Search your library" />
        {search && <button className="clear-search" aria-label="Clear search" onClick={() => setSearch("")}><MochiIcon name="close" fallback={X} size={13} /></button>}
        {!search && <kbd>{platformCapabilities?.platform === "macos" ? "⌘ K" : "Ctrl K"}</kbd>}
      </label>
      {showBell && <div className="notification-wrap">
        <button className="icon-button" aria-label="Notifications" aria-expanded={n.showNotifications} onClick={() => n.setShowNotifications(!n.showNotifications)}>
          <MochiIcon name="notifications" fallback={Bell} size={17} />{n.notifications.length > 0 && <span className="notification-dot" />}
        </button>
        {n.showNotifications && <div className="notification-popover">
          <div className="notification-heading"><strong>Notifications</strong>{n.notifications.length > 0 && <button type="button" onClick={() => n.setNotifications([])}>Clear</button>}</div>
          {n.notifications.length ? n.notifications.map((item) => <div className="notification-item" key={item.id}><strong>{item.title}</strong><span>{item.message}</span>{item.progress && <progress max={item.progress.total} value={item.progress.value} />}</div>) : <div className="notification-empty">You’re all caught up.</div>}
        </div>}
      </div>}
    </div>
  </header>;
}
