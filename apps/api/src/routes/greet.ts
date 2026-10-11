import { greetingSchema } from "@killingit/shared";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";

const bodySchema = greetingSchema.partial().extend({
  name: greetingSchema.shape.message.optional().default("world"),
});

export const greet = new Hono().get(
  "/",
  zValidator("query", bodySchema),
  (c) => {
    const { name } = c.req.valid("query");
    return c.json({ message: `Hello, ${name}!` });
  },
);