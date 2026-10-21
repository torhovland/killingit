import { describe, expect, it } from "bun:test";
import app, { createApp } from "../index";

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

  it("rejects a signed-in non-admin with 403", async () => {
    const nonAdminApp = createApp({
      authProvider: { verify: () => Promise.resolve({ sub: "athlete-2" }) },
      userStore: {
        ensureUser: (sub) =>
          Promise.resolve({
            id: 2,
            sub,
            role: "member",
            createdAt: new Date(0),
          }),
      },
    });

    const res = await nonAdminApp.fetch(
      new Request("http://localhost/api/admin/questions", {
        headers: { authorization: "Bearer anything" },
      }),
    );

    expect(res.status).toBe(403);
  });
});
