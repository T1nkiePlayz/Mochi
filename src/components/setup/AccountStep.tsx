import { Check, KeyRound, LogIn, UserRound } from "lucide-react";

export function AccountStep({ signedIn, onSignIn }: { signedIn: boolean; onSignIn: () => void }) {
  return (
    <section className="setup-page">
      <div className="setup-icon"><UserRound size={22} /></div>
      <h1>Connect your Mochi account.</h1>
      <p className="setup-description">Signing in lets you store provider keys securely and sync your library. Your installed games and files stay on this device.</p>
      <div className="setup-choice">
        <div className="setup-choice-icon"><KeyRound size={18} /></div>
        <div><strong>{signedIn ? "Mochi account connected" : "Sign in to Mochi"}</strong><span>{signedIn ? "Your account is connected and ready." : "Optional. Mochi is fully usable offline without an account."}</span></div>
        {!signedIn && <button type="button" className="secondary-button" onClick={onSignIn}><LogIn size={15} /> Sign in</button>}
        {signedIn && <span className="setup-connected"><Check size={14} /> Connected</span>}
      </div>
    </section>
  );
}
