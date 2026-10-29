import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Bullet, Bullets } from "./Bullet";

describe("Bullet", () => {
  it("spaces the middot with three times a word space", () => {
    expect(renderToStaticMarkup(<Bullet />)).toBe(
      '<span class="mx-[0.75em]">·</span>',
    );
  });

  it("separates inline parts", () => {
    expect(
      renderToStaticMarkup(<Bullets parts={["one", "two", "three"]} />),
    ).toBe(
      'one<span class="mx-[0.75em]">·</span>two<span class="mx-[0.75em]">·</span>three',
    );
  });
});
