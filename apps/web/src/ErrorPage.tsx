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
      <h1 className="text-2xl font-bold">Something went wrong</h1>
      <p className="opacity-70">
        The app hit an unexpected error. You can try again, or reload the page.
      </p>
      <p className="text-sm text-red-500" data-testid="error-page-message">
        {error.message}
      </p>
      <div className="flex gap-2">
        <button className="rounded border px-4 py-2" onClick={onRetry}>
          Try again
        </button>
        <button
          className="rounded border px-4 py-2"
          onClick={() => window.location.reload()}
        >
          Reload page
        </button>
      </div>
    </main>
  );
}
