import type { AthleteLocation } from "@killingit/shared";
import { Bullet } from "../Bullet";
import { projectPoint } from "../mapProjection";
import { Button } from "../components/Button";
import { MapMarker } from "./MapMarker";
import { MapTileLayer } from "./MapTileLayer";
import { layerForView, MAX_ZOOM, MIN_ZOOM, SLOT_NAMES } from "./mapView";
import { useMapGestures } from "./useMapGestures";
import { useTileSlots } from "./useTileSlots";

/**
 * An OpenStreetMap picker. A click sets the location, dragging pans the map,
 * and the mouse wheel or trackpad zooms around the pointer. The map is also one
 * keyboard stop: the arrow keys move the centre, `+` and `−` zoom, and Enter or
 * Space choose the centred point, which a polite live region announces. Tiles
 * are plain HTML images in two alternating layers: panning only translates the
 * current layer, and a zoom keeps the previous layer underneath until the next
 * zoom, so tiles never disappear while a new zoom level loads.
 */
export function LocationPickerMap({
  value,
  onSelect,
}: {
  value: AthleteLocation | null;
  onSelect: (latitude: number, longitude: number) => void;
}) {
  const {
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
  } = useTileSlots(value, onSelect);
  const gestures = useMapGestures({
    mapRef,
    viewport,
    center,
    zoom,
    size,
    changeView,
    panTo,
    selectPoint,
  });

  const centerWorld = projectPoint(center, zoom);
  const topLeft = {
    x: centerWorld.x - size.width / 2,
    y: centerWorld.y - size.height / 2,
  };
  const marker = value === null ? null : projectPoint(value, zoom);
  const currentLayer = layerForView(center, zoom, size);

  return (
    <div className="relative" data-testid="location-map">
      <div
        ref={mapRef}
        className="relative isolate aspect-[4/3] w-full touch-none overflow-hidden rounded border bg-muted select-none"
        role="application"
        aria-roledescription="map"
        aria-label="Location picker map. Use the arrow keys to move the centre, plus and minus to zoom, and Enter or Space to choose the centred point. A pointer click or drag also chooses a point."
        tabIndex={0}
        onPointerDown={gestures.onPointerDown}
        onPointerMove={gestures.onPointerMove}
        onPointerUp={gestures.onPointerUp}
        onPointerCancel={gestures.onPointerCancel}
      >
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
          return (
            <MapTileLayer
              key={slotName}
              layer={layer}
              zoom={zoom}
              topLeft={topLeft}
              current={slots.current === slotName}
            />
          );
        })}

        {marker !== null && <MapMarker point={marker} topLeft={topLeft} />}

        <div className="absolute top-2 right-2 z-20 flex flex-col gap-1">
          <Button
            type="button"
            variant="secondary"
            size="icon"
            className="flex size-8 text-xl leading-none"
            aria-label="Zoom in"
            onClick={() => zoomBy(1)}
            disabled={zoom >= MAX_ZOOM}
          >
            +
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="icon"
            className="flex size-8 text-xl leading-none"
            aria-label="Zoom out"
            onClick={() => zoomBy(-1)}
            disabled={zoom <= MIN_ZOOM}
          >
            −
          </Button>
        </div>
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        Map centre: latitude {center.latitude.toFixed(4)}, longitude{" "}
        {center.longitude.toFixed(4)}
      </p>

      <p className="mt-1 px-1 text-xs text-muted-foreground">
        Click, drag, or use the arrow keys to choose a point
        <Bullet />
        Scroll or +/− to zoom
        <Bullet />
        Enter picks the centred point
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
