import { describe, expect, it } from "bun:test";
import app from "./index";

describe("api", () => {
  it("responds ok on /api/health", async () => {
    const res = await app.fetch(new Request("http://localhost/api/health"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; service: string };
    expect(body.status).toBe("ok");
    expect(body.service).toBe("killingit-api");
  });

  it("greets on /api/greet", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/greet?name=tor"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe("Hello, tor!");
  });
});