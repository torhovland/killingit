import type { WorldPoint } from "../mapProjection";

/** The marker on the selected point, positioned over the tile layer. */
export function MapMarker({
  point,
  topLeft,
}: {
  point: WorldPoint;
  topLeft: WorldPoint;
}) {
  return (
    <div
      className="pointer-events-none absolute z-10 size-[22px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary bg-primary/20"
      // The marker sits on the projection of the selected point, which moves
      // with every pan and zoom.
      style={{
        left: point.x - topLeft.x,
        top: point.y - topLeft.y,
      }}
    >
      <div className="absolute inset-[5px] rounded-full border-2 border-card bg-primary" />
    </div>
  );
}
