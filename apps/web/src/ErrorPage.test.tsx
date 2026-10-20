import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ErrorBoundary } from "./ErrorBoundary";
import { ErrorPage } from "./ErrorPage";

describe("ErrorPage", () => {
  it("renders the error message and recovery actions", () => {
    const html = renderToStaticMarkup(
      <ErrorPage error={new Error("boom")} onRetry={() => {}} />,
    );

    expect(html).toContain("Something went wrong");
    expect(html).toContain("boom");
    expect(html).toContain("Try again");
    expect(html).toContain("Reload page");
  });
});

describe("ErrorBoundary", () => {
  it("stores a thrown render error so the fallback can render", () => {
    const error = new Error("boom");

    expect(ErrorBoundary.getDerivedStateFromError(error)).toEqual({ error });
  });
});
