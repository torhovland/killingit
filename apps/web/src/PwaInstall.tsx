import { Button } from "./components/Button";
import { Card } from "./components/Card";
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
    <Button
      type="button"
      variant="secondary"
      size="sm"
      className="py-1.5"
      onClick={onInstall}
      data-testid="install-app-button"
    >
      Install app
    </Button>
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
    <Card
      as="section"
      className="flex flex-col gap-3"
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
        <Button
          type="button"
          variant="primary"
          size="lg"
          className="self-start"
          onClick={onInstall}
          data-testid="install-app-section-button"
        >
          Install Killing It
        </Button>
      ) : (
        <p className="text-base text-muted-foreground">
          Open the app in Chrome, Edge, or Safari and use the browser's Install
          action. On iPhone and iPad, tap Share and then Add to Home Screen.
        </p>
      )}
    </Card>
  );
}
