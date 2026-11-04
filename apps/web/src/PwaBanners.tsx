interface PwaBannersProps {
  offline: boolean;
  updateReady: boolean;
  onReload: () => void;
}

/**
 * App-wide connection and update notices. Kept presentational so the provider
 * owns the browser listeners and this stays easy to render in tests.
 */
export function PwaBanners({
  offline,
  updateReady,
  onReload,
}: PwaBannersProps) {
  if (!offline && !updateReady) {
    return null;
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 px-3 pt-2 sm:px-4">
      {offline && (
        <p
          role="status"
          className="rounded border bg-inset px-3 py-2 text-base text-foreground"
          data-testid="offline-banner"
        >
          You're offline. The saved app and your last activities stay available;
          coaching updates need a connection.
        </p>
      )}
      {updateReady && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 rounded border border-transparent bg-primary px-3 py-2 text-base text-primary-foreground"
          data-testid="update-banner"
        >
          <p className="min-w-0 flex-1">
            A new version of Killing It is ready.
          </p>
          <button
            type="button"
            className="rounded border border-current px-3 py-1 font-medium hover:bg-primary-foreground/10"
            onClick={onReload}
          >
            Reload
          </button>
        </div>
      )}
    </div>
  );
}
