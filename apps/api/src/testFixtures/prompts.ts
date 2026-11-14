import { readFileSync } from "node:fs";
import { join } from "node:path";

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

/**
 * A fragment shorter than this is ordinary wording that a prompt may share by
 * coincidence; anything longer is prose `promptRules.ts` owns.
 */
const MIN_SHARED_PROSE_LENGTH = 20;

const PROMPT_RULES_PATH = join(import.meta.dir, "../llm/promptRules.ts");

/** One string literal in `promptRules.ts` and the constant it may assign. */
interface SourceLiteral {
  /** The constant the literal is assigned to, when it is a direct assignment. */
  name: string | null;
  text: string;
}

/**
 * The string literals `promptRules.ts` defines. A fragment the module uses only
 * itself is not exported, so a composition test cannot refer to it by identity;
 * reading the literal out of the module's source keeps the assertion honest
 * without pinning the wording. Mentions inside comments are skipped.
 */
function sourceLiterals(): SourceLiteral[] {
  const source = readFileSync(PROMPT_RULES_PATH, "utf8");
  const literals: SourceLiteral[] = [];
  const pattern = /`([^`]*)`/g;
  for (
    let match = pattern.exec(source);
    match !== null;
    match = pattern.exec(source)
  ) {
    const start = match.index;
    const lineStart = source.lastIndexOf("\n", start) + 1;
    const lineEnd = source.indexOf("\n", start);
    const line = source.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
    if (/^\s*(\*|\/\/|\/\*)/.test(line)) {
      continue;
    }
    const prefix = source.slice(lineStart, start);
    const assignment = /^(?:export )?const ([A-Z][A-Z0-9_]*) =\s*$/.exec(
      prefix,
    );
    literals.push({
      name: assignment?.[1] ?? null,
      text: match[1] ?? "",
    });
  }
  return literals;
}

/** The prompt fragments `promptRules.ts` defines, keyed by constant name. */
function promptRuleLiterals(): ReadonlyMap<string, string> {
  const literals = new Map<string, string>();
  for (const { name, text } of sourceLiterals()) {
    if (name !== null) {
      literals.set(name, text);
    }
  }
  return literals;
}

/** The prompt fragment `promptRules.ts` assigns to `name`. */
export function promptRuleLiteral(name: string): string {
  const literal = promptRuleLiterals().get(name);
  if (literal === undefined) {
    throw new Error(`promptRules.ts does not define ${name}`);
  }
  return literal;
}

/** The prose fragments `promptRules.ts` owns, as a prompt receives them. */
export function promptRulesProse(): string[] {
  return sourceLiterals()
    .map(({ text }) => text)
    .filter((text) => text.trim().length >= MIN_SHARED_PROSE_LENGTH);
}
