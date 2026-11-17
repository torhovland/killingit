import {
  currentUserSchema,
  type CurrentUser,
  type UserSettingsUpdate,
} from "@killingit/shared";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import { useAuth } from "./auth";
import { requestParsed } from "./fetchAuthed";
import { useApiResource } from "./useApiResource";
import { Button } from "./components/Button";

interface CurrentUserContextValue {
  /** The signed-in account, or null before it loads and after sign-out. */
  user: CurrentUser | null;
  /** Whether the account is still loading. */
  loading: boolean;
  /** The failed account load, or null. */
  error: string | null;
  /** Saves one current-user setting and returns the account the API stored. */
  update: (patch: UserSettingsUpdate) => Promise<CurrentUser>;
  /** Refetches the account after a failed load. */
  reload: () => void;
}

const CurrentUserContext = createContext<CurrentUserContextValue | null>(null);

/**
 * Owns the signed-in account for the whole app. Every page reads it with
 * {@link useCurrentUser} instead of receiving it through props, and every
 * current-user write goes through `update`, so a saved location, diet-advice
 * setting or time zone reaches every page at once. A failed load keeps the
 * error here, where {@link CurrentUserLoadError} offers the retry.
 */
export function CurrentUserProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const { data, loading, error, reload, setData, setError } = useApiResource(
    auth.isAuthenticated ? "/api/me" : null,
    currentUserSchema,
    "Loading the current user",
  );

  const update = useCallback(
    async (patch: UserSettingsUpdate): Promise<CurrentUser> => {
      const user = await requestParsed(
        "/api/me",
        auth,
        currentUserSchema,
        "Saving your settings",
        {
          method: "PATCH",
          json: patch,
        },
      );
      setData(user);
      setError(null);
      return user;
    },
    [auth, setData, setError],
  );

  const user = auth.isAuthenticated ? data : null;
  const value = useMemo<CurrentUserContextValue>(
    () => ({
      user,
      loading: auth.isAuthenticated && loading,
      error: auth.isAuthenticated ? error : null,
      update,
      reload,
    }),
    [auth.isAuthenticated, user, loading, error, update, reload],
  );

  return (
    <CurrentUserContext.Provider value={value}>
      {children}
    </CurrentUserContext.Provider>
  );
}

/** The current account, or a clear failure when used outside the provider. */
export function useCurrentUser(): CurrentUserContextValue {
  const value = useContext(CurrentUserContext);
  if (value === null) {
    throw new Error("useCurrentUser must be used inside CurrentUserProvider");
  }
  return value;
}

/**
 * The failed account load with a retry. The app keeps rendering the pages it
 * can, but the athlete can ask for the account again instead of reloading the
 * whole app.
 */
export function CurrentUserLoadError() {
  const { error, reload } = useCurrentUser();
  if (error === null) {
    return null;
  }
  return (
    <section
      className="flex flex-col items-start gap-2"
      data-testid="current-user-error"
    >
      <p className="text-destructive">Error: {error}</p>
      <Button type="button" variant="secondary" size="lg" onClick={reload}>
        Retry
      </Button>
    </section>
  );
}
