import { describe, expect, it } from "bun:test";
import {
  mapTiles,
  projectPoint,
  TILE_SIZE,
  unprojectPoint,
  zoomToward,
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

describe("zoomToward", () => {
  it("keeps the point under the pointer fixed while zooming", () => {
    const center = { latitude: 59.91, longitude: 10.75 };
    const size = { width: 640, height: 480 };
    const pointer = { x: 500, y: 120 };
    const zoom = 10;
    const nextZoom = 12;

    const beforeCenter = projectPoint(center, zoom);
    const beforeTopLeft = {
      x: beforeCenter.x - size.width / 2,
      y: beforeCenter.y - size.height / 2,
    };
    const before = unprojectPoint(
      { x: beforeTopLeft.x + pointer.x, y: beforeTopLeft.y + pointer.y },
      zoom,
    );

    const nextCenter = zoomToward(center, zoom, nextZoom, pointer, size);
    const nextCenterWorld = projectPoint(nextCenter, nextZoom);
    const nextTopLeft = {
      x: nextCenterWorld.x - size.width / 2,
      y: nextCenterWorld.y - size.height / 2,
    };
    const after = unprojectPoint(
      { x: nextTopLeft.x + pointer.x, y: nextTopLeft.y + pointer.y },
      nextZoom,
    );

    expect(after.latitude).toBeCloseTo(before.latitude, 6);
    expect(after.longitude).toBeCloseTo(before.longitude, 6);
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
