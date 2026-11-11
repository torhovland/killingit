import { Button } from "./components/Button";
interface ErrorPageProps {
  error: Error;
  onRetry: () => void;
}

/**
 * Full-page fallback shown when an uncaught render error takes down the app.
 * Kept presentational so it can render without any application state (and be
 * tested with static markup).
 */
export function ErrorPage({ error, onRetry }: ErrorPageProps) {
  return (
    <main
      className="min-h-screen flex flex-col items-center justify-center gap-4 p-8 text-center"
      data-testid="error-page"
    >
      <h1 className="text-3xl font-bold">Something went wrong</h1>
      <p className="text-muted-foreground">
        The app hit an unexpected error. You can try again, or reload the page.
      </p>
      <p
        className="text-base text-destructive"
        data-testid="error-page-message"
      >
        {error.message}
      </p>
      <div className="flex gap-2">
        <Button variant="primary" size="lg" onClick={onRetry}>
          Try again
        </Button>
        <Button
          variant="secondary"
          size="lg"
          onClick={() => window.location.reload()}
        >
          Reload page
        </Button>
      </div>
    </main>
  );
}
