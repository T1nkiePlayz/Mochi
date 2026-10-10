import { memo, useEffect, useRef, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { RemoteImage } from "../RemoteImage";
import { BarChart3, ChevronDown, Download, Grid2X2, Library, Plus, Settings, Sparkles, Tag } from "lucide-react";
import { AccountAvatar } from "../AccountAvatar";
import { MochiIcon } from "../MochiIcon";
import { shallowEqual, useAppGetter, useAppSelector, type NavId } from "../../state/AppContext";
import { usernameOf } from "../../state/useAccount";
import { useExperimentalStatus } from "../../state/useExperimental";
import { navLabel } from "../../lib/nav";
import { useTranslation } from "../../lib/i18n";
import { useShellFit } from "../../lib/useShellFit";
import { useDismiss } from "../ui/useDismiss";
import { useAnchoredMenu } from "./useAnchoredMenu";

export const navItems: Array<{ id: NavId; icon: typeof Library; iconName: string }> = [
  { id: "Library", icon: Library, iconName: "library" },
  { id: "Installed", icon: Grid2X2, iconName: "installed" },
  { id: "Discover", icon: Sparkles, iconName: "discover" },
  { id: "Downloads", icon: Download, iconName: "downloads" },
  { id: "Stats", icon: BarChart3, iconName: "stats" },
  { id: "Deals", icon: Tag, iconName: "deals" },
];

/** Arrow keys move between a menu's items (Tab still leaves it). */
function moveInMenu(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  event.preventDefault();
  const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("[role='menuitem']:not(:disabled)"));
  const index = items.indexOf(document.activeElement as HTMLElement);
  items[(index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
}

export const Sidebar = memo(function Sidebar() {
  const { user, showAccountMenu, setShowAccountMenu, savedAccounts, openSignIn, activeNav, setActiveNav, multipleAccountsEnabled, showDeals, language } = useAppSelector((app) => ({
    user: app.account.user, showAccountMenu: app.account.showAccountMenu, setShowAccountMenu: app.account.setShowAccountMenu, savedAccounts: app.account.savedAccounts,
    openSignIn: app.account.openSignIn, activeNav: app.activeNav, setActiveNav: app.setActiveNav, multipleAccountsEnabled: app.storage.multipleAccountsEnabled, showDeals: app.behavior.showDeals, language: app.behavior.language,
  }), shallowEqual);
  // switchAccount/signOut change identity every render, so handlers read the latest at click time.
  const getApp = useAppGetter();
  const t = useTranslation();
  const { unseenCount } = useExperimentalStatus();
  const ref = useRef<HTMLElement>(null);
  useShellFit(ref);
  const accountWrap = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // The menu lives in a portal (themes give the sidebar their own stacking context), so it counts as "inside" via its own selector.
  useDismiss(accountWrap, showAccountMenu, () => setShowAccountMenu(false), { inside: ".account-menu", returnFocus: triggerRef });
  const menuStyle = useAnchoredMenu(triggerRef, showAccountMenu);
  const placed = Boolean(menuStyle);
  useEffect(() => { if (showAccountMenu && placed) { const menu = menuRef.current; if (menu && !menu.contains(document.activeElement)) menu.querySelector<HTMLElement>("[role='menuitem']")?.focus({ preventScroll: true }); } }, [showAccountMenu, placed]);
  return <aside className="sidebar" ref={ref}>
    <div className="brand"><div className="brand-mark"><img src="/mochi-mark.png" alt="Mochi" /></div><div><strong>Mochi</strong><span>Your games, your way.</span></div></div>
    <div className="sidebar-account-wrap" ref={accountWrap}>
      <button className="sidebar-account" ref={triggerRef} title={usernameOf(user)} aria-label={`Account: ${usernameOf(user)}`} aria-haspopup="menu" aria-expanded={showAccountMenu} onClick={() => setShowAccountMenu(!showAccountMenu)}><AccountAvatar user={user} size={34} /><span><strong>{usernameOf(user)}</strong><small>{user ? t("Mochi account") : t("Sign in to Mochi")}</small></span><MochiIcon name="chevron" fallback={ChevronDown} size={14} /></button>
      {showAccountMenu && menuStyle && createPortal(<div className="account-menu" ref={menuRef} style={menuStyle} role="menu" aria-label={t("Account")} onKeyDown={moveInMenu}>
        {multipleAccountsEnabled && savedAccounts.map((saved) => <button type="button" key={saved.id} className={saved.id === user?.id ? "selected" : ""} role="menuitem" onClick={() => { setShowAccountMenu(false); void getApp().account.switchAccount(saved); }}><span className="account-menu-avatar">{saved.avatarUrl ? <RemoteImage className="account-menu-avatar-image" src={saved.avatarUrl} alt="" referrerPolicy="no-referrer" fallback={saved.username.slice(0, 1).toUpperCase()} /> : saved.username.slice(0, 1).toUpperCase()}</span><span><strong>{saved.username}</strong><small>{t("Mochi account")}</small></span></button>)}
        {!user && <button type="button" role="menuitem" className="account-menu-add" onClick={() => { setShowAccountMenu(false); openSignIn(); }}><Plus size={14} /><span><strong>{t("Sign in")}</strong><small>{t("Add a Mochi account")}</small></span></button>}
        {user && multipleAccountsEnabled && savedAccounts.length < 5 && <button type="button" role="menuitem" className="account-menu-add" onClick={() => { setShowAccountMenu(false); openSignIn(); }}><Plus size={14} /><span><strong>{t("Add User")}</strong><small>{t("Sign in to another Mochi account")}</small></span></button>}
        {user && <button type="button" role="menuitem" className="account-menu-add" onClick={() => { setShowAccountMenu(false); void getApp().account.signOut(); }}><span className="account-menu-avatar">↪</span><span><strong>{t("Sign out")}</strong><small>{t("Keep local Mochi data")}</small></span></button>}
      </div>, document.body)}
    </div>
    <nav className="primary-nav" aria-label="Main navigation">
      {navItems.filter(({ id }) => id !== "Deals" || showDeals).map(({ id, icon: Icon, iconName }) => (
        <button className={`nav-item ${activeNav === id ? "active" : ""}`} key={id} title={navLabel(id, language)} aria-label={navLabel(id, language)} aria-current={activeNav === id ? "page" : undefined} onClick={() => setActiveNav(id)}>
          <MochiIcon name={iconName} fallback={Icon} size={17} strokeWidth={1.8} />
          <span>{navLabel(id, language)}</span>
        </button>
      ))}
    </nav>
    <div className="sidebar-bottom">
      <button className={`nav-item ${activeNav === "Settings" ? "active" : ""}`} title={navLabel("Settings", language)} aria-label={navLabel("Settings", language)} aria-current={activeNav === "Settings" ? "page" : undefined} onClick={() => setActiveNav("Settings")}>
        <MochiIcon name="settings" fallback={Settings} size={17} strokeWidth={1.8} />
        <span>{navLabel("Settings", language)}</span>
        {unseenCount > 0 && <span className="nav-new-dot" role="img" aria-label="New experimental features" />}
      </button>
    </div>
  </aside>;
});
