import * as Sentry from "@sentry/react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { isSameBuild, readPageBuildId, requestWorkerBuildId } from "./pwaBuild";

const SERVICE_WORKER_URL = "/sw.js";
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

export interface PwaState {
  /** The browser offered installation and it has not been answered yet. */
  installable: boolean;
  /** The app is launched standalone or was installed during this visit. */
  installed: boolean;
  /** The browser reports no network connection. */
  offline: boolean;
  /** A new service worker is waiting for the athlete to reload. */
  updateReady: boolean;
}

interface PwaContextValue extends PwaState {
  install(): Promise<void>;
  reloadForUpdate(): void;
}

const PwaContext = createContext<PwaContextValue | null>(null);

/**
 * Registers the production service worker and exposes install, offline, and
 * update state to the app. The Vite dev server is never controlled by a worker.
 */
export function PwaProvider({ children }: { children: ReactNode }) {
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(isStandaloneDisplay);
  const [offline, setOffline] = useState(
    typeof navigator !== "undefined" && !navigator.onLine,
  );
  const [updateReady, setUpdateReady] = useState(false);
  const registration = useRef<ServiceWorkerRegistration | null>(null);
  const reloading = useRef(false);

  useEffect(() => {
    function offerInstall(event: Event): void {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    }

    function markInstalled(): void {
      setInstalled(true);
      setInstallPrompt(null);
    }

    function markOnline(): void {
      setOffline(false);
    }

    function markOffline(): void {
      setOffline(true);
    }

    window.addEventListener("beforeinstallprompt", offerInstall);
    window.addEventListener("appinstalled", markInstalled);
    window.addEventListener("online", markOnline);
    window.addEventListener("offline", markOffline);
    return () => {
      window.removeEventListener("beforeinstallprompt", offerInstall);
      window.removeEventListener("appinstalled", markInstalled);
      window.removeEventListener("online", markOnline);
      window.removeEventListener("offline", markOffline);
    };
  }, []);

  useEffect(() => {
    if (!import.meta.env.PROD || !("serviceWorker" in navigator)) {
      return;
    }

    let cancelled = false;
    let lastUpdateCheck = Date.now();
    const pageBuildId = readPageBuildId(document);
    const askedWorkers = new WeakSet<ServiceWorker>();

    /**
     * A waiting worker for the build this page already runs is only a leftover
     * from the update check every visit performs: the shell came from the
     * network, so nothing is stale and the athlete has nothing to reload.
     * Activate it quietly instead of showing the update banner.
     */
    async function noteUpdate(worker: ServiceWorker | null): Promise<void> {
      if (
        worker === null ||
        navigator.serviceWorker.controller === null ||
        worker.state !== "installed" ||
        askedWorkers.has(worker)
      ) {
        return;
      }
      askedWorkers.add(worker);
      const workerBuildId = await requestWorkerBuildId(worker);
      if (cancelled) {
        return;
      }
      if (isSameBuild(pageBuildId, workerBuildId)) {
        worker.postMessage({ type: "SKIP_WAITING" });
        return;
      }
      setUpdateReady(true);
    }

    function watchInstalling(reg: ServiceWorkerRegistration): void {
      const worker = reg.installing;
      if (worker === null) {
        return;
      }
      worker.addEventListener("statechange", () => void noteUpdate(worker));
    }

    function onControllerChange(): void {
      if (reloading.current) {
        window.location.reload();
      }
    }

    navigator.serviceWorker.addEventListener(
      "controllerchange",
      onControllerChange,
    );

    navigator.serviceWorker
      .register(SERVICE_WORKER_URL, {
        scope: "/",
        updateViaCache: "none",
      })
      .then((reg) => {
        if (cancelled) {
          return;
        }
        registration.current = reg;
        void noteUpdate(reg.waiting);
        watchInstalling(reg);
        reg.addEventListener("updatefound", () => watchInstalling(reg));
      })
      .catch((error: unknown) => {
        Sentry.captureException(error);
      });

    function checkForUpdate(): void {
      if (document.visibilityState !== "visible") {
        return;
      }
      const now = Date.now();
      if (now - lastUpdateCheck < UPDATE_CHECK_INTERVAL_MS) {
        return;
      }
      lastUpdateCheck = now;
      registration.current?.update().catch(() => {
        // An offline or interrupted check must not surface as an app error.
      });
    }

    document.addEventListener("visibilitychange", checkForUpdate);
    const interval = window.setInterval(
      checkForUpdate,
      UPDATE_CHECK_INTERVAL_MS,
    );

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", checkForUpdate);
      window.clearInterval(interval);
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        onControllerChange,
      );
    };
  }, []);

  const install = useCallback(async () => {
    if (installPrompt === null) {
      return;
    }
    try {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === "accepted") {
        setInstalled(true);
      }
    } catch (error: unknown) {
      Sentry.captureException(error);
    } finally {
      setInstallPrompt(null);
    }
  }, [installPrompt]);

  const reloadForUpdate = useCallback(() => {
    const waiting = registration.current?.waiting ?? null;
    if (waiting === null) {
      window.location.reload();
      return;
    }
    reloading.current = true;
    waiting.postMessage({ type: "SKIP_WAITING" });
    // A browser that does not emit `controllerchange` should still leave the
    // old shell rather than trapping the athlete on a stale version.
    window.setTimeout(() => window.location.reload(), 3000);
  }, []);

  const value = useMemo<PwaContextValue>(
    () => ({
      installable: installPrompt !== null && !installed,
      installed,
      offline,
      updateReady,
      install,
      reloadForUpdate,
    }),
    [install, installPrompt, installed, offline, reloadForUpdate, updateReady],
  );

  return <PwaContext.Provider value={value}>{children}</PwaContext.Provider>;
}

export function usePwa(): PwaContextValue {
  const value = useContext(PwaContext);
  if (value === null) {
    throw new Error("usePwa must be used inside PwaProvider");
  }
  return value;
}

function isStandaloneDisplay(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const standaloneNavigator = navigator as Navigator & {
    standalone?: boolean;
  };
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    standaloneNavigator.standalone === true
  );
}
