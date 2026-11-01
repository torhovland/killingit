import { useEffect, useRef, useState } from "react";
import type { AthleteLocation } from "@killingit/shared";
import { Bullet } from "./Bullet";
import {
  mapTiles,
  projectPoint,
  TILE_SIZE,
  unprojectPoint,
  zoomToward,
  type MapPoint,
} from "./mapProjection";

const DEFAULT_WIDTH = 400;
const DEFAULT_HEIGHT = 300;
const MIN_ZOOM = 2;
const MAX_ZOOM = 16;
const WHEEL_ZOOM_THRESHOLD = 50;
// Keep a margin of tiles mounted around the viewport so small pans do not
// unmount the edge tiles and leave visible gaps while the next row loads.
const TILE_BUFFER = TILE_SIZE;

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
 * as activity previews. A click sets the location, dragging pans the map, and
 * the mouse wheel or trackpad zooms around the pointer.
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
  // Match the SVG coordinate space to its rendered size so tiles are drawn at
  // their native 256 px instead of being stretched by the viewBox.
  const [size, setSize] = useState({
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
  });
  const drag = useRef<DragState | null>(null);
  const svg = useRef<SVGSVGElement | null>(null);
  const viewport = useRef({ center, zoom, size });
  const wheelDelta = useRef(0);

  useEffect(() => {
    viewport.current = { center, zoom, size };
  }, [center, zoom, size]);

  useEffect(() => {
    const element = svg.current;
    if (element === null || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => {
      const rect = element.getBoundingClientRect();
      const width = Math.round(rect.width);
      const height = Math.round(rect.height);
      if (width === 0 || height === 0) {
        return;
      }
      setSize((current) =>
        current.width === width && current.height === height
          ? current
          : { width, height },
      );
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Wheel listeners must be non-passive so zooming the map does not scroll the
  // page. React attaches wheel events passively at the root, so use the DOM.
  useEffect(() => {
    const element = svg.current;
    if (element === null) {
      return;
    }
    const map = element;
    function handleWheel(event: WheelEvent): void {
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1;
      wheelDelta.current += event.deltaY * unit;
      if (Math.abs(wheelDelta.current) < WHEEL_ZOOM_THRESHOLD) {
        return;
      }
      const direction = wheelDelta.current < 0 ? 1 : -1;
      wheelDelta.current = 0;
      const current = viewport.current;
      const nextZoom = clampZoom(current.zoom + direction);
      if (nextZoom === current.zoom) {
        return;
      }
      const rect = map.getBoundingClientRect();
      const pointer = {
        x: ((event.clientX - rect.left) / rect.width) * current.size.width,
        y: ((event.clientY - rect.top) / rect.height) * current.size.height,
      };
      const nextCenter = zoomToward(
        current.center,
        current.zoom,
        nextZoom,
        pointer,
        current.size,
      );
      // Update the ref immediately so a burst of wheel events in one frame
      // measures from the zoom we just applied rather than a stale view.
      viewport.current = {
        center: nextCenter,
        zoom: nextZoom,
        size: current.size,
      };
      setZoom(nextZoom);
      setCenter(nextCenter);
    }
    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => element.removeEventListener("wheel", handleWheel);
  }, []);

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
    x: centerWorld.x - size.width / 2,
    y: centerWorld.y - size.height / 2,
  };
  const tileTopLeft = {
    x: topLeft.x - TILE_BUFFER,
    y: topLeft.y - TILE_BUFFER,
  };
  const tiles = mapTiles(
    tileTopLeft,
    zoom,
    size.width + TILE_BUFFER * 2,
    size.height + TILE_BUFFER * 2,
  );
  const marker = value === null ? null : projectPoint(value, zoom);

  function pointFromEvent(event: React.PointerEvent<SVGSVGElement>): MapPoint {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * size.width;
    const y = ((event.clientY - rect.top) / rect.height) * size.height;
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
    const dx = ((event.clientX - state.startX) / rect.width) * size.width;
    const dy = ((event.clientY - state.startY) / rect.height) * size.height;
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
        ref={svg}
        viewBox={`0 0 ${size.width} ${size.height}`}
        className="aspect-[4/3] w-full cursor-crosshair touch-none rounded border bg-muted"
        role="img"
        aria-label="Location picker map. Click to set your location. Scroll to zoom."
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        <rect width={size.width} height={size.height} className="fill-muted" />
        <g transform={`translate(${-topLeft.x} ${-topLeft.y})`}>
          {tiles.map((tile) => (
            <image
              key={tile.key}
              href={tile.href}
              x={tile.x + tileTopLeft.x}
              y={tile.y + tileTopLeft.y}
              width={TILE_SIZE}
              height={TILE_SIZE}
              preserveAspectRatio="none"
            />
          ))}
          {marker !== null && (
            <g transform={`translate(${marker.x} ${marker.y})`}>
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
        </g>
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
        Scroll to zoom
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
