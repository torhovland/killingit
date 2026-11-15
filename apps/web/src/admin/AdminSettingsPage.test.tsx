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
await mock.module("./AdminQuestionsSection", () => ({
  AdminQuestionsSection: () => <div data-testid="questions-stub" />,
}));
await mock.module("./AdminLlmCallsSection", () => ({
  AdminLlmCallsSection: () => <div data-testid="llm-calls-stub" />,
}));
await mock.module("./AdminModelRemarksSection", () => ({
  AdminModelRemarksSection: () => <div data-testid="remarks-stub" />,
}));
await mock.module("./DevDatePicker", () => ({
  DevDatePicker: () => <div data-testid="dev-date-picker-stub" />,
}));

afterAll(() => {
  mock.restore();
});

const { AdminSettingsPage } = await import("./AdminSettingsPage");

beforeEach(() => {
  delete process.env.DEV;
  delete process.env.VITE_APP_ENV;
});

afterEach(() => {
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
