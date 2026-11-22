import { describe, expect, it } from "bun:test";
import { parseCliArgs } from "./cli.js";

describe("cli arguments", () => {
  it("defaults to both scenarios and no limit", () => {
    expect(parseCliArgs([])).toEqual({
      scenarios: ["full", "reduced"],
      weekLimit: undefined,
      reportOnly: false,
      resume: false,
      suffix: "",
      help: false,
    });
  });

  it("parses a single scenario, a week limit and a suffix", () => {
    expect(
      parseCliArgs([
        "--scenario",
        "reduced",
        "--weeks",
        "3",
        "--resume",
        "--suffix",
        "-smoke",
      ]),
    ).toMatchObject({
      scenarios: ["reduced"],
      weekLimit: 3,
      resume: true,
      suffix: "-smoke",
    });
  });

  it("rejects an unknown scenario and a bad week limit", () => {
    expect(() => parseCliArgs(["--scenario", "nope"])).toThrow();
    expect(() => parseCliArgs(["--weeks", "0"])).toThrow();
    expect(() => parseCliArgs(["--unknown"])).toThrow();
  });
});
