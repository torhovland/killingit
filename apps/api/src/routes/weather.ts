import { geocodeResponseSchema } from "@killingit/shared";
import { Hono } from "hono";
import type { ResolvedAppDependencies } from "../dependencies.js";
import { badGateway, badRequest } from "../http/errors.js";
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
      return badRequest(c, "A search query is required");
    }
    if (query.length > 100) {
      return badRequest(c, "The search query is too long");
    }
    try {
      const results = await search(query);
      return c.json(geocodeResponseSchema.parse({ results }));
    } catch (err) {
      console.error("[weather] geocoding failed:", err);
      return badGateway(c, "Address search is unavailable right now");
    }
  });
}
