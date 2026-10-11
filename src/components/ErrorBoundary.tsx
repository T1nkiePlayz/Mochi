import { Component, type ErrorInfo, type ReactNode } from "react";
import { translate } from "../lib/i18n";
import { getTranslationLocale } from "../lib/translationLocale";

/** Keeps one broken view from blanking the whole launcher. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error("Mochi view crashed", error, info.componentStack); }
  componentDidUpdate(previous: { resetKey?: string }) {
    if (this.state.error && previous.resetKey !== this.props.resetKey) this.setState({ error: null });
  }
  render() {
    if (!this.state.error) return this.props.children;
    return <div className="empty-state" role="alert"><h2>{translate("Something went wrong.", getTranslationLocale())}</h2><p>{translate(this.state.error.message, getTranslationLocale())}</p><button className="secondary-button" onClick={() => this.setState({ error: null })}>{translate("Try again", getTranslationLocale())}</button></div>;
  }
}
