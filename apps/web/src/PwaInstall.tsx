interface InstallAppButtonProps {
  installable: boolean;
  onInstall: () => void;
}

/** Header action shown only while the browser offers an install prompt. */
export function InstallAppButton({
  installable,
  onInstall,
}: InstallAppButtonProps) {
  if (!installable) {
    return null;
  }

  return (
    <button
      type="button"
      className="rounded border bg-card px-2 py-1.5 text-base hover:bg-muted"
      onClick={onInstall}
      data-testid="install-app-button"
    >
      Install app
    </button>
  );
}

interface PwaInstallSectionProps {
  installed: boolean;
  installable: boolean;
  onInstall: () => void;
}

/** Settings explanation that also covers browsers without an install prompt. */
export function PwaInstallSection({
  installed,
  installable,
  onInstall,
}: PwaInstallSectionProps) {
  return (
    <section
      className="flex flex-col gap-3 rounded-lg border bg-card p-4"
      data-testid="pwa-install-section"
    >
      <h3 className="text-2xl font-semibold">Install app</h3>
      <p className="text-base text-muted-foreground">
        Killing It can live on your home screen and open full screen. It keeps
        the app shell and your last loaded activities available when the
        connection drops.
      </p>
      {installed ? (
        <p className="text-base text-foreground">
          Killing It is installed on this device.
        </p>
      ) : installable ? (
        <button
          type="button"
          className="self-start rounded border border-transparent bg-primary px-4 py-2 text-primary-foreground enabled:hover:bg-primary-hover"
          onClick={onInstall}
          data-testid="install-app-section-button"
        >
          Install Killing It
        </button>
      ) : (
        <p className="text-base text-muted-foreground">
          Open the app in Chrome, Edge, or Safari and use the browser's Install
          action. On iPhone and iPad, tap Share and then Add to Home Screen.
        </p>
      )}
    </section>
  );
}
