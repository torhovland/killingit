/**
 * True when a rejection came from an `AbortSignal` rather than a real failure.
 * A load that was cancelled because its dependency changed or its component
 * unmounted must not surface as an error.
 */
export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

/** Tracks the abort controllers of the imperative loads a component starts. */
export interface AbortableRequests {
  /** Start a request; the callback receives the request's own signal. */
  run<T>(request: (signal: AbortSignal) => Promise<T>): Promise<T>;
  /** Abort every request that is still in flight. */
  abortAll(): void;
}

/**
 * Keeps every in-flight request's controller in one set. An effect that owns
 * imperative loads returns `abortAll` as its cleanup, so a dependency change or
 * an unmount cancels the requests instead of leaving them to resolve into
 * state that is no longer on screen.
 */
export function createAbortableRequests(): AbortableRequests {
  const controllers = new Set<AbortController>();
  return {
    run<T>(request: (signal: AbortSignal) => Promise<T>): Promise<T> {
      const controller = new AbortController();
      controllers.add(controller);
      return request(controller.signal).finally(() => {
        controllers.delete(controller);
      });
    },
    abortAll(): void {
      for (const controller of controllers) {
        controller.abort();
      }
      controllers.clear();
    },
  };
}
