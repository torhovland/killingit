import type { UserRole } from "@killingit/shared";
import { eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { users, type UserRow } from "../db/schema.js";

/** An application account with its authorisation role. */
export interface StoredUser {
  id: number;
  sub: string;
  role: UserRole;
  createdAt: Date;
}

/**
 * Resolves the account behind an auth subject, creating it on first sight.
 * Kept behind an interface so routes and middleware can be tested without a
 * database (ADR 0006).
 */
export interface UserStore {
  ensureUser(sub: string): Promise<StoredUser>;
}

export interface ProvisioningPlan {
  /** Whether the earliest existing account should be promoted to admin. */
  promoteEarliest: boolean;
  /** Role assigned to the account being provisioned. */
  role: UserRole;
}

/**
 * Bootstrap rule for one provisioning pass: the first account in an empty
 * database is the admin; otherwise the new account is a member and, if the
 * database predates roles and has no admin, the earliest account is promoted.
 * Pure so the rule is testable without Postgres.
 */
export function planUserProvisioning(
  existingUserCount: number,
  hasAdmin: boolean,
): ProvisioningPlan {
  if (existingUserCount === 0) {
    return { promoteEarliest: false, role: "admin" };
  }
  return { promoteEarliest: !hasAdmin, role: "member" };
}

/**
 * Arbitrary transaction-scoped advisory lock key that serialises first-user
 * provisioning, so two concurrent first sign-ins cannot both become admin.
 */
const PROVISION_LOCK_KEY = 4_221_001;

function toStoredUser(row: UserRow): StoredUser {
  return {
    id: row.id,
    sub: row.authSubject,
    role: row.role,
    createdAt: row.createdAt,
  };
}

async function findUserBySub(sub: string): Promise<StoredUser | null> {
  const [row] = await db
    .select()
    .from(users)
    .where(eq(users.authSubject, sub))
    .limit(1);
  return row ? toStoredUser(row) : null;
}

/**
 * PostgreSQL-backed account store. `ensureUser` is idempotent: repeated calls
 * for the same subject return the same row.
 *
 * A database that predates roles is repaired on the next provisioning: if any
 * accounts exist but none is an admin, the earliest account is promoted. New
 * environments get their admin from the first account inserted.
 */
export const dbUserStore: UserStore = {
  async ensureUser(sub) {
    const existing = await findUserBySub(sub);
    if (existing) {
      return existing;
    }

    return db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(${PROVISION_LOCK_KEY})`,
      );

      // Another request may have provisioned this subject while we waited.
      const [raced] = await tx
        .select()
        .from(users)
        .where(eq(users.authSubject, sub))
        .limit(1);
      if (raced) {
        return toStoredUser(raced);
      }

      const [earliest] = await tx
        .select({ id: users.id })
        .from(users)
        .orderBy(users.id)
        .limit(1);
      const [admin] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.role, "admin"))
        .limit(1);

      const plan = planUserProvisioning(earliest ? 1 : 0, Boolean(admin));
      if (plan.promoteEarliest && earliest) {
        await tx
          .update(users)
          .set({ role: "admin", updatedAt: new Date() })
          .where(eq(users.id, earliest.id));
      }

      const [created] = await tx
        .insert(users)
        .values({ authSubject: sub, role: plan.role })
        .returning();
      if (!created) {
        throw new Error("failed to create user");
      }
      return toStoredUser(created);
    });
  },
};
