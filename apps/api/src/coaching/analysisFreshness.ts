/**
 * A cached analysis is stale once the athlete's comment is newer, because the
 * comment is evidence the analysis must read and any question it asked may now
 * be answered by that comment. The model and prompt version that produced the
 * analysis deliberately do not make it stale: changing either must not re-bill
 * the athlete for an analysis they already have.
 */
export function commentIsNewerThanAnalysis(
  analysis: { generatedAt: Date } | undefined,
  commentUpdatedAt: Date | null | undefined,
): boolean {
  return (
    analysis !== undefined &&
    commentUpdatedAt !== null &&
    commentUpdatedAt !== undefined &&
    commentUpdatedAt > analysis.generatedAt
  );
}
