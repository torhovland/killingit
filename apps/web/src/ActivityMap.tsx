import type { RoutePoint } from "@killingit/shared";

const WIDTH = 300;
const HEIGHT = 300;
const PADDING = 18;
const TILE_SIZE = 256;
const MAX_ZOOM = 16;
const MIN_ZOOM = 1;

interface WorldPoint {
  x: number;
  y: number;
}

interface MapTile {
  key: string;
  href: string;
  x: number;
  y: number;
}

/** Web Mercator world pixel coordinates at a given zoom level. */
function worldPoint(point: RoutePoint, zoom: number): WorldPoint {
  const scale = TILE_SIZE * 2 ** zoom;
  const latitude = Math.max(
    Math.min(point.latitude, 85.05112878),
    -85.05112878,
  );
  const sinLatitude = Math.sin((latitude * Math.PI) / 180);
  return {
    x: ((point.longitude + 180) / 360) * scale,
    y:
      (0.5 - Math.log((1 + sinLatitude) / (1 - sinLatitude)) / (4 * Math.PI)) *
      scale,
  };
}

/** Picks the highest zoom where the route fits inside the map. */
function chooseZoom(route: readonly RoutePoint[]): number {
  const maxWidth = WIDTH - PADDING * 2;
  const maxHeight = HEIGHT - PADDING * 2;
  for (let zoom = MAX_ZOOM; zoom >= MIN_ZOOM; zoom -= 1) {
    const points = route.map((point) => worldPoint(point, zoom));
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

function mapTiles(topLeft: WorldPoint, zoom: number): MapTile[] {
  const tileCount = 2 ** zoom;
  const firstX = Math.floor(topLeft.x / TILE_SIZE);
  const lastX = Math.floor((topLeft.x + WIDTH) / TILE_SIZE);
  const firstY = Math.floor(topLeft.y / TILE_SIZE);
  const lastY = Math.floor((topLeft.y + HEIGHT) / TILE_SIZE);
  const tiles: MapTile[] = [];

  for (let y = firstY; y <= lastY; y += 1) {
    if (y < 0 || y >= tileCount) {
      continue;
    }
    for (let x = firstX; x <= lastX; x += 1) {
      const wrappedX = ((x % tileCount) + tileCount) % tileCount;
      tiles.push({
        key: `${zoom}/${x}/${y}`,
        href: `https://tile.openstreetmap.org/${zoom}/${wrappedX}/${y}.png`,
        x: x * TILE_SIZE - topLeft.x,
        y: y * TILE_SIZE - topLeft.y,
      });
    }
  }
  return tiles;
}

/**
 * A compact activity route on an OpenStreetMap background. Tiles are rendered
 * directly as SVG images so the preview stays dependency-free; a failed tile
 * request simply leaves the muted background visible.
 */
export function ActivityMap({ route }: { route: readonly RoutePoint[] }) {
  const zoom = chooseZoom(route);
  const world = route.map((point) => worldPoint(point, zoom));
  const xs = world.map((point) => point.x);
  const ys = world.map((point) => point.y);
  const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const centerY = (Math.min(...ys) + Math.max(...ys)) / 2;
  const topLeft = {
    x: centerX - WIDTH / 2,
    y: centerY - HEIGHT / 2,
  };
  const tiles = mapTiles(topLeft, zoom);
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
      <figcaption className="px-1 text-[10px] text-muted-foreground">
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
