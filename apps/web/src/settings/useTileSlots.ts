import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { AthleteLocation } from "@killingit/shared";
import type { MapPoint } from "../mapProjection";
import {
  clampZoom,
  coordinatesOf,
  layerForView,
  sameCoordinates,
  type Coordinates,
  type MapSize,
  type MapViewport,
  type SlotState,
} from "./mapView";

const DEFAULT_WIDTH = 400;
const DEFAULT_HEIGHT = 300;

export interface TileSlots {
  mapRef: RefObject<HTMLDivElement | null>;
  center: MapPoint;
  zoom: number;
  size: MapSize;
  slots: SlotState;
  viewport: RefObject<MapViewport>;
  changeView: (nextCenter: MapPoint, nextZoom: number) => void;
  panTo: (nextCenter: MapPoint) => void;
  zoomBy: (direction: 1 | -1) => void;
  selectPoint: (latitude: number, longitude: number) => void;
}

/**
 * The map's view: its centre, zoom, rendered size and the two tile slots that
 * cross-fade on a zoom. A search result or a saved location moves the view,
 * while a selection made on the map only updates the value. See
 * `docs/specs/location-and-weather.md`.
 */
export function useTileSlots(
  value: AthleteLocation | null,
  onSelect: (latitude: number, longitude: number) => void,
): TileSlots {
  const initialCenter = value ?? { latitude: 20, longitude: 0 };
  const initialZoom = value === null ? 2 : 10;
  const [center, setCenter] = useState<MapPoint>(initialCenter);
  const [zoom, setZoom] = useState(initialZoom);
  // Match the map coordinates to the rendered size so tiles and the marker
  // share one coordinate space.
  const [size, setSize] = useState({
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
  });
  const [slots, setSlots] = useState<SlotState>({
    current: "a",
    fallback: null,
  });
  const mapRef = useRef<HTMLDivElement | null>(null);
  const viewport = useRef({ center, zoom, size });
  const slotRef = useRef(slots);
  // The last value the component saw and the point it last asked the parent to
  // store. A value that matches either one did not come from an outside source
  // such as a search result or a saved location, so it must not move the view.
  const receivedValue = useRef<Coordinates | null>(coordinatesOf(value));
  const requestedSelection = useRef<Coordinates | null>(null);

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

  const selectPoint = useCallback(
    (latitude: number, longitude: number): void => {
      requestedSelection.current = { latitude, longitude };
      onSelect(latitude, longitude);
    },
    [onSelect],
  );

  useEffect(() => {
    const element = mapRef.current;
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

  // A search result or a saved location moves the map to that place. A map
  // click or Enter also updates the value, and a parent re-render may recreate
  // it: neither came from outside, so do not move the view or change the zoom.
  useEffect(() => {
    const next = coordinatesOf(value);
    const previous = receivedValue.current;
    const requested = requestedSelection.current;
    receivedValue.current = next;
    requestedSelection.current = null;
    if (
      next === null ||
      sameCoordinates(next, previous) ||
      sameCoordinates(next, requested)
    ) {
      return;
    }
    changeView(next, viewport.current.zoom);
  }, [value, changeView]);

  const zoomBy = useCallback(
    (direction: 1 | -1): void => {
      const current = viewport.current;
      changeView(current.center, clampZoom(current.zoom + direction));
    },
    [changeView],
  );

  const panTo = useCallback((nextCenter: MapPoint): void => {
    viewport.current = { ...viewport.current, center: nextCenter };
    setCenter(nextCenter);
  }, []);

  return {
    mapRef,
    center,
    zoom,
    size,
    slots,
    viewport,
    changeView,
    panTo,
    zoomBy,
    selectPoint,
  };
}
