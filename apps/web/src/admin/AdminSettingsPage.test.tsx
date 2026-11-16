import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from "bun:test";
import { render, screen } from "@testing-library/react";

const originalDev = process.env.DEV;
const originalAppEnv = process.env.VITE_APP_ENV;

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

// The sections below own their own API and context wiring, and this suite only
// pins the development-tools gate. The picker is stubbed too: its own
// `isDateOverrideAllowed()` guard already renders nothing in production, so a
// real one would pass the production case whether or not the page compiled it
// out.
//
// A module mock outlives the file that registered it for late imports, so the
// two sections with their own suites delegate to the real component whenever
// this suite is not running. Otherwise their suites would render the stub and
// time out. See `docs/specs/web-interaction-tests.md`.
const { AdminLlmCallsSection: RealAdminLlmCallsSection } =
  await import("./AdminLlmCallsSection");
const { AdminModelRemarksSection: RealAdminModelRemarksSection } =
  await import("./AdminModelRemarksSection");

/** Whether this suite's own tests are running, so the stubs may stand in. */
let ownSuite = false;

await mock.module("./AdminQuestionsSection", () => ({
  AdminQuestionsSection: () => <div data-testid="questions-stub" />,
}));
await mock.module("./AdminLlmCallsSection", () => ({
  AdminLlmCallsSection: () =>
    ownSuite ? (
      <div data-testid="llm-calls-stub" />
    ) : (
      <RealAdminLlmCallsSection />
    ),
}));
await mock.module("./AdminModelRemarksSection", () => ({
  AdminModelRemarksSection: () =>
    ownSuite ? (
      <div data-testid="remarks-stub" />
    ) : (
      <RealAdminModelRemarksSection />
    ),
}));
await mock.module("./DevDatePicker", () => ({
  DevDatePicker: () => <div data-testid="dev-date-picker-stub" />,
}));

afterAll(() => {
  mock.restore();
});

const { AdminSettingsPage } = await import("./AdminSettingsPage");

beforeEach(() => {
  ownSuite = true;
  delete process.env.DEV;
  delete process.env.VITE_APP_ENV;
});

afterEach(() => {
  ownSuite = false;
  restoreEnv("DEV", originalDev);
  restoreEnv("VITE_APP_ENV", originalAppEnv);
});

describe("AdminSettingsPage", () => {
  it("shows the development tools on the dev server", () => {
    process.env.DEV = "true";

    render(<AdminSettingsPage />);

    expect(screen.getByTestId("dev-date-picker-stub")).toBeDefined();
  });

  it("shows the development tools in the Test environment", () => {
    process.env.VITE_APP_ENV = "Test";

    render(<AdminSettingsPage />);

    expect(screen.getByTestId("dev-date-picker-stub")).toBeDefined();
  });

  it("leaves the development tools out of a Production build", () => {
    process.env.VITE_APP_ENV = "Production";

    render(<AdminSettingsPage />);

    expect(screen.queryByTestId("dev-date-picker-stub")).toBeNull();
    expect(screen.getByTestId("questions-stub")).toBeDefined();
  });

  it("leaves the development tools out when no environment is configured", () => {
    render(<AdminSettingsPage />);

    expect(screen.queryByTestId("dev-date-picker-stub")).toBeNull();
  });
});
