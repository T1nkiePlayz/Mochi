import { useRef, type KeyboardEvent } from "react";
import { RemoteImage } from "../RemoteImage";
import { BarChart3, ChevronDown, Download, Grid2X2, Library, Plus, Settings, Sparkles } from "lucide-react";
import { AccountAvatar } from "../AccountAvatar";
import { MochiIcon } from "../MochiIcon";
import { useApp, type NavId } from "../../state/AppContext";
import { usernameOf } from "../../state/useAccount";
import { useExperimentalStatus } from "../../state/useExperimental";
import { navLabel } from "../../lib/nav";
import { useShellFit } from "../../lib/useShellFit";
import { useDismiss } from "../ui/useDismiss";

export const navItems: Array<{ id: NavId; icon: typeof Library; iconName: string }> = [
  { id: "Library", icon: Library, iconName: "library" },
  { id: "Installed", icon: Grid2X2, iconName: "installed" },
  { id: "Discover", icon: Sparkles, iconName: "discover" },
  { id: "Downloads", icon: Download, iconName: "downloads" },
  { id: "Stats", icon: BarChart3, iconName: "stats" },
];

/** Arrow keys move between a menu's items (Tab still leaves it). */
function moveInMenu(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  event.preventDefault();
  const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("[role='menuitem']:not(:disabled)"));
  const index = items.indexOf(document.activeElement as HTMLElement);
  items[(index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
}

export function Sidebar() {
  const { account, activeNav, setActiveNav, storage } = useApp();
  const { user } = account;
  const { unseenCount } = useExperimentalStatus();
  const ref = useRef<HTMLElement>(null);
  useShellFit(ref);
  const accountWrap = useRef<HTMLDivElement>(null);
  useDismiss(accountWrap, account.showAccountMenu, () => account.setShowAccountMenu(false));
  return <aside className="sidebar" ref={ref}>
    <div className="brand"><div className="brand-mark"><img src="/mochi.png" alt="Mochi" /></div><div><strong>Mochi</strong><span>Your games, your way.</span></div></div>
    <div className="sidebar-account-wrap" ref={accountWrap}>
      <button className="sidebar-account" title={usernameOf(user)} aria-label={`Account: ${usernameOf(user)}`} aria-haspopup="menu" aria-expanded={account.showAccountMenu} onClick={() => account.setShowAccountMenu(!account.showAccountMenu)}><AccountAvatar user={user} size={34} /><span><strong>{usernameOf(user)}</strong><small>{user ? "Mochi account" : "Sign in to Mochi"}</small></span><MochiIcon name="chevron" fallback={ChevronDown} size={14} /></button>
      {account.showAccountMenu && <div className="account-menu" role="menu" aria-label="Account" onKeyDown={moveInMenu}>
        {storage.multipleAccountsEnabled && account.savedAccounts.map((saved) => <button type="button" key={saved.id} className={saved.id === user?.id ? "selected" : ""} role="menuitem" onClick={() => { account.setShowAccountMenu(false); void account.switchAccount(saved); }}><span className="account-menu-avatar">{saved.avatarUrl ? <RemoteImage className="account-menu-avatar-image" src={saved.avatarUrl} alt="" referrerPolicy="no-referrer" fallback={saved.username.slice(0, 1).toUpperCase()} /> : saved.username.slice(0, 1).toUpperCase()}</span><span><strong>{saved.username}</strong><small>Mochi account</small></span></button>)}
        {!user && <button type="button" role="menuitem" className="account-menu-add" onClick={() => { account.setShowAccountMenu(false); account.openSignIn(); }}><Plus size={14} /><span><strong>Sign in</strong><small>Add a Mochi account</small></span></button>}
        {user && storage.multipleAccountsEnabled && account.savedAccounts.length < 5 && <button type="button" role="menuitem" className="account-menu-add" onClick={() => { account.setShowAccountMenu(false); account.openSignIn(); }}><Plus size={14} /><span><strong>Add User</strong><small>Sign in to another Mochi account</small></span></button>}
        {user && <button type="button" role="menuitem" className="account-menu-add" onClick={() => { account.setShowAccountMenu(false); void account.signOut(); }}><span className="account-menu-avatar">↪</span><span><strong>Sign out</strong><small>Keep local Mochi data</small></span></button>}
      </div>}
    </div>
    <nav className="primary-nav" aria-label="Main navigation">
      {navItems.map(({ id, icon: Icon, iconName }) => (
        <button className={`nav-item ${activeNav === id ? "active" : ""}`} key={id} title={navLabel(id)} aria-label={navLabel(id)} aria-current={activeNav === id ? "page" : undefined} onClick={() => setActiveNav(id)}>
          <MochiIcon name={iconName} fallback={Icon} size={17} strokeWidth={1.8} />
          <span>{navLabel(id)}</span>
        </button>
      ))}
    </nav>
    <div className="sidebar-bottom">
      <button className={`nav-item ${activeNav === "Settings" ? "active" : ""}`} title="Settings" aria-label="Settings" aria-current={activeNav === "Settings" ? "page" : undefined} onClick={() => setActiveNav("Settings")}>
        <MochiIcon name="settings" fallback={Settings} size={17} strokeWidth={1.8} />
        <span>Settings</span>
        {unseenCount > 0 && <span className="nav-new-dot" role="img" aria-label="New experimental features" />}
      </button>
    </div>
  </aside>;
}
