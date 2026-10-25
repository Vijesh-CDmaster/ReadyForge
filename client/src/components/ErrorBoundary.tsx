import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';
import { Button, Card } from './ui';

interface Props {
  children: ReactNode;
  /** Shown in the fallback heading; lets users know which area failed. */
  area?: string;
}

interface State {
  error: Error | null;
}

/**
 * Catches render-time exceptions anywhere below it so a single broken page
 * shows a recovery screen instead of blanking the whole app (Priority 1).
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Keep the detail in the console for debugging; never render raw stacks.
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  private reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <Card className="p-6 text-center">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-red-50 dark:bg-red-950/40">
            <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" aria-hidden />
          </div>
          <h1 className="text-lg font-semibold tracking-tight">
            Something broke in {this.props.area || 'this page'}
          </h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            The rest of ReadyForge is still running. Reload this view, or go back to the dashboard
            and try again. If it keeps happening, the details are in the browser console.
          </p>
          <div className="mt-5 flex items-center justify-center gap-2">
            <Button variant="primary" onClick={this.reset}>
              <RefreshCw className="h-4 w-4" aria-hidden />
              Try again
            </Button>
            <Button onClick={() => { window.location.href = '/app'; }}>
              <Home className="h-4 w-4" aria-hidden />
              Dashboard
            </Button>
          </div>
          {error.message ? (
            <p className="mt-4 rounded-md bg-slate-50 p-2 text-left font-mono text-[11px] text-slate-500 dark:bg-slate-900 dark:text-slate-400">
              {error.message}
            </p>
          ) : null}
        </Card>
      </div>
    );
  }
}