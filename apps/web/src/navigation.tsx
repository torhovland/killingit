import {
  createContext,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from "react";

interface PageDefinition {
  /** The canonical URL of the page. */
  path: `/${string}`;
  /** The label in the account menu. */
  label: string;
  /** Whether the page uses the wider content panel. */
  wide: boolean;
}

/**
 * Every top-level page, in account-menu order. A page's URL, menu label and
 * content width live here; its component lives in `PageOutlet`.
 */
export const PAGE_DEFINITIONS = {
  coach: { path: "/coach", label: "Coach", wide: false },
  diet: { path: "/diet", label: "Diet", wide: false },
  fitness: { path: "/fitness", label: "Fitness", wide: false },
  calendar: { path: "/calendar", label: "Calendar", wide: true },
  activities: { path: "/activities", label: "Activities", wide: false },
  seasonReview: {
    path: "/season-review",
    label: "Season review",
    wide: false,
  },
  survey: { path: "/survey", label: "Coaching survey", wide: false },
  costs: { path: "/costs", label: "AI costs", wide: false },
  settings: { path: "/settings", label: "Settings", wide: false },
  admin: { path: "/admin", label: "Admin settings", wide: false },
} as const satisfies Record<string, PageDefinition>;

export type Page = keyof typeof PAGE_DEFINITIONS;

/** Every page, in the order the account menu shows them. */
export const PAGES = Object.keys(PAGE_DEFINITIONS) as Page[];

const COACH_PATH = PAGE_DEFINITIONS.coach.path;

const NavigationContext = createContext<(page: Page) => void>(() => {});

const pathListeners = new Set<() => void>();

export function pagePath(page: Page): string {
  return PAGE_DEFINITIONS[page].path;
}

export function pageLabel(page: Page): string {
  return PAGE_DEFINITIONS[page].label;
}

export function pageWidthClass(page: Page): "max-w-5xl" | "max-w-7xl" {
  return PAGE_DEFINITIONS[page].wide ? "max-w-7xl" : "max-w-5xl";
}

/** The page whose path is `pathname`, or null for an unknown path. */
export function pageForPath(pathname: string): Page | null {
  const normalized =
    pathname.length > 1 && pathname.endsWith("/")
      ? pathname.slice(0, -1)
      : pathname;
  return PAGES.find((page) => pagePath(page) === normalized) ?? null;
}

/**
 * Move to `page` through the History API. The current path is left alone so a
 * menu click on the current page adds no duplicate history entry; subscribers
 * re-read it either way. Redirects pass `replace` so back does not bounce
 * between a guard and the page it rejected.
 */
export function navigateToPage(
  page: Page,
  { replace = false }: { replace?: boolean } = {},
): void {
  const path = pagePath(page);
  if (window.location.pathname !== path) {
    if (replace) {
      window.history.replaceState(null, "", path);
    } else {
      window.history.pushState(null, "", path);
    }
  }
  for (const listener of pathListeners) {
    listener();
  }
}

function subscribeToPath(listener: () => void): () => void {
  const onPopState = (): void => listener();
  pathListeners.add(listener);
  window.addEventListener("popstate", onPopState);
  return () => {
    pathListeners.delete(listener);
    window.removeEventListener("popstate", onPopState);
  };
}

function currentPath(): string {
  return window.location.pathname;
}

function serverPath(): string {
  return COACH_PATH;
}

/** The browser's current path, live across navigation and history moves. */
export function useLocationPath(): string {
  return useSyncExternalStore(subscribeToPath, currentPath, serverPath);
}

/** Lets nested pages move to another top-level page without prop drilling. */
export function NavigationProvider({
  navigate,
  children,
}: {
  navigate: (page: Page) => void;
  children: ReactNode;
}) {
  return (
    <NavigationContext.Provider value={navigate}>
      {children}
    </NavigationContext.Provider>
  );
}

export function useNavigate(): (page: Page) => void {
  return useContext(NavigationContext);
}
