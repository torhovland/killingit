import { describe, expect, it } from "bun:test";
import {
  mapTiles,
  projectPoint,
  TILE_SIZE,
  unprojectPoint,
} from "./mapProjection";

describe("map projection", () => {
  it("round-trips a latitude and longitude at a zoom level", () => {
    for (const point of [
      { latitude: 59.91, longitude: 10.75 },
      { latitude: -33.86, longitude: 151.21 },
      { latitude: 0, longitude: 0 },
    ]) {
      const roundTripped = unprojectPoint(projectPoint(point, 12), 12);
      expect(roundTripped.latitude).toBeCloseTo(point.latitude, 6);
      expect(roundTripped.longitude).toBeCloseTo(point.longitude, 6);
    }
  });

  it("clamps latitudes outside the Web Mercator range", () => {
    const point = projectPoint({ latitude: 89, longitude: 0 }, 4);
    const roundTripped = unprojectPoint(point, 4);
    expect(roundTripped.latitude).toBeLessThanOrEqual(85.051129);
  });
});

describe("mapTiles", () => {
  it("covers the viewport with 256 px tiles", () => {
    const world = projectPoint({ latitude: 59.91, longitude: 10.75 }, 10);
    const topLeft = {
      x: world.x - 200,
      y: world.y - 150,
    };
    const tiles = mapTiles(topLeft, 10, 400, 300);

    expect(tiles.length).toBeGreaterThan(0);
    for (const tile of tiles) {
      expect(tile.href).toContain(`/10/`);
      expect(tile.x).toBeLessThanOrEqual(400);
      expect(tile.y).toBeLessThanOrEqual(300);
      expect(tile.x).toBeGreaterThanOrEqual(-TILE_SIZE);
      expect(tile.y).toBeGreaterThanOrEqual(-TILE_SIZE);
    }
  });
});
