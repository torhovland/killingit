/**
 * Picks at most `maxItems` items spread evenly across the list, always keeping
 * the first and last item so a preview still spans the whole record.
 */
export function downsample<T>(items: readonly T[], maxItems: number): T[] {
  if (items.length <= maxItems) {
    return [...items];
  }
  if (maxItems <= 1) {
    return items[0] === undefined ? [] : [items[0]];
  }

  const step = (items.length - 1) / (maxItems - 1);
  const picked: T[] = [];
  for (let i = 0; i < maxItems; i++) {
    const item = items[Math.round(i * step)];
    if (item !== undefined) {
      picked.push(item);
    }
  }
  return picked;
}
