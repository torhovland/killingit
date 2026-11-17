import { useState } from "react";
import type { AppBusyState } from "./AppStatus";
import { PAGES, pageLabel, type Page } from "./navigation";
import { Spinner } from "./Spinner";
import { Badge } from "./components/Badge";
import { Button } from "./components/Button";
import { Menu } from "./components/Menu";

interface UserMenuProps {
  firstName?: string | null | undefined;
  picture?: string | null | undefined;
  isAdmin: boolean;
  status: AppBusyState | "idle";
  currentPage: Page;
  onNavigate: (page: Page) => void;
  onSignOut: () => void;
}

/** The spinner label for each busy state; `idle` shows no spinner. */
const STATUS_LABELS: Record<AppBusyState, string> = {
  loading: "Loading",
  syncing: "Syncing",
  thinking: "The coach is thinking",
};

/**
 * The signed-in account menu: the athlete's name, optional round avatar, the
 * admin badge and the shared busy spinner sit on the trigger, and the panel
 * navigates between the pages an account may open.
 */
export function UserMenu({
  firstName,
  picture,
  isAdmin,
  status,
  currentPage,
  onNavigate,
  onSignOut,
}: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const name = firstName?.trim() || "Athlete";
  const label = status === "idle" ? null : STATUS_LABELS[status];

  function choose(page: Page): void {
    setOpen(false);
    onNavigate(page);
  }

  function signOut(): void {
    setOpen(false);
    onSignOut();
  }

  return (
    <Menu
      label="Account menu"
      panelLabel="Account"
      open={open}
      onOpenChange={setOpen}
      testId="user-menu"
      trigger={
        <>
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="size-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
          {picture ? (
            <img
              src={picture}
              alt=""
              className="size-7 rounded-full object-cover"
            />
          ) : (
            <span className="flex size-7 items-center justify-center rounded-full bg-accent text-sm font-medium text-accent-foreground">
              {name.slice(0, 1).toUpperCase()}
            </span>
          )}
          <span className="hidden font-medium sm:inline">{name}</span>
          {isAdmin && (
            <Badge variant="accent" className="hidden sm:inline">
              Admin
            </Badge>
          )}
          {label && <Spinner label={label} />}
        </>
      }
    >
      {PAGES.filter((entry) => entry !== "admin" || isAdmin).map((entry) => (
        <Button
          key={entry}
          type="button"
          variant="ghost"
          size="menu"
          aria-current={entry === currentPage ? "page" : undefined}
          onClick={() => choose(entry)}
        >
          {pageLabel(entry)}
        </Button>
      ))}
      <Button
        type="button"
        variant="ghost"
        size="menu"
        className="text-destructive"
        onClick={signOut}
      >
        Sign out
      </Button>
    </Menu>
  );
}
