import { describe, expect, it } from "bun:test";
import { extractFtpWatts, firstFtpInText } from "./ftp.js";

describe("extractFtpWatts", () => {
  it("reads the first stated FTP from the answers", () => {
    expect(
      extractFtpWatts([
        { answer: "I ride a lot but have no numbers yet." },
        { answer: "My current FTP is around 220 W, roughly 280 W when fit." },
      ]),
    ).toBe(220);
  });

  it("supports the common phrasings", () => {
    expect(firstFtpInText("FTP: 250")).toBe(250);
    expect(firstFtpInText("FTP around 280W.")).toBe(280);
    expect(firstFtpInText("Threshold is 280 W FTP.")).toBe(280);
    expect(firstFtpInText("ftp of 190 watts")).toBe(190);
  });

  it("ignores numbers without an FTP label and implausible values", () => {
    expect(firstFtpInText("I ran 10 km in 45 minutes.")).toBeNull();
    expect(firstFtpInText("FTP 5000 W")).toBeNull();
    expect(firstFtpInText("FTP 4.5 W/kg")).toBeNull();
  });

  it("returns null when the athlete skipped every answer", () => {
    expect(extractFtpWatts([{ answer: null }, { answer: "   " }])).toBeNull();
  });
});
