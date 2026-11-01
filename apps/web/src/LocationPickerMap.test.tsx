import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { LocationPickerMap } from "./LocationPickerMap";

describe("LocationPickerMap", () => {
  it("renders OpenStreetMap tiles that keep their intrinsic width", () => {
    const html = renderToStaticMarkup(
      <LocationPickerMap value={null} onSelect={() => undefined} />,
    );

    expect(html).toContain("tile.openstreetmap.org");
    // The layer has no intrinsic width, so Tailwind's global `max-width: 100%`
    // on images would otherwise collapse every tile to zero width.
    expect(html).toContain("max-w-none");
  });
});
