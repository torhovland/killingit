import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useAppStatus } from "./AppStatus";
import { useAuth, type AuthState } from "./auth";
import { requestParsed, type ResponseSchema } from "./fetchAuthed";
import {
  createAbortableRequests,
  isAbortError,
  type AbortableRequests,
} from "./requestAbort";
import { reportError } from "./reportError";

/** One validated GET request a resource hook should load. */
export interface ApiRequest<T> {
  path: string;
  schema: ResponseSchema<T>;
  action: string;
}

/** One or more validated GET requests loaded together as one resource. */
export type ApiRequests<T extends Record<string, unknown>> = {
  [K in keyof T]: ApiRequest<T[K]>;
};

/** How a loaded resource reports itself to the rest of the app. */
export interface ApiResourceOptions {
  /**
   * Register the header spinner under this source while the request is in
   * flight. Omit it for a background load with no page-level spinner.
   */
  statusSource?: string;
}

export interface ApiResourceState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  /** Refetches the current request. */
  reload: () => void;
  /** Replaces the data after a mutation, for example a saved setting. */
  setData: Dispatch<SetStateAction<T | null>>;
  /** Clears a stale error after a successful mutation. */
  setError: Dispatch<SetStateAction<string | null>>;
}

export interface ApiResourcesState<T extends Record<string, unknown>> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
  setData: Dispatch<SetStateAction<T | null>>;
  setError: Dispatch<SetStateAction<string | null>>;
}

/**
 * Loads one authenticated, schema-validated GET and owns its abort, loading,
 * error, reload and header-spinner state. `path` is both the request URL and
 * the effect key: put every input that should trigger a refetch in the path,
 * and pass `null` while there is nothing to load. A request that is aborted by
 * a path change or an unmount never reaches state and never surfaces as an
 * error.
 */
export function useApiResource<T>(
  path: string | null,
  schema: ResponseSchema<T>,
  action: string,
  options: ApiResourceOptions = {},
): ApiResourceState<T> {
  const auth = useAuth();
  const load = useCallback(
    (signal: AbortSignal): Promise<T> => {
      if (path === null) {
        return Promise.reject(
          new Error("useApiResource cannot load without a path"),
        );
      }
      return requestParsed(path, auth, schema, action, { signal });
    },
    [auth, path, schema, action],
  );
  return useResourceState(auth, path, load, options.statusSource);
}

/**
 * The multi-request form of {@link useApiResource}. Every response is loaded
 * and kept together, so one failure leaves the resource unset instead of half
 * updated. The request names are the keys of `data`.
 */
export function useApiResources<T extends Record<string, unknown>>(
  requests: ApiRequests<T> | null,
  options: ApiResourceOptions = {},
): ApiResourcesState<T> {
  const auth = useAuth();
  const requestsRef = useRef(requests);
  useEffect(() => {
    requestsRef.current = requests;
  }, [requests]);
  const key =
    requests === null
      ? null
      : requestEntries(requests)
          .map(([name, request]) => `${name}:${request.path}`)
          .join("\n");
  const load = useCallback(
    (signal: AbortSignal): Promise<T> => {
      const current = requestsRef.current;
      if (current === null) {
        return Promise.reject(
          new Error("useApiResources cannot load without requests"),
        );
      }
      return loadRequests(current, auth, signal);
    },
    [auth],
  );
  return useResourceState(auth, key, load, options.statusSource);
}

/**
 * Starts an imperative load and aborts whatever is still in flight when the
 * owning effect cleans up. For requests whose result is handled by hand rather
 * than stored as a resource, such as a plan that drives a generation.
 */
export function useAbortableRequest<Args extends unknown[], T>(
  request: (signal: AbortSignal, ...args: Args) => Promise<T>,
): [(...args: Args) => Promise<T>, () => void] {
  const runner = useRef<AbortableRequests | null>(null);
  if (runner.current === null) {
    runner.current = createAbortableRequests();
  }
  const requestRef = useRef(request);
  useEffect(() => {
    requestRef.current = request;
  }, [request]);
  useEffect(() => {
    const current = runner.current;
    return () => current?.abortAll();
  }, []);
  const run = useCallback((...args: Args): Promise<T> => {
    const current = runner.current;
    if (current === null) {
      return Promise.reject(new Error("Abortable request is not ready"));
    }
    return current.run((signal) => requestRef.current(signal, ...args));
  }, []);
  const abortAll = useCallback(() => {
    runner.current?.abortAll();
  }, []);
  return [run, abortAll];
}

async function loadRequests<T extends Record<string, unknown>>(
  requests: ApiRequests<T>,
  auth: AuthState,
  signal: AbortSignal,
): Promise<T> {
  const loaded = await Promise.all(
    requestEntries(requests).map(async ([name, request]) => {
      const data = await requestParsed(
        request.path,
        auth,
        request.schema,
        request.action,
        { signal },
      );
      return [name, data] as const;
    }),
  );
  return Object.fromEntries(loaded) as T;
}

/**
 * `Object.entries` widens a mapped generic's values to `any`; this keeps the
 * entries typed as the request descriptors the hook built.
 */
function requestEntries<T extends Record<string, unknown>>(
  requests: ApiRequests<T>,
): Array<[string, ApiRequest<unknown>]> {
  return Object.entries(requests) as Array<[string, ApiRequest<unknown>]>;
}

function useResourceState<T>(
  auth: AuthState,
  key: string | null,
  load: (signal: AbortSignal) => Promise<T>,
  statusSource: string | undefined,
): ApiResourceState<T> {
  const { setStatus } = useAppStatus();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const loadRef = useRef(load);

  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  useEffect(() => {
    if (statusSource === undefined) {
      return;
    }
    setStatus(statusSource, loading ? "loading" : null);
    return () => setStatus(statusSource, null);
  }, [loading, setStatus, statusSource]);

  useEffect(() => {
    if (key === null || !auth.isAuthenticated) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void loadRef
      .current(controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) {
          setData(next);
        }
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted && !isAbortError(err)) {
          setError(reportError(err));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [auth, key, reloadKey]);

  const reload = useCallback(() => {
    setReloadKey((value) => value + 1);
  }, []);

  return { data, loading, error, reload, setData, setError };
}
