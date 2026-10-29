import { useEffect, useRef, useState } from "react";
import type { AthleteLocation } from "@killingit/shared";
import { Bullet } from "./Bullet";
import {
  mapTiles,
  projectPoint,
  TILE_SIZE,
  unprojectPoint,
  type MapPoint,
} from "./mapProjection";

const WIDTH = 400;
const HEIGHT = 300;
const MIN_ZOOM = 2;
const MAX_ZOOM = 16;

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  center: MapPoint;
  moved: boolean;
}

function clampZoom(zoom: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
}

/**
 * An OpenStreetMap picker rendered with the same dependency-free tile approach
 * as activity previews. A click sets the location, and dragging pans the map.
 */
export function LocationPickerMap({
  value,
  onSelect,
}: {
  value: AthleteLocation | null;
  onSelect: (latitude: number, longitude: number) => void;
}) {
  const [center, setCenter] = useState<MapPoint>(
    value ?? { latitude: 20, longitude: 0 },
  );
  const [zoom, setZoom] = useState(value === null ? 2 : 10);
  const drag = useRef<DragState | null>(null);

  // A search result or a saved location moves the map to that place. Clicking
  // the map also updates the value; recentring there is harmless.
  useEffect(() => {
    if (value !== null) {
      setCenter({ latitude: value.latitude, longitude: value.longitude });
      setZoom((current) => Math.max(current, 10));
    }
  }, [value]);

  const centerWorld = projectPoint(center, zoom);
  const topLeft = {
    x: centerWorld.x - WIDTH / 2,
    y: centerWorld.y - HEIGHT / 2,
  };
  const tiles = mapTiles(topLeft, zoom, WIDTH, HEIGHT);
  const marker = value === null ? null : projectPoint(value, zoom);

  function pointFromEvent(event: React.PointerEvent<SVGSVGElement>): MapPoint {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * WIDTH;
    const y = ((event.clientY - rect.top) / rect.height) * HEIGHT;
    return unprojectPoint({ x: topLeft.x + x, y: topLeft.y + y }, zoom);
  }

  function handlePointerDown(event: React.PointerEvent<SVGSVGElement>) {
    if (event.button !== 0) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      center,
      moved: false,
    };
  }

  function handlePointerMove(event: React.PointerEvent<SVGSVGElement>) {
    const state = drag.current;
    if (state === null || state.pointerId !== event.pointerId) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const dx = ((event.clientX - state.startX) / rect.width) * WIDTH;
    const dy = ((event.clientY - state.startY) / rect.height) * HEIGHT;
    if (Math.abs(dx) + Math.abs(dy) > 3) {
      state.moved = true;
    }
    if (!state.moved) {
      return;
    }
    const startWorld = projectPoint(state.center, zoom);
    setCenter(
      unprojectPoint({ x: startWorld.x - dx, y: startWorld.y - dy }, zoom),
    );
  }

  function handlePointerUp(event: React.PointerEvent<SVGSVGElement>) {
    const state = drag.current;
    drag.current = null;
    if (state === null || state.pointerId !== event.pointerId) {
      return;
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (state.moved) {
      return;
    }
    const point = pointFromEvent(event);
    onSelect(point.latitude, point.longitude);
  }

  return (
    <div className="relative" data-testid="location-map">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="aspect-[4/3] w-full cursor-crosshair touch-none rounded border bg-muted"
        role="img"
        aria-label="Location picker map. Click to set your location."
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        <rect width={WIDTH} height={HEIGHT} className="fill-muted" />
        {tiles.map((tile) => (
          <image
            key={tile.key}
            href={tile.href}
            x={tile.x}
            y={tile.y}
            width={TILE_SIZE}
            height={TILE_SIZE}
            preserveAspectRatio="none"
          />
        ))}
        {marker !== null && (
          <g
            transform={`translate(${marker.x - topLeft.x} ${marker.y - topLeft.y})`}
          >
            <circle
              r="11"
              className="fill-primary/20 stroke-primary"
              strokeWidth="1.5"
            />
            <circle
              r="5"
              className="fill-primary stroke-card"
              strokeWidth="2"
            />
          </g>
        )}
      </svg>

      <div className="absolute top-2 right-2 flex flex-col gap-1">
        <button
          type="button"
          className="flex size-8 items-center justify-center rounded border bg-card text-xl leading-none hover:bg-muted disabled:opacity-50"
          aria-label="Zoom in"
          onClick={() => setZoom((current) => clampZoom(current + 1))}
          disabled={zoom >= MAX_ZOOM}
        >
          +
        </button>
        <button
          type="button"
          className="flex size-8 items-center justify-center rounded border bg-card text-xl leading-none hover:bg-muted disabled:opacity-50"
          aria-label="Zoom out"
          onClick={() => setZoom((current) => clampZoom(current - 1))}
          disabled={zoom <= MIN_ZOOM}
        >
          −
        </button>
      </div>

      <p className="mt-1 px-1 text-xs text-muted-foreground">
        Click or drag the map to choose a point
        <Bullet />
        <a
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noreferrer"
          className="hover:underline"
        >
          © OpenStreetMap contributors
        </a>
      </p>
    </div>
  );
}
