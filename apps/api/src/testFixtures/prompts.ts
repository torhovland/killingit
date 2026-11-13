/**
 * The fragments a composite prompt is expected to contain, by identity.
 *
 * Prompt tests assert that a built prompt composes the shared `promptRules.ts`
 * fragment instead of restating the rule's prose, so rewording a rule never
 * fails a test while dropping it from the prompt still does.
 */
export function missingFragments(
  prompt: string,
  fragments: readonly string[],
): string[] {
  return fragments.filter((fragment) => !prompt.includes(fragment));
}
