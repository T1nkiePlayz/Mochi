import { Check, KeyRound, LogIn, RefreshCw, Trophy, UserPlus, UserRound } from "lucide-react";

const benefits = [
  { icon: KeyRound, title: "Store provider keys securely", detail: "Keys are encrypted in your account, not saved on disk." },
  { icon: RefreshCw, title: "Sync your library across devices", detail: "Pick up where you left off on any machine." },
  { icon: Trophy, title: "Keep achievements and stats", detail: "Your progress follows you." },
];

export function AccountStep({ signedIn, onSignIn, onAddUser }: { signedIn: boolean; onSignIn: () => void; /** Turns on separate account profiles and opens sign-in for another person. */ onAddUser?: () => void }) {
  return (
    <section className="setup-page setup-account">
      <div className="setup-icon"><UserRound size={22} /></div>
      <h1>Connect your Mochi account.</h1>
      <p className="setup-description">Signing in lets you store provider keys securely and sync your library. Your installed games and files stay on this device.</p>
      <div className="setup-account-card">
        <ul className="setup-account-benefits">
          {benefits.map(({ icon: Icon, title, detail }) => <li key={title}><span className="setup-account-benefit-icon"><Icon size={17} /></span><div><strong>{title}</strong><span className="setup-account-sub">{detail}</span></div></li>)}
        </ul>
        {signedIn
          ? <div className="setup-account-connected" role="status"><Check size={16} /> Mochi account connected</div>
          : <button type="button" className="setup-account-signin play-button" onClick={onSignIn}><LogIn size={16} /> Sign in</button>}
        {signedIn && onAddUser && <div className="setup-account-add" role="group" aria-label="Add another user">
          <strong>Does someone else use this computer?</strong>
          <span className="setup-account-sub">Add them now and each person gets their own library and settings. You can also do this later from the account menu.</span>
          <button type="button" className="secondary-button" onClick={onAddUser}><UserPlus size={16} /> Add another user</button>
        </div>}
        <p className="setup-account-note">Optional. Mochi works fully offline without an account.</p>
      </div>
    </section>
  );
}
