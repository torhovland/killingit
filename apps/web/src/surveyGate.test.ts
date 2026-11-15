import { describe, expect, it } from "bun:test";
import { PAGES } from "./navigation";
import { surveyGate } from "./surveyGate";

describe("survey gate", () => {
  it("never blocks a page once the survey is complete", () => {
    for (const page of PAGES) {
      for (const isAdmin of [false, true]) {
        for (const rolePending of [false, true]) {
          expect(
            surveyGate({
              page,
              surveyRequired: false,
              isAdmin,
              rolePending,
            }),
          ).toBe("page");
        }
      }
    }
  });

  it("sends an athlete with an unanswered question to the survey", () => {
    for (const page of PAGES.filter((entry) => entry !== "admin")) {
      expect(
        surveyGate({
          page,
          surveyRequired: true,
          isAdmin: false,
          rolePending: false,
        }),
      ).toBe("survey");
    }
  });

  it("keeps the admin settings page open for the admin", () => {
    expect(
      surveyGate({
        page: "admin",
        surveyRequired: true,
        isAdmin: true,
        rolePending: false,
      }),
    ).toBe("page");
  });

  it("waits for the role before letting a member's admin page through", () => {
    expect(
      surveyGate({
        page: "admin",
        surveyRequired: true,
        isAdmin: false,
        rolePending: true,
      }),
    ).toBe("wait");
    expect(
      surveyGate({
        page: "admin",
        surveyRequired: true,
        isAdmin: false,
        rolePending: false,
      }),
    ).toBe("survey");
  });
});
