// Sentry initialization must be imported first.
import "./instrument";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import * as Sentry from "@sentry/react";
import "./index.css";
import { App } from "./App";

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
  onCaughtError: (error) => {
    Sentry.captureException(error);
  },
  onRecoverableError: (error) => {
    Sentry.captureException(error);
  },
}).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
