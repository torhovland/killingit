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
 * The opening of an assignment the literal on the next line initialises, so a
 * wrapped export such as `RETURN_JSON_FROM_SYSTEM_PROMPT` keeps its name.
 */
const ASSIGNMENT = /(?:export )?const ([A-Z][A-Z0-9_]*) =\s*$/;

/**
 * Resolves the escapes a quoted literal carries, so the fragment matches the
 * text a prompt receives and the module source that composes it.
 */
function unescapeLiteral(text: string): string {
  return text.replace(/\\(["'\\])/g, "$1");
}

/**
 * The string literals `promptRules.ts` defines. A fragment the module uses only
 * itself is not exported, so a composition test cannot refer to it by identity;
 * reading the literal out of the module's source keeps the assertion honest
 * without pinning the wording.
 *
 * The scan matches comments ahead of literals, so a prose mention inside a
 * comment is skipped. It reads every quote style the module uses, not only
 * template literals: a fragment written as a plain string, such as the closing
 * JSON instruction, is just as reusable as a template one, and guarding only
 * templates let a copy of that instruction survive in a prompt module.
 */
function sourceLiterals(): SourceLiteral[] {
  const source = readFileSync(PROMPT_RULES_PATH, "utf8");
  const pattern =
    /\/\/[^\n]*|\/\*[\s\S]*?\*\/|`([^`]*)`|"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'/g;
  const literals: SourceLiteral[] = [];
  for (
    let match = pattern.exec(source);
    match !== null;
    match = pattern.exec(source)
  ) {
    const text = match[1] ?? match[2] ?? match[3];
    if (text === undefined) {
      // The token is a comment rather than a literal.
      continue;
    }
    const assignment = ASSIGNMENT.exec(source.slice(0, match.index));
    literals.push({
      name: assignment?.[1] ?? null,
      text: unescapeLiteral(text),
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
