import { healthSchema } from "@killingit/shared";
import { Hono } from "hono";

export const health = new Hono().get("/", (c) => {
  const payload = healthSchema.parse({
    status: "ok",
    service: "killingit-api",
    version: "0.1.0",
    timestamp: new Date().toISOString(),
  });
  return c.json(payload);
});
