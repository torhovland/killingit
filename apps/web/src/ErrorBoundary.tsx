import { Component, type ErrorInfo, type ReactNode } from "react";
import { ErrorPage } from "./ErrorPage";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Catches render errors anywhere below it and shows {@link ErrorPage} instead of
 * letting React unmount the tree and leave a blank page. Reporting to Sentry is
 * handled by the root `onCaughtError` hook in `main.tsx`; this logs locally so
 * development still gets the component stack.
 */
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Uncaught render error", error, info.componentStack);
  }

  private reset = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    if (this.state.error) {
      return <ErrorPage error={this.state.error} onRetry={this.reset} />;
    }
    return this.props.children;
  }
}
