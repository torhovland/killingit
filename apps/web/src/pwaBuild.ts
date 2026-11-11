import { APP_BUILD_META_NAME, APP_BUILD_PLACEHOLDER } from "../pwa/buildId";

/** How long to wait for a worker to report its build before assuming it differs. */
const WORKER_REPLY_TIMEOUT_MS = 3000;

/** The message surface of a service worker, so tests can supply a fake. */
interface WorkerMessenger {
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

/** The part of `Document` this module needs, so tests can supply a fake. */
interface BuildIdDocument {
  querySelector(
    selector: string,
  ): { getAttribute(name: string): string | null } | null;
}

/**
 * The build this page booted, read from the meta tag the production build
 * stamps. A development page keeps the placeholder and reports no build.
 */
export function readPageBuildId(doc: BuildIdDocument): string | null {
  const content =
    doc
      .querySelector(`meta[name="${APP_BUILD_META_NAME}"]`)
      ?.getAttribute("content")
      ?.trim() ?? "";
  return content === "" || content === APP_BUILD_PLACEHOLDER ? null : content;
}

/**
 * Asks a worker which build it precached. A worker that does not answer in time
 * reports no build, so the caller falls back to the update banner rather than
 * assuming the page is already current.
 */
export function requestWorkerBuildId(
  worker: WorkerMessenger,
  timeoutMs = WORKER_REPLY_TIMEOUT_MS,
): Promise<string | null> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const settle = (buildId: string | null): void => {
      if (timer !== null) {
        clearTimeout(timer);
      }
      channel.port1.close();
      resolve(buildId);
    };
    timer = setTimeout(() => settle(null), timeoutMs);
    channel.port1.onmessage = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; buildId?: unknown } | null;
      settle(
        data?.type === "BUILD_ID" && typeof data.buildId === "string"
          ? data.buildId
          : null,
      );
    };
    try {
      worker.postMessage({ type: "GET_BUILD_ID" }, [channel.port2]);
    } catch {
      settle(null);
    }
  });
}

/**
 * Whether the running page already contains the build a waiting worker
 * precached. An update check on a fresh online visit finds a worker for the
 * shell the page just loaded, so that worker can activate without a reload.
 */
export function isSameBuild(
  pageBuildId: string | null,
  workerBuildId: string | null,
): boolean {
  return pageBuildId !== null && pageBuildId === workerBuildId;
}
