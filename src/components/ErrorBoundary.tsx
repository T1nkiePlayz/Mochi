import { Component, type ErrorInfo, type ReactNode } from "react";

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
    return <div className="empty-state" role="alert"><h2>Something went wrong.</h2><p>{this.state.error.message}</p><button className="secondary-button" onClick={() => this.setState({ error: null })}>Try again</button></div>;
  }
}
