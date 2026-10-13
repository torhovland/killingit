import { Hono } from "hono";
import { db } from "../db/index.js";
import { athletes } from "../db/schema.js";

export const athletesRoute = new Hono()
  .get("/", async (c) => {
    const rows = await db.select().from(athletes);
    return c.json(rows);
  })
  .post("/", async (c) => {
    const body = await c.req.json<{ name: string; email: string }>();
    const [created] = await db
      .insert(athletes)
      .values({ name: body.name, email: body.email })
      .returning();
    return c.json(created, 201);
  });
