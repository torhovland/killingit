import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { HiddenFileInput } from "./HiddenFileInput";

describe("HiddenFileInput", () => {
  it("renders a visually hidden file input with its props", () => {
    const html = renderToStaticMarkup(
      <HiddenFileInput accept="image/*" capture="environment" />,
    );

    expect(html).toContain('type="file"');
    expect(html).toContain('accept="image/*"');
    expect(html).toContain('capture="environment"');
    expect(html).toContain('class="sr-only"');
  });
});
