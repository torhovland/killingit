import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { QuestionForm } from "./QuestionForm";

describe("QuestionForm", () => {
  it("renders the initial prompt, required flag, and actions", () => {
    const html = renderToStaticMarkup(
      <QuestionForm
        initialPrompt="How did the session feel?"
        initialRequired={false}
        submitLabel="Save new version"
        onSubmit={() => Promise.resolve()}
        onCancel={() => {}}
      />,
    );

    expect(html).toContain("How did the session feel?");
    expect(html).toContain("Save new version");
    expect(html).toContain("Cancel");
    expect(html).toContain("Required");
  });
});
