import { describe, expect, it } from "bun:test";
import { greetingSchema, healthSchema } from "./index";

describe("healthSchema", () => {
  it("accepts a valid health payload", () => {
    const parsed = healthSchema.parse({
      status: "ok",
      service: "api",
      version: "0.1.0",
      timestamp: new Date().toISOString(),
    });
    expect(parsed.status).toBe("ok");
  });

  it("rejects an invalid status", () => {
    expect(() => healthSchema.parse({ status: "down" })).toThrow();
  });
});

describe("greetingSchema", () => {
  it("accepts a string message", () => {
    expect(greetingSchema.parse({ message: "hello" }).message).toBe("hello");
  });
});
