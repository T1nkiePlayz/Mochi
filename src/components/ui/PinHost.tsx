import { useEffect, useState, type FormEvent } from "react";
import { answerPin, subscribePin, type PendingPin } from "../../lib/pinPrompt";

function PinDialog({ pending }: { pending: PendingPin }) {
  const [pin, setPin] = useState("");
  const submit = (event: FormEvent) => { event.preventDefault(); if (/^\d{4,8}$/.test(pin)) answerPin(pending.id, pin); };
  return <div className="modal-backdrop" onClick={() => answerPin(pending.id, null)}>
    <form className="modal confirm-dialog" role="dialog" aria-modal="true" aria-label={pending.title} onClick={(event) => event.stopPropagation()} onSubmit={submit}
      onKeyDown={(event) => { if (event.key === "Escape") answerPin(pending.id, null); }}>
      <h2>{pending.title}</h2>
      <p>{pending.message}</p>
      <input type="password" inputMode="numeric" autoComplete="off" autoFocus maxLength={8} value={pin} aria-label="PIN" onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))} />
      {pending.error && <p className="auth-error" role="alert">{pending.error}</p>}
      <div className="confirm-actions"><button type="button" className="secondary-button" onClick={() => answerPin(pending.id, null)}>Cancel</button><button type="submit" className="play-button" disabled={!/^\d{4,8}$/.test(pin)}>Continue</button></div>
    </form>
  </div>;
}

/** Renders the open `askPin()` request. Mounted once in AppProvider. */
export function PinHost() {
  const [queue, setQueue] = useState<PendingPin[]>([]);
  useEffect(() => subscribePin(setQueue), []);
  return queue[0] ? <PinDialog key={queue[0].id} pending={queue[0]} /> : null;
}
