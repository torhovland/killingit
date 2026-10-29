import type { AthleteLocation, UserRole } from "@killingit/shared";
import { eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { users, type UserRow } from "../db/schema.js";

/** An application account with its authorisation role. */
export interface StoredUser {
  id: number;
  sub: string;
  role: UserRole;
  /** Preferred IANA time zone; null means the device's time zone. */
  timezone: string | null;
  /** Home location for weather forecasts; null means weather is not used. */
  location: AthleteLocation | null;
  createdAt: Date;
}

/** A partial settings update; omitted fields keep their stored value. */
export interface UserSettingsPatch {
  timezone?: string | null;
  location?: AthleteLocation | null;
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
}

export interface ProvisioningPlan {
  /** Whether the earliest existing account should be promoted to admin. */
  promoteEarliest: boolean;
  /** Role assigned to the account being provisioned. */
  role: UserRole;
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
    timezone: row.timezone,
    location:
      row.latitude !== null && row.longitude !== null
        ? {
            latitude: row.latitude,
            longitude: row.longitude,
            name: row.locationName,
          }
        : null,
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
        updatedAt: new Date(),
      })
      .where(eq(users.authSubject, sub))
      .returning();
    if (!updated) {
      throw new Error("failed to update the user's settings");
    }
    return toStoredUser(updated);
  },
};

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
