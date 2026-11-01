import { useCallback, useEffect, useRef, useState } from "react";
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
const SLOT_NAMES = ["a", "b"] as const;

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  center: MapPoint;
  moved: boolean;
}

interface LayerTile {
  key: string;
  href: string;
  x: number;
  y: number;
}

interface MapLayer {
  zoom: number;
  tiles: LayerTile[];
}

interface SlotState {
  current: (typeof SLOT_NAMES)[number];
  fallback: {
    slot: (typeof SLOT_NAMES)[number];
    layer: MapLayer;
  } | null;
}

function clampZoom(zoom: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
}

/** The tile layer for a view, with every tile at its absolute world position. */
function layerForView(
  center: MapPoint,
  zoom: number,
  size: { width: number; height: number },
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

/**
 * An OpenStreetMap picker. A click sets the location, dragging pans the map,
 * and the mouse wheel or trackpad zooms around the pointer. Tiles are plain
 * HTML images in two alternating layers: panning only translates the current
 * layer, and a zoom keeps the previous layer underneath until the next zoom,
 * so tiles never disappear while a new zoom level loads.
 */
export function LocationPickerMap({
  value,
  onSelect,
}: {
  value: AthleteLocation | null;
  onSelect: (latitude: number, longitude: number) => void;
}) {
  const initialCenter = value ?? { latitude: 20, longitude: 0 };
  const initialZoom = value === null ? 2 : 10;
  const [center, setCenter] = useState<MapPoint>(initialCenter);
  const [zoom, setZoom] = useState(initialZoom);
  // Match the overlay to the rendered size so tiles and the marker share one
  // coordinate space.
  const [size, setSize] = useState({
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
  });
  const [slots, setSlots] = useState<SlotState>({
    current: "a",
    fallback: null,
  });
  const drag = useRef<DragState | null>(null);
  const svg = useRef<SVGSVGElement | null>(null);
  const viewport = useRef({ center, zoom, size });
  const slotRef = useRef(slots);
  const wheelDelta = useRef(0);

  useEffect(() => {
    viewport.current = { center, zoom, size };
  }, [center, zoom, size]);

  useEffect(() => {
    slotRef.current = slots;
  }, [slots]);

  const changeView = useCallback(
    (nextCenter: MapPoint, nextZoom: number): void => {
      const current = viewport.current;
      if (nextZoom !== current.zoom) {
        const oldLayer = layerForView(
          current.center,
          current.zoom,
          current.size,
        );
        const oldSlot = slotRef.current.current;
        const nextSlot = oldSlot === "a" ? "b" : "a";
        const nextSlots: SlotState = {
          current: nextSlot,
          fallback: { slot: oldSlot, layer: oldLayer },
        };
        slotRef.current = nextSlots;
        setSlots(nextSlots);
      }
      viewport.current = {
        center: nextCenter,
        zoom: nextZoom,
        size: current.size,
      };
      setCenter(nextCenter);
      setZoom(nextZoom);
    },
    [],
  );

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
      changeView(
        zoomToward(
          current.center,
          current.zoom,
          nextZoom,
          pointer,
          current.size,
        ),
        nextZoom,
      );
    }
    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => element.removeEventListener("wheel", handleWheel);
  }, [changeView]);

  // A search result or a saved location moves the map to that place. Clicking
  // the map also updates the value; recentring there is harmless.
  useEffect(() => {
    if (value !== null) {
      const current = viewport.current;
      changeView(
        { latitude: value.latitude, longitude: value.longitude },
        Math.max(current.zoom, 10),
      );
    }
  }, [value, changeView]);

  function zoomBy(direction: 1 | -1): void {
    const current = viewport.current;
    changeView(current.center, clampZoom(current.zoom + direction));
  }

  const centerWorld = projectPoint(center, zoom);
  const topLeft = {
    x: centerWorld.x - size.width / 2,
    y: centerWorld.y - size.height / 2,
  };
  const marker = value === null ? null : projectPoint(value, zoom);
  const currentLayer = layerForView(center, zoom, size);

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
    const nextCenter = unprojectPoint(
      { x: startWorld.x - dx, y: startWorld.y - dy },
      zoom,
    );
    viewport.current = { ...viewport.current, center: nextCenter };
    setCenter(nextCenter);
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
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded border bg-muted">
        {SLOT_NAMES.map((slotName) => {
          const layer =
            slots.current === slotName
              ? currentLayer
              : slots.fallback?.slot === slotName
                ? slots.fallback.layer
                : null;
          if (layer === null) {
            return null;
          }
          const scale = 2 ** (zoom - layer.zoom);
          return (
            <div
              key={slotName}
              className="pointer-events-none absolute top-0 left-0"
              style={{
                transform: `translate3d(${-topLeft.x}px, ${-topLeft.y}px, 0) scale(${scale})`,
                transformOrigin: "0 0",
                willChange: "transform",
                zIndex: slots.current === slotName ? 2 : 1,
              }}
            >
              {layer.tiles.map((tile) => (
                <img
                  key={tile.key}
                  src={tile.href}
                  alt=""
                  draggable={false}
                  decoding="async"
                  referrerPolicy="origin"
                  className="absolute select-none"
                  style={{
                    left: tile.x,
                    top: tile.y,
                    width: TILE_SIZE,
                    height: TILE_SIZE,
                  }}
                />
              ))}
            </div>
          );
        })}

        <svg
          ref={svg}
          viewBox={`0 0 ${size.width} ${size.height}`}
          className="absolute inset-0 z-10 h-full w-full cursor-crosshair touch-none"
          role="img"
          aria-label="Location picker map. Click to set your location. Scroll to zoom."
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={() => {
            drag.current = null;
          }}
        >
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

        <div className="absolute top-2 right-2 z-20 flex flex-col gap-1">
          <button
            type="button"
            className="flex size-8 items-center justify-center rounded border bg-card text-xl leading-none hover:bg-muted disabled:opacity-50"
            aria-label="Zoom in"
            onClick={() => zoomBy(1)}
            disabled={zoom >= MAX_ZOOM}
          >
            +
          </button>
          <button
            type="button"
            className="flex size-8 items-center justify-center rounded border bg-card text-xl leading-none hover:bg-muted disabled:opacity-50"
            aria-label="Zoom out"
            onClick={() => zoomBy(-1)}
            disabled={zoom <= MIN_ZOOM}
          >
            −
          </button>
        </div>
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
