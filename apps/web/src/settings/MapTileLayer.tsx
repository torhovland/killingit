import type { WorldPoint } from "../mapProjection";
import { cn } from "../components/cn";
import type { MapLayer } from "./mapView";

/**
 * One of the map's two tile slots. The current slot is on top; after a zoom the
 * previous layer stays in the other slot underneath until the next zoom, so the
 * map does not blank while a new zoom level loads.
 */
export function MapTileLayer({
  layer,
  zoom,
  topLeft,
  current,
}: {
  layer: MapLayer;
  zoom: number;
  topLeft: WorldPoint;
  current: boolean;
}) {
  const scale = 2 ** (zoom - layer.zoom);
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-0 origin-top-left",
        current ? "z-[2]" : "z-[1]",
      )}
      // Pan and zoom translate and scale the whole layer, so its transform is
      // only known to the runtime viewport.
      style={{
        transform: `translate3d(${Math.round(-topLeft.x)}px, ${Math.round(-topLeft.y)}px, 0) scale(${scale})`,
      }}
    >
      {layer.tiles.map((tile) => (
        <img
          key={tile.key}
          src={tile.href}
          alt=""
          draggable={false}
          referrerPolicy="origin"
          className="absolute size-[256px] max-w-none select-none"
          // Every tile keeps its fixed TILE_SIZE square from the class above;
          // only its world position moves with a pan.
          style={{
            left: tile.x,
            top: tile.y,
          }}
        />
      ))}
    </div>
  );
}
