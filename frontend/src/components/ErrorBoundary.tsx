import { Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Vault UI crashed:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-gray-50">
          <div className="w-full max-w-md rounded-lg border bg-white p-8 text-center shadow">
            <h1 className="mb-4 text-xl font-bold text-red-600">Something went wrong</h1>
            <p className="mb-4 text-gray-600">The vault UI encountered an error. Your data is safe — it&apos;s encrypted on disk.</p>
            <pre className="mb-4 max-h-32 overflow-auto rounded bg-gray-100 p-3 text-left text-xs">{this.state.error?.message}</pre>
            <button onClick={() => window.location.reload()} className="rounded bg-blue-600 px-4 py-2 text-white">
              Reload App
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
