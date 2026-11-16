import { describe, expect, it } from "bun:test";
import { projectPoint, TILE_SIZE } from "../mapProjection";
import { clampZoom, layerForView, MAX_ZOOM, MIN_ZOOM } from "./mapView";

const CENTER = { latitude: 59.91, longitude: 10.75 };
const SIZE = { width: 400, height: 300 };

describe("mapView", () => {
  it("clamps the zoom to the picker's limits", () => {
    expect(clampZoom(MIN_ZOOM - 1)).toBe(MIN_ZOOM);
    expect(clampZoom(MAX_ZOOM + 1)).toBe(MAX_ZOOM);
    expect(clampZoom(7)).toBe(7);
  });

  it("covers the viewport and one tile of margin at the layer's zoom", () => {
    const zoom = 5;
    const layer = layerForView(CENTER, zoom, SIZE);
    const centerWorld = projectPoint(CENTER, zoom);
    const topLeft = {
      x: centerWorld.x - SIZE.width / 2,
      y: centerWorld.y - SIZE.height / 2,
    };
    const tiles = layer.tiles;
    const left = Math.min(...tiles.map((tile) => tile.x));
    const top = Math.min(...tiles.map((tile) => tile.y));
    const right = Math.max(...tiles.map((tile) => tile.x + TILE_SIZE));
    const bottom = Math.max(...tiles.map((tile) => tile.y + TILE_SIZE));

    expect(layer.zoom).toBe(zoom);
    expect(tiles.length).toBeGreaterThan(0);
    // Tiles sit at their absolute world position, and the buffered layer covers
    // the viewport plus one tile on every side.
    expect(left).toBeLessThanOrEqual(topLeft.x - TILE_SIZE);
    expect(top).toBeLessThanOrEqual(topLeft.y - TILE_SIZE);
    expect(right).toBeGreaterThanOrEqual(topLeft.x + SIZE.width + TILE_SIZE);
    expect(bottom).toBeGreaterThanOrEqual(topLeft.y + SIZE.height + TILE_SIZE);
    expect(tiles[0]?.href).toContain(`/${zoom}/`);
  });
});
