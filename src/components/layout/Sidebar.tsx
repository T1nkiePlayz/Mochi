import { BarChart3, ChevronDown, Download, Grid2X2, Library, Plus, Settings, Sparkles } from "lucide-react";
import { AccountAvatar } from "../AccountAvatar";
import { MochiIcon } from "../MochiIcon";
import { useApp, type NavId } from "../../state/AppContext";
import { usernameOf } from "../../state/useAccount";
import { useExperimentalStatus } from "../../state/useExperimental";

export const navItems: Array<{ id: NavId; icon: typeof Library; iconName: string }> = [
  { id: "Library", icon: Library, iconName: "library" },
  { id: "Installed", icon: Grid2X2, iconName: "installed" },
  { id: "Discover", icon: Sparkles, iconName: "discover" },
  { id: "Downloads", icon: Download, iconName: "downloads" },
  { id: "Stats", icon: BarChart3, iconName: "stats" },
];

export function Sidebar() {
  const { account, activeNav, setActiveNav, storage } = useApp();
  const { user } = account;
  const { unseenCount } = useExperimentalStatus();
  return <aside className="sidebar">
    <div className="brand"><div className="brand-mark"><img src="/mochi.png" alt="Mochi" /></div><div><strong>Mochi</strong><span>Your games, your way.</span></div></div>
    <div className="sidebar-account-wrap">
      <button className="sidebar-account" aria-expanded={account.showAccountMenu} onClick={() => account.setShowAccountMenu(!account.showAccountMenu)}><AccountAvatar user={user} size={34} /><span><strong>{usernameOf(user)}</strong><small>{user ? "Mochi account" : "Sign in to Mochi"}</small></span><MochiIcon name="chevron" fallback={ChevronDown} size={14} /></button>
      {account.showAccountMenu && <div className="account-menu">
        {storage.multipleAccountsEnabled && account.savedAccounts.map((saved) => <button type="button" key={saved.id} className={saved.id === user?.id ? "selected" : ""} onClick={() => void account.switchAccount(saved)}><span className="account-menu-avatar">{saved.avatarUrl ? <img className="account-menu-avatar-image" src={saved.avatarUrl} alt="" referrerPolicy="no-referrer" /> : saved.username.slice(0, 1).toUpperCase()}</span><span><strong>{saved.username}</strong><small>Mochi account</small></span></button>)}
        {!user && <button type="button" className="account-menu-add" onClick={() => { account.setShowAccountMenu(false); account.openSignIn(); }}><Plus size={14} /><span><strong>Sign in</strong><small>Add a Mochi account</small></span></button>}
        {user && storage.multipleAccountsEnabled && account.savedAccounts.length < 5 && <button type="button" className="account-menu-add" onClick={() => { account.setShowAccountMenu(false); account.openSignIn(); }}><Plus size={14} /><span><strong>Add User</strong><small>Sign in to another Mochi account</small></span></button>}
        {user && <button type="button" className="account-menu-add" onClick={() => void account.signOut()}><span className="account-menu-avatar">↪</span><span><strong>Sign out</strong><small>Keep local Mochi data</small></span></button>}
      </div>}
    </div>
    <nav className="primary-nav" aria-label="Main navigation">
      {navItems.map(({ id, icon: Icon, iconName }) => (
        <button className={`nav-item ${activeNav === id ? "active" : ""}`} key={id} aria-current={activeNav === id ? "page" : undefined} onClick={() => setActiveNav(id)}>
          <MochiIcon name={iconName} fallback={Icon} size={17} strokeWidth={1.8} />
          <span>{id}</span>
        </button>
      ))}
    </nav>
    <div className="sidebar-bottom">
      <button className={`nav-item ${activeNav === "Settings" ? "active" : ""}`} aria-current={activeNav === "Settings" ? "page" : undefined} onClick={() => setActiveNav("Settings")}>
        <MochiIcon name="settings" fallback={Settings} size={17} strokeWidth={1.8} />
        <span>Settings</span>
        {unseenCount > 0 && <span className="nav-new-dot" role="img" aria-label="New experimental features" />}
      </button>
    </div>
  </aside>;
}
