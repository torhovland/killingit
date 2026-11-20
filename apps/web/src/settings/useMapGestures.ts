import {
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import {
  projectPoint,
  unprojectPoint,
  zoomToward,
  type MapPoint,
} from "../mapProjection";
import { clampZoom, type MapSize, type MapViewport } from "./mapView";

const WHEEL_ZOOM_THRESHOLD = 50;
// A trackpad can emit wheel events at screen refresh rate. Limit a burst to a
// controlled number of discrete zoom steps instead of swapping tile layers
// dozens of times in one gesture.
const WHEEL_ZOOM_COOLDOWN_MS = 250;
// One arrow-key press pans by a fixed number of screen pixels, so the step
// feels the same at every zoom level while it covers less ground as the map
// zooms in.
const PAN_STEP_PIXELS = 40;

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  center: MapPoint;
  moved: boolean;
}

export interface MapGestureHandlers {
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerCancel: () => void;
}

/** Wheel zoom on the map element, non-passive so the page does not scroll. */
function useWheelZoom({
  mapRef,
  viewport,
  changeView,
}: {
  mapRef: RefObject<HTMLDivElement | null>;
  viewport: RefObject<MapViewport>;
  changeView: (nextCenter: MapPoint, nextZoom: number) => void;
}): void {
  const wheelDelta = useRef(0);
  const lastWheelZoom = useRef(0);

  // Wheel listeners must be non-passive so zooming the map does not scroll the
  // page. React attaches wheel events passively at the root, so use the DOM.
  useEffect(() => {
    const element = mapRef.current;
    if (element === null) {
      return;
    }
    const target = element;
    function handleWheel(event: WheelEvent): void {
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1;
      wheelDelta.current += event.deltaY * unit;
      if (Math.abs(wheelDelta.current) < WHEEL_ZOOM_THRESHOLD) {
        return;
      }
      const now = performance.now();
      if (now - lastWheelZoom.current < WHEEL_ZOOM_COOLDOWN_MS) {
        wheelDelta.current = 0;
        return;
      }
      const direction = wheelDelta.current < 0 ? 1 : -1;
      wheelDelta.current = 0;
      lastWheelZoom.current = now;
      const current = viewport.current;
      const nextZoom = clampZoom(current.zoom + direction);
      if (nextZoom === current.zoom) {
        return;
      }
      const rect = target.getBoundingClientRect();
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
    target.addEventListener("wheel", handleWheel, { passive: false });
    return () => target.removeEventListener("wheel", handleWheel);
  }, [changeView, mapRef, viewport]);
}

/**
 * Keyboard pan, zoom and selection for the `role="application"` map
 * surface. The element owns its keydown listener because `jsx-a11y`
 * classifies `application` as a structural role; see
 * `docs/specs/accessibility-lint.md`.
 */
function useMapKeyboard({
  mapRef,
  viewport,
  changeView,
  selectPoint,
}: {
  mapRef: RefObject<HTMLDivElement | null>;
  viewport: RefObject<MapViewport>;
  changeView: (nextCenter: MapPoint, nextZoom: number) => void;
  selectPoint: (latitude: number, longitude: number) => void;
}): void {
  // The map is a `role="application"` surface, so a keyboard user can drive it
  // without the pointer. React's synthetic key handler is not usable here:
  // `jsx-a11y` classifies `application` as a structural role and would reject
  // it, so the element owns its keydown listener next to the wheel listener
  // above. See `docs/specs/accessibility-lint.md`.
  useEffect(() => {
    const element = mapRef.current;
    if (element === null) {
      return;
    }
    const target = element;
    function handleKeyDown(event: KeyboardEvent): void {
      // The zoom buttons sit inside the map. Their key presses belong to the
      // button, not to the panning surface.
      if (event.target !== target) {
        return;
      }
      const current = viewport.current;
      switch (event.key) {
        case "ArrowUp":
        case "ArrowDown":
        case "ArrowLeft":
        case "ArrowRight": {
          event.preventDefault();
          const centerWorld = projectPoint(current.center, current.zoom);
          const dx =
            event.key === "ArrowLeft"
              ? -PAN_STEP_PIXELS
              : event.key === "ArrowRight"
                ? PAN_STEP_PIXELS
                : 0;
          const dy =
            event.key === "ArrowUp"
              ? -PAN_STEP_PIXELS
              : event.key === "ArrowDown"
                ? PAN_STEP_PIXELS
                : 0;
          changeView(
            unprojectPoint(
              { x: centerWorld.x + dx, y: centerWorld.y + dy },
              current.zoom,
            ),
            current.zoom,
          );
          return;
        }
        case "+":
        case "=":
        case "Add":
          event.preventDefault();
          changeView(current.center, clampZoom(current.zoom + 1));
          return;
        case "-":
        case "_":
        case "Subtract":
          event.preventDefault();
          changeView(current.center, clampZoom(current.zoom - 1));
          return;
        case "Enter":
        case " ":
          event.preventDefault();
          selectPoint(current.center.latitude, current.center.longitude);
          return;
        default:
          return;
      }
    }
    target.addEventListener("keydown", handleKeyDown);
    return () => target.removeEventListener("keydown", handleKeyDown);
  }, [changeView, mapRef, selectPoint, viewport]);
}

/**
 * Pointer pan and click, wheel zoom and keyboard control for the location
 * picker. The wheel and keydown listeners live on the DOM element rather than
 * in JSX so the wheel listener can be non-passive and the `role="application"`
 * surface can own its keys; see `docs/specs/accessibility-lint.md`.
 */
export function useMapGestures({
  mapRef,
  viewport,
  center,
  zoom,
  size,
  changeView,
  panTo,
  selectPoint,
}: {
  mapRef: RefObject<HTMLDivElement | null>;
  viewport: RefObject<MapViewport>;
  center: MapPoint;
  zoom: number;
  size: MapSize;
  changeView: (nextCenter: MapPoint, nextZoom: number) => void;
  panTo: (nextCenter: MapPoint) => void;
  selectPoint: (latitude: number, longitude: number) => void;
}): MapGestureHandlers {
  const drag = useRef<DragState | null>(null);
  const pendingPan = useRef<MapPoint | null>(null);
  const panFrame = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (panFrame.current !== null) {
        cancelAnimationFrame(panFrame.current);
      }
    },
    [],
  );

  useWheelZoom({ mapRef, viewport, changeView });
  useMapKeyboard({ mapRef, viewport, changeView, selectPoint });

  function pointFromEvent(event: ReactPointerEvent<HTMLDivElement>): MapPoint {
    const rect = event.currentTarget.getBoundingClientRect();
    const centerWorld = projectPoint(center, zoom);
    const topLeft = {
      x: centerWorld.x - size.width / 2,
      y: centerWorld.y - size.height / 2,
    };
    const x = ((event.clientX - rect.left) / rect.width) * size.width;
    const y = ((event.clientY - rect.top) / rect.height) * size.height;
    return unprojectPoint({ x: topLeft.x + x, y: topLeft.y + y }, zoom);
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
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

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
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
    pendingPan.current = nextCenter;
    if (panFrame.current === null) {
      panFrame.current = requestAnimationFrame(() => {
        panFrame.current = null;
        const pending = pendingPan.current;
        if (pending !== null) {
          pendingPan.current = null;
          panTo(pending);
        }
      });
    }
  }

  function flushPan(): void {
    if (panFrame.current !== null) {
      cancelAnimationFrame(panFrame.current);
      panFrame.current = null;
    }
    const pending = pendingPan.current;
    if (pending !== null) {
      pendingPan.current = null;
      panTo(pending);
    }
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>): void {
    flushPan();
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
    selectPoint(point.latitude, point.longitude);
  }

  return {
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
    onPointerUp: handlePointerUp,
    onPointerCancel: () => {
      flushPan();
      drag.current = null;
    },
  };
}
