export const TILE_SIZE = 256;

export interface MapPoint {
  latitude: number;
  longitude: number;
}

export interface WorldPoint {
  x: number;
  y: number;
}

export interface MapTile {
  key: string;
  href: string;
  x: number;
  y: number;
}

const MAX_LATITUDE = 85.05112878;

/** Web Mercator world pixel coordinates at a given zoom level. */
export function projectPoint(point: MapPoint, zoom: number): WorldPoint {
  const scale = TILE_SIZE * 2 ** zoom;
  const latitude = Math.max(
    Math.min(point.latitude, MAX_LATITUDE),
    -MAX_LATITUDE,
  );
  const sinLatitude = Math.sin((latitude * Math.PI) / 180);
  return {
    x: ((point.longitude + 180) / 360) * scale,
    y:
      (0.5 - Math.log((1 + sinLatitude) / (1 - sinLatitude)) / (4 * Math.PI)) *
      scale,
  };
}

/** Converts world pixel coordinates back to a latitude/longitude. */
export function unprojectPoint(point: WorldPoint, zoom: number): MapPoint {
  const scale = TILE_SIZE * 2 ** zoom;
  const longitude = (point.x / scale) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * point.y) / scale;
  const latitude = (180 / Math.PI) * Math.atan(Math.sinh(n));
  return {
    latitude: Math.max(Math.min(latitude, MAX_LATITUDE), -MAX_LATITUDE),
    longitude,
  };
}

/**
 * The OpenStreetMap tiles that cover a viewport whose top-left corner is at
 * `topLeft`. X wraps around the antimeridian; rows outside the world are
 * skipped.
 */
export function mapTiles(
  topLeft: WorldPoint,
  zoom: number,
  width: number,
  height: number,
): MapTile[] {
  const tileCount = 2 ** zoom;
  const firstX = Math.floor(topLeft.x / TILE_SIZE);
  const lastX = Math.floor((topLeft.x + width) / TILE_SIZE);
  const firstY = Math.floor(topLeft.y / TILE_SIZE);
  const lastY = Math.floor((topLeft.y + height) / TILE_SIZE);
  const tiles: MapTile[] = [];

  for (let y = firstY; y <= lastY; y += 1) {
    if (y < 0 || y >= tileCount) {
      continue;
    }
    for (let x = firstX; x <= lastX; x += 1) {
      const wrappedX = ((x % tileCount) + tileCount) % tileCount;
      tiles.push({
        key: `${zoom}/${x}/${y}`,
        href: `https://tile.openstreetmap.org/${zoom}/${wrappedX}/${y}.png`,
        x: x * TILE_SIZE - topLeft.x,
        y: y * TILE_SIZE - topLeft.y,
      });
    }
  }
  return tiles;
}
