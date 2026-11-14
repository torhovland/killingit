import { describe, expect, it, mock } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import { DietSection } from "./DietSection";

function renderMarkup(enabled: boolean): string {
  return renderToStaticMarkup(
    <DietSection enabled={enabled} onSave={() => Promise.resolve()} />,
  );
}

describe("DietSection", () => {
  it("offers a diet-advice opt-in with an explanation", () => {
    const html = renderMarkup(false);

    expect(html).toContain("Give me diet advice and a food log");
    expect(html).toContain("Adds a meal log to your dashboard");
    expect(html).toContain('type="checkbox"');
    expect(html).not.toContain('checked=""');
  });

  it("reflects the stored opt-in", () => {
    expect(renderMarkup(true)).toContain('checked=""');
  });

  it("asks the page to save the choice", async () => {
    const user = userEvent.setup();
    const onSave = mock(() => Promise.resolve());
    render(<DietSection enabled={false} onSave={onSave} />);

    await user.click(
      screen.getByRole("checkbox", {
        name: /Give me diet advice and a food log/,
      }),
    );

    expect(onSave).toHaveBeenCalledWith(true);
  });
});
