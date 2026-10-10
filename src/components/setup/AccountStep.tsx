import { Check, KeyRound, LogIn, RefreshCw, Trophy, UserPlus, UserRound } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { AccountAvatar } from "../AccountAvatar";
import { usernameOf } from "../../state/useAccount";

const benefits = [
  { icon: KeyRound, title: "Store provider keys securely", detail: "Keys are encrypted in your account, not saved on disk." },
  { icon: RefreshCw, title: "Sync your library across devices", detail: "Pick up where you left off on any machine." },
  { icon: Trophy, title: "Keep achievements and stats", detail: "Your progress follows you." },
];

export function AccountStep({ user, onSignIn, onAddUser }: { user: User | null; onSignIn: () => void; /** Turns on separate account profiles and opens sign-in for another person. */ onAddUser?: () => void }) {
  const signedIn = Boolean(user);
  return (
    <section className="setup-page setup-account">
      <div className="setup-icon"><UserRound size={22} /></div>
      <h1>{signedIn ? "Your account is ready." : "Connect your Mochi account."}</h1>
      <p className="setup-description">{signedIn ? "Your account is connected. Provider keys can be saved securely, and cloud features are ready when you need them." : "Signing in lets you store provider keys securely and sync your library. Your installed games and files stay on this device."}</p>
      <div className={`setup-account-card${signedIn ? " is-connected" : ""}`}>
        {signedIn && user ? <div className="setup-account-profile">
          <AccountAvatar user={user} size={54} className="setup-account-avatar" />
          <div className="setup-account-identity"><strong>{usernameOf(user)}</strong><span>{user.email || "Mochi account"}</span></div>
          <span className="setup-account-connected" role="status"><Check size={14} /> Connected</span>
        </div> : <ul className="setup-account-benefits">
          {benefits.map(({ icon: Icon, title, detail }) => <li key={title}><span className="setup-account-benefit-icon"><Icon size={17} /></span><div><strong>{title}</strong><span className="setup-account-sub">{detail}</span></div></li>)}
        </ul>}
        {signedIn
          ? <div className="setup-account-connected-details"><Check size={17} /><span><strong>Secure account access is on</strong><small>Your games and files remain on this device. You can change accounts from the account menu.</small></span></div>
          : <button type="button" className="setup-account-signin play-button" onClick={onSignIn}><LogIn size={16} /> Sign in</button>}
        {signedIn && onAddUser && <div className="setup-account-add" role="group" aria-label="Add another user">
          <div><strong>Sharing this computer?</strong><span className="setup-account-sub">Give another person a separate Mochi library and settings.</span></div>
          <button type="button" className="secondary-button" onClick={onAddUser}><UserPlus size={16} /> Add another user</button>
        </div>}
        {!signedIn && <p className="setup-account-note">Optional. Mochi works fully offline without an account.</p>}
      </div>
    </section>
  );
}
