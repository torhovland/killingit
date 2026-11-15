import { useState } from "react";
import { describe, expect, it, mock } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AthleteLocation } from "@killingit/shared";
import { TILE_SIZE } from "../mapProjection";
import { LocationPickerMap } from "./LocationPickerMap";

const OSLO: AthleteLocation = {
  latitude: 59.91,
  longitude: 10.75,
  name: "Oslo, Norway",
};
const TRONDHEIM: AthleteLocation = {
  latitude: 63.43,
  longitude: 10.39,
  name: "Trondheim, Norway",
};

/** The centre the map's polite live region last announced. */
function announcedCentre(): { latitude: number; longitude: number } {
  const announcement = screen.getByRole("status").textContent ?? "";
  const [latitude, longitude] = announcement.match(/-?\d+\.\d+/g) ?? [];
  if (latitude === undefined || longitude === undefined) {
    throw new Error(`The map announced no coordinates: ${announcement}`);
  }
  return { latitude: Number(latitude), longitude: Number(longitude) };
}

/** happy-dom has no layout, so give the map the size a browser would. */
function mapWithBounds(): HTMLElement {
  const map = screen.getByRole("application", {
    name: /location picker map/i,
  });
  map.getBoundingClientRect = () => ({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 400,
    bottom: 300,
    width: 400,
    height: 300,
    toJSON: () => ({}),
  });
  return map;
}

/** A parent that stores the point the map selects, like `LocationSection`. */
function MapWithValue({ initial }: { initial: AthleteLocation | null }) {
  const [value, setValue] = useState(initial);
  return (
    <LocationPickerMap
      value={value}
      onSelect={(latitude, longitude) =>
        setValue({ latitude, longitude, name: null })
      }
    />
  );
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
    // The tile edge is a literal utility class rather than an inline style, so
    // link it to the world-coordinate geometry that places the tile.
    expect(html).toContain(`size-[${TILE_SIZE}px]`);
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

  it("keeps the chosen zoom when a map click updates the value", async () => {
    const user = userEvent.setup();
    render(<MapWithValue initial={null} />);
    const map = mapWithBounds();
    const zoomOut = () =>
      screen.getByRole<HTMLButtonElement>("button", { name: "Zoom out" });
    // No location starts at the world view, the lowest zoom level.
    expect(zoomOut().disabled).toBe(true);

    await user.click(map);

    // The click is a selection, not a search or saved location: it becomes the
    // marker but must not jump the map to zoom 10.
    expect(zoomOut().disabled).toBe(true);
  });

  it("does not move the view for a recreated value with the same coordinates", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <LocationPickerMap value={OSLO} onSelect={() => undefined} />,
    );
    expect(announcedCentre().latitude).toBeCloseTo(OSLO.latitude, 4);

    await user.tab();
    await user.keyboard("{ArrowRight}");
    const panned = announcedCentre();
    expect(panned.longitude).toBeGreaterThan(OSLO.longitude);

    // A parent re-render hands over a new object for the same saved location.
    rerender(
      <LocationPickerMap value={{ ...OSLO }} onSelect={() => undefined} />,
    );

    expect(announcedCentre().longitude).toBeCloseTo(panned.longitude, 4);
    expect(announcedCentre().latitude).toBeCloseTo(panned.latitude, 4);
  });

  it("recentres on a saved location without changing the chosen zoom", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <LocationPickerMap value={OSLO} onSelect={() => undefined} />,
    );
    const zoomOut = () =>
      screen.getByRole<HTMLButtonElement>("button", { name: "Zoom out" });
    for (let step = 0; step < 8; step += 1) {
      await user.click(zoomOut());
    }
    expect(zoomOut().disabled).toBe(true);

    rerender(
      <LocationPickerMap value={TRONDHEIM} onSelect={() => undefined} />,
    );

    const centre = announcedCentre();
    expect(centre.latitude).toBeCloseTo(TRONDHEIM.latitude, 3);
    expect(centre.longitude).toBeCloseTo(TRONDHEIM.longitude, 3);
    // The athlete's zoom is theirs; recentring must not force it back to 10.
    expect(zoomOut().disabled).toBe(true);
  });
});
