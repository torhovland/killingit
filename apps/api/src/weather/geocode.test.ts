import { describe, expect, it } from "bun:test";
import { parseGeocodeResponse, searchLocations } from "./geocode.js";

function toUrl(input: string | URL | Request): URL {
  if (input instanceof URL) {
    return input;
  }
  return typeof input === "string" ? new URL(input) : new URL(input.url);
}

describe("geocoding", () => {
  it("parses a street address into a readable suggestion", () => {
    expect(
      parseGeocodeResponse([
        {
          name: "",
          lat: "63.3906332",
          lon: "10.3553134",
          address: {
            house_number: "10",
            road: "Sigrid Undsets veg",
            city: "Trondheim",
            county: "Trøndelag",
            country: "Norway",
          },
        },
        {
          name: "Oslo",
          lat: "59.9133301",
          lon: "10.7389701",
          address: { county: "Oslo", country: "Norway" },
        },
        { name: "Broken", lat: "200", lon: "10" },
        null,
      ]),
    ).toEqual([
      {
        name: "Sigrid Undsets veg 10",
        latitude: 63.3906332,
        longitude: 10.3553134,
        country: "Norway",
        admin1: "Trøndelag",
        city: "Trondheim",
      },
      {
        name: "Oslo",
        latitude: 59.9133301,
        longitude: 10.7389701,
        country: "Norway",
        admin1: "Oslo",
        city: null,
      },
    ]);
  });

  it("returns an empty list when the service finds nothing", () => {
    expect(parseGeocodeResponse([])).toEqual([]);
    expect(parseGeocodeResponse({})).toEqual([]);
  });

  it("requests Nominatim with the query and an identifying user agent", async () => {
    let requestedUrl = "";
    let userAgent = "";
    const results = await searchLocations(
      "Sigrid Undsets veg",
      (input, init) => {
        requestedUrl = toUrl(input).toString();
        userAgent = new Headers(init?.headers).get("user-agent") ?? "";
        return Promise.resolve(
          new Response(
            JSON.stringify([
              {
                name: "Sigrid Undsets veg",
                lat: "63.3906332",
                lon: "10.3553134",
                address: { city: "Trondheim", country: "Norway" },
              },
            ]),
            { status: 200 },
          ),
        );
      },
    );

    expect(results[0]?.name).toBe("Sigrid Undsets veg");
    expect(requestedUrl).toContain("nominatim.openstreetmap.org/search");
    expect(requestedUrl).toContain("q=Sigrid+Undsets+veg");
    expect(requestedUrl).toContain("addressdetails=1");
    expect(userAgent).toContain("killingit");
  });

  it("rejects a non-success response", () =>
    expect(
      searchLocations("Bergen", () =>
        Promise.resolve(new Response("nope", { status: 502 })),
      ),
    ).rejects.toThrow("502"));
});
