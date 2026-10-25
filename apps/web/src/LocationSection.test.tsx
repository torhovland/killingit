import { describe, expect, it, mock } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

await mock.module("./auth", () => ({
  useAuth: () => ({
    isAuthenticated: true,
    isLoading: false,
    login: () => Promise.resolve(),
    logout: () => Promise.resolve(),
    getToken: () => Promise.resolve("token"),
  }),
}));

const { LocationSection } = await import("./LocationSection");

describe("LocationSection", () => {
  it("shows the map and address search when no location is set", () => {
    const html = renderToStaticMarkup(
      <LocationSection location={null} onChanged={() => undefined} />,
    );

    expect(html).toContain("Find an address");
    expect(html).toContain("Search");
    expect(html).toContain('data-testid="location-map"');
    expect(html).toContain("No location set");
    expect(html).not.toContain("Clear location");
  });

  it("shows a saved location and offers to clear it", () => {
    const html = renderToStaticMarkup(
      <LocationSection
        location={{ latitude: 59.91, longitude: 10.75, name: "Oslo, Norway" }}
        onChanged={() => undefined}
      />,
    );

    expect(html).toContain("Oslo, Norway");
    expect(html).toContain("59.9100, 10.7500");
    expect(html).toContain("Clear location");
    expect(html).toContain("© OpenStreetMap contributors");
  });
});
