import { describe, expect, it, mock } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LocationPickerMap } from "./LocationPickerMap";

/** The centre the map's polite live region last announced. */
function announcedCentre(): { latitude: number; longitude: number } {
  const announcement = screen.getByRole("status").textContent ?? "";
  const [latitude, longitude] = announcement.match(/-?\d+\.\d+/g) ?? [];
  if (latitude === undefined || longitude === undefined) {
    throw new Error(`The map announced no coordinates: ${announcement}`);
  }
  return { latitude: Number(latitude), longitude: Number(longitude) };
}

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

  it("is a keyboard stop whose name describes the keyboard controls", async () => {
    const user = userEvent.setup();
    render(<LocationPickerMap value={null} onSelect={() => undefined} />);

    const map = screen.getByRole("application", {
      name: /location picker map/i,
    });
    await user.tab();
    expect(document.activeElement).toBe(map);

    const label = map.getAttribute("aria-label") ?? "";
    expect(label).toContain("arrow keys");
    expect(label).toContain("plus and minus");
    expect(label).toContain("Enter or Space");
    // The old name described the pointer only, which is the bug in #324.
    expect(label).not.toBe(
      "Location picker map. Click to set your location. Scroll to zoom.",
    );
  });

  it("moves the centre with the arrow keys and announces it", async () => {
    const user = userEvent.setup();
    render(<LocationPickerMap value={null} onSelect={() => undefined} />);
    await user.tab();

    const start = announcedCentre();
    await user.keyboard("{ArrowRight}");
    const east = announcedCentre();
    expect(east.longitude).toBeGreaterThan(start.longitude);
    expect(east.latitude).toBeCloseTo(start.latitude, 4);

    await user.keyboard("{ArrowUp}");
    const north = announcedCentre();
    expect(north.latitude).toBeGreaterThan(east.latitude);
    expect(north.longitude).toBeCloseTo(east.longitude, 4);

    // The live region is polite, so a screen reader picks up the new centre
    // without interrupting the athlete.
    expect(screen.getByRole("status").getAttribute("aria-live")).toBe("polite");
  });

  it("zooms with plus and minus", async () => {
    const user = userEvent.setup();
    render(<LocationPickerMap value={null} onSelect={() => undefined} />);
    await user.tab();

    const zoomOut = screen.getByRole<HTMLButtonElement>("button", {
      name: "Zoom out",
    });
    expect(zoomOut.disabled).toBe(true);

    await user.keyboard("+");
    expect(zoomOut.disabled).toBe(false);
    expect(
      [...document.querySelectorAll("img")].some((tile) =>
        tile.getAttribute("src")?.includes("/3/"),
      ),
    ).toBe(true);

    await user.keyboard("-");
    expect(zoomOut.disabled).toBe(true);
  });

  it("leaves the zoom buttons' key presses to the buttons", async () => {
    const user = userEvent.setup();
    const onSelect = mock((_latitude: number, _longitude: number) => undefined);
    render(<LocationPickerMap value={null} onSelect={onSelect} />);

    screen.getByRole("button", { name: "Zoom in" }).focus();
    await user.keyboard("{Enter}");

    expect(onSelect).not.toHaveBeenCalled();
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Zoom out" })
        .disabled,
    ).toBe(false);
  });

  it("chooses the centred point with Enter and Space", async () => {
    const user = userEvent.setup();
    const onSelect = mock((_latitude: number, _longitude: number) => undefined);
    render(<LocationPickerMap value={null} onSelect={onSelect} />);
    await user.tab();

    await user.keyboard("{ArrowRight}");
    const centre = announcedCentre();
    await user.keyboard("{Enter}");
    const [latitude, longitude] = onSelect.mock.calls.at(-1) ?? [];
    expect(latitude).toBeCloseTo(centre.latitude, 3);
    expect(longitude).toBeCloseTo(centre.longitude, 3);

    await user.keyboard(" ");
    expect(onSelect).toHaveBeenCalledTimes(2);
    const [spaceLatitude, spaceLongitude] = onSelect.mock.calls.at(-1) ?? [];
    expect(spaceLatitude).toBeCloseTo(centre.latitude, 3);
    expect(spaceLongitude).toBeCloseTo(centre.longitude, 3);
  });
});
