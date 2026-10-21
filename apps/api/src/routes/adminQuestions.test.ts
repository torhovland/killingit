import { describe, expect, it } from "bun:test";
import app from "../index";

describe("admin questions route", () => {
  it("requires a bearer token to list questions", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/admin/questions"),
    );

    expect(res.status).toBe(401);
  });

  it("requires a bearer token to create a question", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/admin/questions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "How did it go?" }),
      }),
    );

    expect(res.status).toBe(401);
  });
});
