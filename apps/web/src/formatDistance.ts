/**
 * An activity's distance in kilometres. A detail line keeps two decimals; the
 * calendar's compact chip asks for one so it fits a narrow month cell.
 */
export function formatDistanceKm(meters: number, fractionDigits = 2): string {
  return `${(meters / 1000).toFixed(fractionDigits)} km`;
}
