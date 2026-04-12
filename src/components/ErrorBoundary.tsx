import { Component, type ReactNode } from 'react';

interface Props { children: ReactNode }
interface State { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center p-8 bg-background">
          <div className="max-w-2xl w-full rounded-lg border border-destructive/50 bg-destructive/10 p-6">
            <h1 className="text-xl font-bold text-destructive mb-2">Something went wrong</h1>
            <p className="text-sm text-muted-foreground mb-4">
              The page crashed before it could render. Details below — please share these when reporting the issue.
            </p>
            <pre className="text-xs bg-muted p-4 rounded overflow-auto whitespace-pre-wrap break-words">
              {this.state.error.message}
              {'\n\n'}
              {this.state.error.stack}
            </pre>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
