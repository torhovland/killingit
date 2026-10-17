import type { AthleteIdentity } from "@killingit/shared";
import { Hono } from "hono";
import { getAthlete } from "../auth/middleware.js";

/** Minimal canary route: returns the authenticated athlete's identity. */
export const meRoute = new Hono().get("/", (c) => {
  const identity: AthleteIdentity = getAthlete(c);
  return c.json(identity);
});
