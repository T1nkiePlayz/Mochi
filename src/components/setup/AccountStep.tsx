import { Check, KeyRound, LogIn, RefreshCw, Trophy, UserRound } from "lucide-react";

const benefits = [
  { icon: KeyRound, title: "Store provider keys securely", detail: "Keys are encrypted in your account, not saved on disk." },
  { icon: RefreshCw, title: "Sync your library across devices", detail: "Pick up where you left off on any machine." },
  { icon: Trophy, title: "Keep achievements and stats", detail: "Your progress follows you." },
];

export function AccountStep({ signedIn, onSignIn }: { signedIn: boolean; onSignIn: () => void }) {
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
        <p className="setup-account-note">Optional. Mochi works fully offline without an account.</p>
      </div>
    </section>
  );
}
