export interface ChartSeries {
  label: string;
  color: string;
  points: Array<{ label: string; value: number }>;
}

/** Escapes every value interpolated into the report. */
export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** One compact line chart in inline SVG. */
export function lineChart(
  series: ChartSeries[],
  title: string,
  width = 760,
  height = 190,
): string {
  const all = series.flatMap((entry) =>
    entry.points.map((point) => point.value),
  );
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;
  const left = 42;
  const right = 18;
  const top = 16;
  const bottom = 28;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const x = (index: number, count: number) =>
    left + (count <= 1 ? plotWidth / 2 : (index / (count - 1)) * plotWidth);
  const y = (value: number) =>
    top + plotHeight - ((value - min) / span) * plotHeight;
  const lines = series
    .map((entry) => {
      const points = entry.points
        .map(
          (point, index) =>
            `${x(index, entry.points.length).toFixed(1)},${y(point.value).toFixed(1)}`,
        )
        .join(" ");
      return `<polyline fill="none" stroke="${entry.color}" stroke-width="2" points="${points}" />`;
    })
    .join("");
  const labels = series[0]?.points ?? [];
  const ticks = [0, Math.floor(labels.length / 2), labels.length - 1]
    .filter(
      (index, position, array) =>
        index >= 0 && array.indexOf(index) === position,
    )
    .map((index) => {
      const point = labels[index];
      if (point === undefined) return "";
      const anchor =
        index === 0 ? "start" : index === labels.length - 1 ? "end" : "middle";
      return `<text x="${x(index, labels.length).toFixed(1)}" y="${String(height - 8)}" font-size="8" text-anchor="${anchor}" fill="#5d6b64">${escapeHtml(point.label)}</text>`;
    })
    .join("");
  const yLabels = [min, (min + max) / 2, max]
    .map(
      (value) =>
        `<text x="${String(left - 5)}" y="${(y(value) + 3).toFixed(1)}" font-size="8" text-anchor="end" fill="#5d6b64">${value.toFixed(0)}</text>`,
    )
    .join("");
  return `<h3>${escapeHtml(title)}</h3><svg viewBox="0 0 ${String(width)} ${String(height)}" role="img" aria-label="${escapeHtml(title)}"><line x1="${String(left)}" y1="${String(top + plotHeight)}" x2="${String(width - right)}" y2="${String(top + plotHeight)}" stroke="#d8e0db" />${yLabels}${ticks}${lines}</svg>`;
}
