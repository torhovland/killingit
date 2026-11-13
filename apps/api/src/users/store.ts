import type { AthleteLocation, UserRole } from "@killingit/shared";
import { eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { users, type UserRow } from "../db/schema.js";
import { configuredAdminSubject } from "./adminSubject.js";

/** An application account with its authorisation role. */
export interface StoredUser {
  id: number;
  sub: string;
  role: UserRole;
  /** Preferred IANA time zone; null means the device's time zone. */
  timezone: string | null;
  /** Home location for weather forecasts; null means weather is not used. */
  location: AthleteLocation | null;
  /** Whether the athlete wants a food log and diet advice. */
  dietAdvice: boolean;
  createdAt: Date;
}

/** A partial settings update; omitted fields keep their stored value. */
export interface UserSettingsPatch {
  timezone?: string | null;
  location?: AthleteLocation | null;
  dietAdvice?: boolean;
}

/**
 * Resolves the account behind an auth subject, creating it on first sight.
 * Kept behind an interface so routes and middleware can be tested without a
 * database (ADR 0006).
 */
export interface UserStore {
  ensureUser(sub: string): Promise<StoredUser>;
  /** Loads an account by its internal id, or null when it no longer exists. */
  getById(id: number): Promise<StoredUser | null>;
  /** Stores the supplied time zone and/or location; null clears a setting. */
  updateSettings(sub: string, update: UserSettingsPatch): Promise<StoredUser>;
  /**
   * Deletes the account and, through the schema's cascades, every row that
   * belongs to it. Deleting an unknown subject is a no-op.
   */
  deleteUser(sub: string): Promise<void>;
}

export interface ProvisioningPlan {
  /** Role assigned to the account being provisioned. */
  role: UserRole;
}

/**
 * Arbitrary transaction-scoped advisory lock key that serialises first-time
 * provisioning of a subject, so two concurrent first sign-ins cannot both
 * insert the same account.
 */
const PROVISION_LOCK_KEY = 4_221_001;

function toStoredUser(row: UserRow): StoredUser {
  return {
    id: row.id,
    sub: row.authSubject,
    role: row.role,
    timezone: row.timezone,
    location:
      row.latitude !== null && row.longitude !== null
        ? {
            latitude: row.latitude,
            longitude: row.longitude,
            name: row.locationName,
          }
        : null,
    dietAdvice: row.dietAdvice,
    createdAt: row.createdAt,
  };
}

function locationColumns(
  location: AthleteLocation | null,
): Pick<UserRow, "latitude" | "longitude" | "locationName"> {
  return location === null
    ? { latitude: null, longitude: null, locationName: null }
    : {
        latitude: location.latitude,
        longitude: location.longitude,
        locationName: location.name,
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
 * Applies the provisioning plan to an account that already exists. Promotion
 * requires the account's subject to be the configured administrator; an
 * existing member is never promoted merely because the environment has no
 * admin.
 */
async function applyProvisioningPlan(
  user: StoredUser,
  plan: ProvisioningPlan,
): Promise<StoredUser> {
  if (plan.role !== "admin" || user.role === "admin") {
    return user;
  }

  const [promoted] = await db
    .update(users)
    .set({ role: "admin", updatedAt: new Date() })
    .where(eq(users.id, user.id))
    .returning();
  if (!promoted) {
    throw new Error("failed to promote the configured administrator");
  }
  return toStoredUser(promoted);
}

/**
 * PostgreSQL-backed account store. `ensureUser` is idempotent: repeated calls
 * for the same subject return the same row.
 *
 * The admin role is never granted implicitly. A new account is an admin only
 * when its subject matches `ADMIN_AUTH_SUBJECT`; every other account is a
 * member, even in an empty database or when no admin exists. An account already
 * stored as a member is promoted when its subject is configured, which is how
 * the operator grants the role to an account that signed in first.
 */
export const dbUserStore: UserStore = {
  async ensureUser(sub) {
    const plan = planUserProvisioning(sub, configuredAdminSubject());

    const existing = await findUserBySub(sub);
    if (existing) {
      return applyProvisioningPlan(existing, plan);
    }

    const created = await db.transaction(async (tx) => {
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

      const [inserted] = await tx
        .insert(users)
        .values({ authSubject: sub, role: plan.role })
        .returning();
      if (!inserted) {
        throw new Error("failed to create user");
      }
      return toStoredUser(inserted);
    });

    // Covers the race above: the account may have been inserted as a member by
    // another request before this one observed it.
    return applyProvisioningPlan(created, plan);
  },

  async getById(id) {
    const [row] = await db
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    return row ? toStoredUser(row) : null;
  },

  async updateSettings(sub, update) {
    const [updated] = await db
      .update(users)
      .set({
        ...(update.timezone !== undefined ? { timezone: update.timezone } : {}),
        ...(update.location !== undefined
          ? locationColumns(update.location)
          : {}),
        ...(update.dietAdvice !== undefined
          ? { dietAdvice: update.dietAdvice }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(users.authSubject, sub))
      .returning();
    if (!updated) {
      throw new Error("failed to update the user's settings");
    }
    return toStoredUser(updated);
  },

  async deleteUser(sub) {
    // Every user-owned table references `users.id` with ON DELETE CASCADE, so
    // this one statement removes the account and all of its training data.
    await db.delete(users).where(eq(users.authSubject, sub));
  },
};

/**
 * Bootstrap rule for one provisioning pass: the configured administrator's
 * auth subject becomes admin, and every other account is a member. Pure so the
 * rule is testable without Postgres (ADR 0006).
 */
export function planUserProvisioning(
  sub: string,
  adminSubject: string | null,
): ProvisioningPlan {
  return {
    role: adminSubject !== null && sub === adminSubject ? "admin" : "member",
  };
}
