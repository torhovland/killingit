import { createContext, useContext, type ReactNode } from "react";

export type Page =
  "coach" | "activities" | "seasonReview" | "survey" | "settings" | "admin";

const NavigationContext = createContext<(page: Page) => void>(() => {});

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
