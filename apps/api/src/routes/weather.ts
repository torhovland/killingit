import { geocodeResponseSchema } from "@killingit/shared";
import { Hono } from "hono";
import type { ResolvedAppDependencies } from "../dependencies.js";
import { searchLocations } from "../weather/geocode.js";

/**
 * Address search for the settings location picker. Proxied through the API so
 * the browser talks to one origin and upstream errors stay out of the UI.
 */
export function createWeatherRoute(deps: ResolvedAppDependencies): Hono {
  const search = deps.searchLocations ?? searchLocations;
  return new Hono().get("/geocode", async (c) => {
    const query = (c.req.query("q") ?? "").trim();
    if (query === "") {
      return c.text("A search query is required", 400);
    }
    if (query.length > 100) {
      return c.text("The search query is too long", 400);
    }
    try {
      const results = await search(query);
      return c.json(geocodeResponseSchema.parse({ results }));
    } catch (err) {
      console.error("[weather] geocoding failed:", err);
      return c.text("Address search is unavailable right now", 502);
    }
  });
}
