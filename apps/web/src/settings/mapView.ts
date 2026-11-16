import type { AthleteLocation } from "@killingit/shared";
import {
  mapTiles,
  projectPoint,
  TILE_SIZE,
  type MapPoint,
} from "../mapProjection";

export const MIN_ZOOM = 2;
export const MAX_ZOOM = 16;
export const SLOT_NAMES = ["a", "b"] as const;
// Keep a margin of tiles mounted around the viewport so small pans do not
// unmount the edge tiles and leave visible gaps while the next row loads.
const TILE_BUFFER = TILE_SIZE;

export type SlotName = (typeof SLOT_NAMES)[number];

export interface LayerTile {
  key: string;
  href: string;
  x: number;
  y: number;
}

export interface MapLayer {
  zoom: number;
  tiles: LayerTile[];
}

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface MapSize {
  width: number;
  height: number;
}

export interface SlotState {
  current: SlotName;
  fallback: {
    slot: SlotName;
    layer: MapLayer;
  } | null;
}

export interface MapViewport {
  center: MapPoint;
  zoom: number;
  size: MapSize;
}

export function clampZoom(zoom: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
}

export function coordinatesOf(
  value: AthleteLocation | null,
): Coordinates | null {
  return value === null
    ? null
    : { latitude: value.latitude, longitude: value.longitude };
}

export function sameCoordinates(
  left: Coordinates | null,
  right: Coordinates | null,
): boolean {
  if (left === null || right === null) {
    return left === right;
  }
  return left.latitude === right.latitude && left.longitude === right.longitude;
}

/** The tile layer for a view, with every tile at its absolute world position. */
export function layerForView(
  center: MapPoint,
  zoom: number,
  size: MapSize,
): MapLayer {
  const centerWorld = projectPoint(center, zoom);
  const topLeft = {
    x: centerWorld.x - size.width / 2,
    y: centerWorld.y - size.height / 2,
  };
  const tileTopLeft = {
    x: topLeft.x - TILE_BUFFER,
    y: topLeft.y - TILE_BUFFER,
  };
  return {
    zoom,
    tiles: mapTiles(
      tileTopLeft,
      zoom,
      size.width + TILE_BUFFER * 2,
      size.height + TILE_BUFFER * 2,
    ).map((tile) => ({
      key: tile.key,
      href: tile.href,
      x: tile.x + tileTopLeft.x,
      y: tile.y + tileTopLeft.y,
    })),
  };
}
