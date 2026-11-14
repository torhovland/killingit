import { expect } from "bun:test";

/**
 * Asserts that a request failed schema validation: a `400` whose body is the
 * shared error contract with `code: "validation_failed"` and the Zod issues
 * under `details.issues`.
 */
export async function expectValidationFailure(res: Response): Promise<void> {
  expect(res.status).toBe(400);
  const body = (await res.json()) as {
    error: { code: string; details?: { issues?: unknown[] } };
  };
  expect(body.error.code).toBe("validation_failed");
  expect(body.error.details?.issues?.length).toBeGreaterThan(0);
}
