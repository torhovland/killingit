/**
 * The auth subject that is explicitly allowed to administer the environment.
 *
 * Provisioning never grants the admin role implicitly: a new account is a
 * member unless its subject is the one configured here, and an existing member
 * is promoted only when its subject matches. `null` means no administrator is
 * configured, so every account stays a member (ADR 0006).
 */
export function configuredAdminSubject(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const subject = env.ADMIN_AUTH_SUBJECT?.trim();
  return subject === undefined || subject === "" ? null : subject;
}
