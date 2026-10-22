import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type AppBusyState = "loading" | "syncing" | "thinking";

interface AppStatusContextValue {
  status: AppBusyState | "idle";
  /** Report a busy state for a named source; pass null when it goes idle. */
  setStatus: (source: string, status: AppBusyState | null) => void;
}

const AppStatusContext = createContext<AppStatusContextValue | null>(null);

const PRIORITY: Record<AppBusyState, number> = {
  thinking: 3,
  syncing: 2,
  loading: 1,
};

/** Shares a single header spinner state across the signed-in pages. */
export function AppStatusProvider({ children }: { children: ReactNode }) {
  const [sources, setSources] = useState<Record<string, AppBusyState>>({});

  const setStatus = useCallback(
    (source: string, status: AppBusyState | null) => {
      setSources((current) => {
        if (status === null) {
          if (!(source in current)) {
            return current;
          }
          const rest = { ...current };
          delete rest[source];
          return rest;
        }
        if (current[source] === status) {
          return current;
        }
        return { ...current, [source]: status };
      });
    },
    [],
  );

  const status = useMemo<AppBusyState | "idle">(() => {
    let current: AppBusyState | "idle" = "idle";
    for (const value of Object.values(sources)) {
      if (current === "idle" || PRIORITY[value] > PRIORITY[current]) {
        current = value;
      }
    }
    return current;
  }, [sources]);

  return (
    <AppStatusContext.Provider value={{ status, setStatus }}>
      {children}
    </AppStatusContext.Provider>
  );
}

export function useAppStatus(): AppStatusContextValue {
  const value = useContext(AppStatusContext);
  if (value === null) {
    throw new Error("useAppStatus must be used inside AppStatusProvider");
  }
  return value;
}
