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
        <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
          <div className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-8 text-center shadow dark:border-gray-700 dark:bg-gray-800">
            <h1 className="mb-4 text-xl font-bold text-red-600 dark:text-red-400">Something went wrong</h1>
            <p className="mb-4 text-gray-600 dark:text-gray-400">The vault UI encountered an error. Your data is safe — it&apos;s encrypted on disk.</p>
            <pre className="mb-4 max-h-32 overflow-auto rounded bg-gray-100 p-3 text-left text-xs dark:bg-gray-700 dark:text-gray-200">
              {this.state.error?.message}
            </pre>
            <button
              onClick={() => window.location.reload()}
              className="rounded bg-blue-600 px-4 py-2 text-white transition-colors hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
            >
              Reload App
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
