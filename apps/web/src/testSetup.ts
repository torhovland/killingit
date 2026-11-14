import { afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

/**
 * Gives every `bun:test` module in this package a browser-like global scope,
 * so React components can be rendered, focused and clicked with Testing
 * Library. Bun loads this file through `bunfig.toml` before the test files, so
 * `document` exists by the time Testing Library captures `document.body`.
 * Tests are plain React code, not a browser run: there is no real navigation
 * or layout. See `docs/specs/web-interaction-tests.md`.
 */
GlobalRegistrator.register();

// React warns on an update that is not wrapped in `act`; Testing Library wraps
// the renders and interactions it drives itself, which is what the flag
// promises. React 19 reads it from here, matching `@testing-library/react`.
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// Testing Library registers its own automatic cleanup from an import-time
// `afterEach`, which Bun scopes to the file that imported it. Registering the
// unmount here instead keeps one `document.body` clean for every test file in
// the run. The import is dynamic because `screen` binds to `document.body`
// when the module loads, and that must happen after `register()` above.
const { cleanup } = await import("@testing-library/react");
afterEach(cleanup);
