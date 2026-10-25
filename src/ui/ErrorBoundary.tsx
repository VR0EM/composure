import { Component, ErrorInfo, ReactNode } from 'react';

interface State {
  error: Error | null;
}

/**
 * Last line of defense: if rendering throws (for example on a corrupt saved
 * draft), show a way out instead of a blank page.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Composure crashed:', error, info.componentStack);
  }

  private reset = () => {
    try {
      window.localStorage.removeItem('composure-draft');
    } catch {
      // ignore
    }
    window.location.hash = '';
    window.location.reload();
  };

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="h-screen flex items-center justify-center p-6 bg-[var(--bg-app)] text-[var(--text-primary)]">
        <div className="max-w-md space-y-3">
          <h1 className="text-[15px] font-semibold">Something went wrong</h1>
          <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed">
            Composure hit an unexpected error while showing this file. Reloading with a fresh editor usually fixes it.
            Your file never left this browser.
          </p>
          <pre className="p-3 rounded-md bg-[var(--bg-panel)] border border-[var(--border-subtle)] font-mono text-xs text-[var(--text-secondary)] whitespace-pre-wrap">
            {this.state.error.message}
          </pre>
          <button
            type="button"
            onClick={this.reset}
            className="h-8 px-3 rounded-md text-[13px] font-medium bg-[var(--accent)] text-[var(--accent-fg)] hover:opacity-90"
          >
            Reload with an empty draft
          </button>
        </div>
      </div>
    );
  }
}
