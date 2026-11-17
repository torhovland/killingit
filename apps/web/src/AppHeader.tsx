import type { AppBusyState } from "./AppStatus";
import { InstallAppButton } from "./PwaInstall";
import { UserMenu } from "./UserMenu";
import type { Page } from "./navigation";

interface AppHeaderProps {
  /** Whether the athlete is signed in; a visitor sees a loading note instead. */
  signedIn: boolean;
  /** Whether the auth session is still loading. */
  loading: boolean;
  /** The athlete's first name, for the account menu. */
  firstName?: string | null | undefined;
  /** The athlete's profile photo, for the account menu. */
  picture?: string | null | undefined;
  /** Whether the account is the admin. */
  isAdmin: boolean;
  /** The header spinner's shared busy state. */
  status: AppBusyState | "idle";
  /** The page on screen, marked in the account menu. */
  page: Page;
  /** Whether the browser offered installation. */
  installable: boolean;
  onInstall: () => void;
  onNavigate: (page: Page) => void;
  onSignOut: () => void;
}

/**
 * The slim app header: the brand link back to the coaching dashboard, the
 * install action while the browser offers it, and the signed-in account menu
 * with the shared busy spinner.
 */
export function AppHeader({
  signedIn,
  loading,
  firstName,
  picture,
  isAdmin,
  status,
  page,
  installable,
  onInstall,
  onNavigate,
  onSignOut,
}: AppHeaderProps) {
  return (
    <header className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 sm:px-4">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <a
          href="/coach"
          className="flex items-center gap-2 text-2xl font-bold tracking-tight no-underline hover:no-underline"
          onClick={(event) => {
            event.preventDefault();
            onNavigate("coach");
          }}
        >
          <img
            src="/logo.svg"
            alt=""
            width={32}
            height={32}
            className="size-8 shrink-0"
          />
          <span className="whitespace-nowrap">Killing It</span>
        </a>
        <span
          aria-hidden="true"
          className="hidden h-5 w-px bg-muted-foreground/45 sm:block"
        />
        <p className="hidden text-sm text-muted-foreground sm:block">
          <b className="font-medium text-primary">Deadly serious</b> about your
          progress
        </p>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <InstallAppButton installable={installable} onInstall={onInstall} />
        {signedIn ? (
          <UserMenu
            firstName={firstName}
            picture={picture}
            isAdmin={isAdmin}
            status={status}
            currentPage={page}
            onNavigate={onNavigate}
            onSignOut={onSignOut}
          />
        ) : loading ? (
          <p className="text-base text-muted-foreground">Loading…</p>
        ) : null}
      </div>
    </header>
  );
}
