import type { RoutePoint } from "@killingit/shared";
import { mapTiles, projectPoint, TILE_SIZE } from "./mapProjection";

const WIDTH = 300;
const HEIGHT = 300;
const PADDING = 16;
const MAX_ZOOM = 16;
const MIN_ZOOM = 1;

/** Picks the highest zoom where the route fits inside the map. */
function chooseZoom(route: readonly RoutePoint[]): number {
  const maxWidth = WIDTH - PADDING * 2;
  const maxHeight = HEIGHT - PADDING * 2;
  for (let zoom = MAX_ZOOM; zoom >= MIN_ZOOM; zoom -= 1) {
    const points = route.map((point) => projectPoint(point, zoom));
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const spanX = Math.max(...xs) - Math.min(...xs);
    const spanY = Math.max(...ys) - Math.min(...ys);
    if (spanX <= maxWidth && spanY <= maxHeight) {
      return zoom;
    }
  }
  return MIN_ZOOM;
}

/**
 * A compact activity route on an OpenStreetMap background. Tiles are rendered
 * directly as SVG images so the preview stays dependency-free; a failed tile
 * request simply leaves the muted background visible.
 */
export function ActivityMap({ route }: { route: readonly RoutePoint[] }) {
  const zoom = chooseZoom(route);
  const world = route.map((point) => projectPoint(point, zoom));
  const xs = world.map((point) => point.x);
  const ys = world.map((point) => point.y);
  const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const centerY = (Math.min(...ys) + Math.max(...ys)) / 2;
  const topLeft = {
    x: centerX - WIDTH / 2,
    y: centerY - HEIGHT / 2,
  };
  const tiles = mapTiles(topLeft, zoom, WIDTH, HEIGHT);
  const points = world.map((point) => ({
    x: point.x - topLeft.x,
    y: point.y - topLeft.y,
  }));
  const path = points
    .map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`)
    .join(" ");
  const start = points[0];
  const end = points.at(-1);

  return (
    <figure
      className="flex flex-col gap-1 rounded border bg-muted p-1"
      data-testid="activity-map"
    >
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="aspect-square w-full rounded"
        role="img"
        aria-label="Activity route map"
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
        <polyline
          points={path}
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinejoin="round"
          strokeLinecap="round"
          className="text-background"
        />
        {start && (
          <circle
            cx={start.x}
            cy={start.y}
            r="4"
            className="fill-success stroke-card"
            strokeWidth="1.5"
          />
        )}
        {end && (
          <circle
            cx={end.x}
            cy={end.y}
            r="4"
            className="fill-accent stroke-card"
            strokeWidth="1.5"
          />
        )}
      </svg>
      <figcaption className="px-1 text-xs text-muted-foreground">
        <a
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noreferrer"
          className="hover:underline"
        >
          © OpenStreetMap contributors
        </a>
      </figcaption>
    </figure>
  );
}
