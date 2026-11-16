import { describe, expect, it } from "bun:test";
import type { WeatherIcon } from "@killingit/shared";
import { moreSevereIcon } from "./icons.js";

/** The icons in increasing severity, used to check every pair. */
const SEVERITY_ORDER: readonly WeatherIcon[] = [
  "sun",
  "partly_cloudy",
  "very_cloudy",
  "rain",
  "snow",
];

describe("moreSevereIcon", () => {
  it("orders sun, cloud, rain, and snow by severity", () => {
    for (const [index, lessSevere] of SEVERITY_ORDER.entries()) {
      for (const moreSevere of SEVERITY_ORDER.slice(index + 1)) {
        expect(moreSevereIcon(lessSevere, moreSevere)).toBe(moreSevere);
        expect(moreSevereIcon(moreSevere, lessSevere)).toBe(moreSevere);
      }
    }
  });

  it("keeps the first icon on a tie", () => {
    for (const icon of SEVERITY_ORDER) {
      expect(moreSevereIcon(icon, icon)).toBe(icon);
    }
  });
});
