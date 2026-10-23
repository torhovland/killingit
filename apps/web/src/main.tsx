// Sentry initialization must be imported first.
import "./instrument";
import { Auth0Provider } from "@auth0/auth0-react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import * as Sentry from "@sentry/react";
import "./index.css";
import { App } from "./App";
import { auth0ProviderOptions } from "./auth/config";
import { ErrorBoundary } from "./ErrorBoundary";

// Auth0 is optional at build/run time: without VITE_AUTH0_DOMAIN /
// VITE_AUTH0_CLIENT_ID the login UI degrades gracefully (see App.tsx). Values
// come from `apps/web/.env.local` (gitignored) and match ADR 0002.
const auth0Options = auth0ProviderOptions({
  domain: import.meta.env.VITE_AUTH0_DOMAIN,
  clientId: import.meta.env.VITE_AUTH0_CLIENT_ID,
  audience: import.meta.env.VITE_AUTH0_AUDIENCE,
  redirectUri: window.location.origin,
});

// React 19 error hooks: capture uncaught, ErrorBoundary-caught, and recoverable
// errors with Sentry. We write thin handlers rather than Sentry.reactErrorHandler
// so the callback signatures match React 19's types exactly (the project enables
// exactOptionalPropertyTypes, which reactErrorHandler's own types don't satisfy).
createRoot(document.getElementById("root")!, {
  onUncaughtError: (error, errorInfo) => {
    Sentry.captureException(error, {
      contexts: { react: { componentStack: errorInfo.componentStack ?? null } },
    });
    console.warn("Uncaught error", error, errorInfo.componentStack);
  },
  onCaughtError: (error, errorInfo) => {
    Sentry.captureException(error, {
      contexts: { react: { componentStack: errorInfo.componentStack ?? null } },
    });
    console.warn("Caught error", error, errorInfo.componentStack);
  },
  onRecoverableError: (error) => {
    Sentry.captureException(error);
  },
}).render(
  <StrictMode>
    <ErrorBoundary>
      {auth0Options ? (
        <Auth0Provider {...auth0Options}>
          <App />
        </Auth0Provider>
      ) : (
        <App />
      )}
    </ErrorBoundary>
  </StrictMode>,
);
