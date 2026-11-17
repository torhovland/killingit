import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { Tabs } from "./Tabs";

type Level = "day" | "week" | "season";

const TABS = [
  { id: "day" as const, label: "Day", content: <p>Today's session</p> },
  { id: "week" as const, label: "Week", content: <p>This week's sessions</p> },
  {
    id: "season" as const,
    label: "Season",
    content: <p>The whole season</p>,
  },
];

/** A tablist and its panels, like the coach plan's levels. */
function Harness({
  initial = "day",
  className = "",
}: {
  initial?: Level;
  className?: string;
}) {
  const [tab, setTab] = useState<Level>(initial);
  return (
    <Tabs
      label="Plan levels"
      tabs={TABS}
      value={tab}
      onChange={setTab}
      className={className}
      testId="tabs"
    />
  );
}

describe("Tabs", () => {
  it("renders a labelled tablist where only the selected tab's panel is mounted", () => {
    render(<Harness />);

    const tablist = screen.getByRole("tablist", { name: "Plan levels" });
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "Day",
      "Week",
      "Season",
    ]);

    const day = screen.getByRole("tab", { name: "Day" });
    const week = screen.getByRole("tab", { name: "Week" });
    expect(day.getAttribute("aria-selected")).toBe("true");
    expect(day.tabIndex).toBe(0);
    expect(week.getAttribute("aria-selected")).toBe("false");
    expect(week.tabIndex).toBe(-1);

    const panel = screen.getByRole("tabpanel", { name: "Day" });
    expect(day.getAttribute("aria-controls")).toBe(panel.id);
    expect(panel.getAttribute("aria-labelledby")).toBe(day.id);
    expect(tablist.contains(day)).toBe(true);
    expect(screen.getByText("Today's session")).toBeDefined();
    expect(screen.queryByText("This week's sessions")).toBeNull();
  });

  it("selects a tab and shows its panel when it is clicked", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("tab", { name: "Week" }));

    expect(
      screen.getByRole("tab", { name: "Week" }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(screen.getByRole("tab", { name: "Week" }).tabIndex).toBe(0);
    expect(
      screen.getByRole("tab", { name: "Day" }).getAttribute("aria-selected"),
    ).toBe("false");
    expect(screen.getByRole("tabpanel", { name: "Week" })).toBeDefined();
    expect(screen.getByText("This week's sessions")).toBeDefined();
    expect(screen.queryByText("Today's session")).toBeNull();
  });

  it("moves selection and focus with ArrowRight and ArrowLeft, wrapping at the ends", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const day = screen.getByRole("tab", { name: "Day" });

    day.focus();
    await user.keyboard("{ArrowRight}");
    const week = screen.getByRole("tab", { name: "Week" });
    expect(week.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(week);

    await user.keyboard("{ArrowLeft}");
    expect(day.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(day);

    await user.keyboard("{ArrowLeft}");
    const season = screen.getByRole("tab", { name: "Season" });
    expect(season.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(season);

    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(day);
  });

  it("jumps to the first and last tab with Home and End", async () => {
    const user = userEvent.setup();
    render(<Harness initial="week" />);
    const week = screen.getByRole("tab", { name: "Week" });

    week.focus();
    await user.keyboard("{End}");
    const season = screen.getByRole("tab", { name: "Season" });
    expect(season.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(season);

    await user.keyboard("{Home}");
    const day = screen.getByRole("tab", { name: "Day" });
    expect(day.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(day);
    expect(screen.getByRole("tabpanel", { name: "Day" })).toBeDefined();
  });

  it("keeps the root layout and lets the caller extend it", () => {
    render(<Harness className="mt-3" />);

    const root = screen.getByTestId("tabs");
    expect(root.className).toContain("mt-3");
  });
});
