import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";

/**
 * The benchmark stores every run and report input as JSON. Reads go through a
 * Zod schema, so a corrupt file or a renamed field fails with the file name
 * instead of reaching a report as an unchecked cast. See
 * `docs/specs/llm-benchmark.md`.
 */

/** Reads one JSON file and validates it against `schema`. */
export async function readJsonFile<T>(
  path: string,
  schema: z.ZodType<T>,
): Promise<T> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (cause) {
    throw new Error(`could not read ${path}`, { cause });
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (cause) {
    throw new Error(`${path} is not valid JSON`, { cause });
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `${path} does not match the expected file shape: ${formatIssues(parsed.error)}`,
    );
  }
  return parsed.data;
}

/** Reads one JSON file, returning the fallback when it is absent or invalid. */
export async function readJsonFileOr<T>(
  path: string,
  schema: z.ZodType<T>,
  fallback: T,
): Promise<T> {
  try {
    return await readJsonFile(path, schema);
  } catch {
    return fallback;
  }
}

/**
 * Reads an array file and keeps only the entries that match `schema`. The stages
 * use this to reuse stored work while ignoring an entry written for another
 * prompt shape, such as a superseded format or a partially written model.
 */
export async function readJsonEntries<T>(
  path: string,
  schema: z.ZodType<T>,
): Promise<T[]> {
  const entries = await readJsonFileOr(path, z.array(z.unknown()), []);
  return entries.flatMap((entry) => {
    const parsed = schema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
}

/** Writes one JSON file with the two-space indentation the runs are stored in. */
export async function writeJsonFile(
  path: string,
  value: unknown,
): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

/** Summarizes the first few validation problems without dumping the file. */
function formatIssues(error: z.ZodError, limit = 5): string {
  const problems = error.issues.slice(0, limit).map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "value";
    return `${path}: ${issue.message}`;
  });
  const remaining = error.issues.length - problems.length;
  return remaining > 0
    ? `${problems.join("; ")}; and ${remaining} more`
    : problems.join("; ");
}
