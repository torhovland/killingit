import type {
  AnalyzedActivitiesResponse,
  BlockPlan,
  DayPlan,
  LlmCallMessage,
  LlmCallUsage,
  LlmPromptKind,
  SeasonPlan,
  WeekPlan,
} from "@killingit/shared";
import { LLM_PROMPT_KINDS } from "@killingit/shared";
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * An application account, keyed by the auth provider's subject (`sub`). Roles
 * live here rather than in the token so authorisation is owned by the app and
 * survives provider changes (ADR 0006). The first account provisioned in an
 * environment is an admin; everyone after is a member.
 */
export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    authSubject: text("auth_subject").notNull().unique(),
    role: text("role", { enum: ["admin", "member"] })
      .notNull()
      .default("member"),
    // IANA zone used to display the athlete's times; null means device zone.
    timezone: text("timezone"),
    // Home location used for weather-aware planning. Latitude and longitude are
    // always set together; `locationName` is only a display label.
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    locationName: text("location_name"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check("users_role_check", sql`${table.role} in ('admin', 'member')`),
    check(
      "users_location_check",
      sql`(${table.latitude} is null and ${table.longitude} is null) or (${table.latitude} is not null and ${table.longitude} is not null)`,
    ),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;

/**
 * One athlete metric value per day. FTP is stored alongside body weight and
 * body-fat percentage so the same time-series code can interpolate and
 * extrapolate all three. `source` records whether the athlete stated the value,
 * Garmin supplied it, or the coach estimated it; only coach estimates are
 * replaced when the LLM produces a newer one.
 */
export const athleteMetrics = pgTable(
  "athlete_metrics",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    metric: text("metric", { enum: ["ftp", "weight", "body_fat"] }).notNull(),
    source: text("source", { enum: ["user", "coach", "garmin"] }).notNull(),
    date: text("date").notNull(),
    value: doublePrecision("value").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("athlete_metrics_user_id_metric_date_idx").on(
      table.userId,
      table.metric,
      table.date,
    ),
    index("athlete_metrics_user_id_metric_idx").on(table.userId, table.metric),
    check(
      "athlete_metrics_metric_check",
      sql`${table.metric} in ('ftp', 'weight', 'body_fat')`,
    ),
    check(
      "athlete_metrics_source_check",
      sql`${table.source} in ('user', 'coach', 'garmin')`,
    ),
  ],
);

export type AthleteMetricRow = typeof athleteMetrics.$inferSelect;
export type NewAthleteMetricRow = typeof athleteMetrics.$inferInsert;

/**
 * One Garmin connection per account. Username and password are stored
 * AES-256-GCM-encrypted; ciphertext is never serialized.
 */
export const garminConnections = pgTable(
  "garmin_connections",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    usernameEncrypted: text("username_encrypted").notNull(),
    passwordEncrypted: text("password_encrypted").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("garmin_connections_user_id_idx").on(table.userId)],
);

export type GarminConnection = typeof garminConnections.$inferSelect;
export type NewGarminConnection = typeof garminConnections.$inferInsert;

/**
 * One LLM provider configuration per account. The API key is
 * AES-256-GCM-encrypted at rest and never serialized. `provider` is stored now
 * so another provider can be added without a schema change.
 */
export const llmSettings = pgTable(
  "llm_settings",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull().default("openrouter"),
    apiKeyEncrypted: text("api_key_encrypted").notNull(),
    model: text("model").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("llm_settings_user_id_idx").on(table.userId)],
);

export type LlmSetting = typeof llmSettings.$inferSelect;
export type NewLlmSetting = typeof llmSettings.$inferInsert;

/**
 * One prompt sent to an LLM provider, with the response (or the error) and the
 * request metadata. Written for every completion attempt so the admin can
 * debug coaching output; retries and repair turns appear as separate rows.
 * Prompt text can contain athlete health and training details, so the log is
 * admin-only and deleted with the account.
 */
export const llmCalls = pgTable(
  "llm_calls",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").$type<LlmPromptKind>().notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    /** The exact messages sent, including a repair turn's prior response. */
    messages: jsonb("messages").$type<LlmCallMessage[]>().notNull(),
    response: text("response"),
    error: text("error"),
    usage: jsonb("usage").$type<LlmCallUsage | null>(),
    /** Temperature, output budget, reasoning options, attempt, and model. */
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    durationMs: integer("duration_ms").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /**
     * When the provider settled. Null while the call is in flight, and when
     * the process died before it could record a response or error.
     */
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("llm_calls_created_at_idx").on(table.createdAt),
    index("llm_calls_user_id_created_at_idx").on(table.userId, table.createdAt),
    check(
      "llm_calls_kind_check",
      sql`${table.kind} in (${sql.raw(
        LLM_PROMPT_KINDS.map((kind) => `'${kind}'`).join(", "),
      )})`,
    ),
    check("llm_calls_duration_ms_check", sql`${table.durationMs} >= 0`),
  ],
);

export type LlmCallRow = typeof llmCalls.$inferSelect;
export type NewLlmCallRow = typeof llmCalls.$inferInsert;

/**
 * Cached coach analysis for one athlete activity, keyed by the account, source
 * activity id, and analysis kind. `general` reviews the workout on its own;
 * `program` reviews it against the athlete's training plan after a full plan
 * build. Reused across page visits; regenerated when the selected model changes.
 */
export const activityAnalyses = pgTable(
  "activity_analyses",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Garmin activity ids are ~2.5e10, beyond a 32-bit integer. `mode: "number"`
    // is safe for the full range of ids we receive (well under 2^53).
    activityId: bigint("activity_id", { mode: "number" }).notNull(),
    kind: text("kind", { enum: ["general", "program"] })
      .notNull()
      .default("general"),
    model: text("model").notNull(),
    promptVersion: integer("prompt_version").notNull().default(1),
    analysis: text("analysis").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("activity_analyses_user_id_activity_id_kind_idx").on(
      table.userId,
      table.activityId,
      table.kind,
    ),
  ],
);

export type ActivityAnalysis = typeof activityAnalyses.$inferSelect;
export type NewActivityAnalysis = typeof activityAnalyses.$inferInsert;

/**
 * The last successfully synced activity feed per user. It lets the dashboard
 * show existing activities immediately on load, while the live Garmin sync and
 * any new analyses run. Replaced after every successful sync.
 */
export const activityFeedCache = pgTable("activity_feed_cache", {
  userId: integer("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  feed: jsonb("feed").$type<AnalyzedActivitiesResponse>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type ActivityFeedCacheRow = typeof activityFeedCache.$inferSelect;
export type NewActivityFeedCache = typeof activityFeedCache.$inferInsert;

/**
 * Stable identity for an athlete question. The wording lives in
 * `question_versions` and is append-only; `currentVersion` points at the version
 * athletes are asked now. Deleting archives the question so historical answers
 * keep referring to intact versions.
 */
export const questions = pgTable("questions", {
  id: serial("id").primaryKey(),
  currentVersion: integer("current_version").notNull().default(1),
  // Ascending onboarding order; ties fall back to id for stable listing.
  position: integer("position").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

export type QuestionRow = typeof questions.$inferSelect;
export type NewQuestion = typeof questions.$inferInsert;

/**
 * Immutable prompt content for one version of a question. Future answers should
 * reference `id` so the exact wording is preserved.
 */
export const questionVersions = pgTable(
  "question_versions",
  {
    id: serial("id").primaryKey(),
    questionId: integer("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    prompt: text("prompt").notNull(),
    required: boolean("required").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("question_versions_question_id_version_idx").on(
      table.questionId,
      table.version,
    ),
  ],
);

export type QuestionVersionRow = typeof questionVersions.$inferSelect;
export type NewQuestionVersion = typeof questionVersions.$inferInsert;

/**
 * One athlete's answer to an exact question version (ADR 0007). The version
 * reference pins the wording the athlete saw; a unique `(user_id,
 * question_version_id)` pair makes resubmission an upsert. A null answer records
 * an explicit skip of an optional question. Answers to old versions and archived
 * questions are retained.
 */
export const questionAnswers = pgTable(
  "question_answers",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    questionVersionId: integer("question_version_id")
      .notNull()
      .references(() => questionVersions.id, { onDelete: "cascade" }),
    // Null means the athlete explicitly skipped an optional question.
    answer: text("answer"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("question_answers_user_id_question_version_id_idx").on(
      table.userId,
      table.questionVersionId,
    ),
    check(
      "question_answers_answer_check",
      sql`${table.answer} is null or length(btrim(${table.answer})) > 0`,
    ),
  ],
);

export type QuestionAnswerRow = typeof questionAnswers.$inferSelect;
export type NewQuestionAnswer = typeof questionAnswers.$inferInsert;

/**
 * An activity manually recorded by the athlete, e.g. a workout not captured by
 * Garmin. Kept intentionally simple: a date and free text.
 */
export const manualActivities = pgTable("manual_activities", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  startDate: text("start_date").notNull(),
  details: text("details").notNull(),
  // Coach-estimated training stress for this entry, derived from the free-text
  // details when it is saved. Null until it has been estimated.
  estimatedTss: integer("estimated_tss"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type ManualActivityRow = typeof manualActivities.$inferSelect;
export type NewManualActivity = typeof manualActivities.$inferInsert;

/**
 * An activity the athlete removed from their coaching view. Imported activities
 * are re-synced from Garmin on every visit, so deleting one records a tombstone
 * rather than touching the source. Manual activities are deleted from
 * `manual_activities`; their tombstone preserves a timestamp that tells plan
 * generation the athlete's inputs changed.
 */
export const activityDeletions = pgTable(
  "activity_deletions",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    source: text("source", { enum: ["garmin", "manual"] }).notNull(),
    activityId: text("activity_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("activity_deletions_user_id_source_activity_id_idx").on(
      table.userId,
      table.source,
      table.activityId,
    ),
    check(
      "activity_deletions_source_check",
      sql`${table.source} in ('garmin', 'manual')`,
    ),
  ],
);

export type ActivityDeletionRow = typeof activityDeletions.$inferSelect;
export type NewActivityDeletion = typeof activityDeletions.$inferInsert;

/**
 * A comment the athlete added to an activity (synced or manual). The activity id
 * is stored as text so both Garmin's numeric ids and manual ids can be used.
 */
export const activityComments = pgTable(
  "activity_comments",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    activityId: text("activity_id").notNull(),
    comment: text("comment").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("activity_comments_user_id_activity_id_idx").on(
      table.userId,
      table.activityId,
    ),
  ],
);

export type ActivityCommentRow = typeof activityComments.$inferSelect;
export type NewActivityComment = typeof activityComments.$inferInsert;

/**
 * Activities the athlete marked as reviewed with "No comment". Reviews are a
 * UI acknowledgement only and deliberately do not influence the plan.
 */
export const activityReviews = pgTable(
  "activity_reviews",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    activityId: text("activity_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("activity_reviews_user_id_activity_id_idx").on(
      table.userId,
      table.activityId,
    ),
  ],
);

export type ActivityReviewRow = typeof activityReviews.$inferSelect;
export type NewActivityReview = typeof activityReviews.$inferInsert;

/**
 * A general note the athlete added for a specific week (e.g. "won't train on
 * Thursday"). The note applies to the week starting on `weekStartDate`.
 */
export const weeklyNotes = pgTable(
  "weekly_notes",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    weekStartDate: text("week_start_date").notNull(),
    note: text("note").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("weekly_notes_user_id_week_start_date_idx").on(
      table.userId,
      table.weekStartDate,
    ),
  ],
);

export type WeeklyNoteRow = typeof weeklyNotes.$inferSelect;
export type NewWeeklyNote = typeof weeklyNotes.$inferInsert;

/**
 * The coach's latest short reply to an athlete input: a comment on an activity,
 * a weekly note, or a manual activity. `target` is the activity id, the week
 * start date, or the manual activity id depending on `kind`. One row per input,
 * replaced when the athlete adds a newer reply.
 */
export const coachReplies = pgTable(
  "coach_replies",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind", {
      enum: [
        "activity_comment",
        "weekly_note",
        "manual_activity",
        "week_review",
        "block_review",
      ],
    }).notNull(),
    target: text("target").notNull(),
    reply: text("reply").notNull(),
    model: text("model").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("coach_replies_user_id_kind_target_idx").on(
      table.userId,
      table.kind,
      table.target,
    ),
    check(
      "coach_replies_kind_check",
      sql`${table.kind} in ('activity_comment', 'weekly_note', 'manual_activity', 'week_review', 'block_review')`,
    ),
  ],
);

export type CoachReplyRow = typeof coachReplies.$inferSelect;
export type NewCoachReply = typeof coachReplies.$inferInsert;

/**
 * The coach's summary of a completed week or block, with the athlete's comment
 * and a UI acknowledgement. Weeks and blocks are replaced as the plan advances,
 * so the review is stored separately as a lightweight history.
 */
export const periodReviews = pgTable(
  "period_reviews",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["week", "block"] }).notNull(),
    startDate: text("start_date").notNull(),
    endDate: text("end_date").notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    model: text("model").notNull(),
    promptVersion: integer("prompt_version").notNull(),
    /** The athlete's comment on the review, if any. */
    comment: text("comment"),
    /** The athlete dismissed the review with "No comment". */
    reviewed: boolean("reviewed").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("period_reviews_user_id_kind_start_date_idx").on(
      table.userId,
      table.kind,
      table.startDate,
    ),
    check("period_reviews_kind_check", sql`${table.kind} in ('week', 'block')`),
    check(
      "period_reviews_comment_check",
      sql`${table.comment} is null or length(btrim(${table.comment})) > 0`,
    ),
  ],
);

export type PeriodReviewRow = typeof periodReviews.$inferSelect;
export type NewPeriodReview = typeof periodReviews.$inferInsert;

/**
 * One clarification question the coach asked the athlete. Only the newest
 * unanswered question is shown at a time; answered questions keep the coach's
 * reply for the season review.
 */
export const coachQuestions = pgTable(
  "coach_questions",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    question: text("question").notNull(),
    /** The prompt kind that produced the question, for admin diagnostics. */
    sourceKind: text("source_kind").notNull(),
    model: text("model").notNull(),
    /** The athlete's answer, null while the question is pending. */
    answer: text("answer"),
    /** The coach's reply after the athlete answers. */
    reply: text("reply"),
    replyModel: text("reply_model"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
  },
  (table) => [
    index("coach_questions_user_id_created_at_idx").on(
      table.userId,
      table.createdAt,
    ),
    check(
      "coach_questions_question_check",
      sql`length(btrim(${table.question})) > 0`,
    ),
    check(
      "coach_questions_answer_check",
      sql`${table.answer} is null or length(btrim(${table.answer})) > 0`,
    ),
    check(
      "coach_questions_reply_check",
      sql`${table.reply} is null or length(btrim(${table.reply})) > 0`,
    ),
  ],
);

export type CoachQuestionRow = typeof coachQuestions.$inferSelect;
export type NewCoachQuestion = typeof coachQuestions.$inferInsert;

/**
 * The athlete's current four-level coach plan. One row per user; a regeneration
 * replaces the stored JSON while keeping the previous plan visible until the
 * new one is ready. The date columns duplicate values inside the JSON so the
 * pending/staleness checks can be done without parsing and are easy to index.
 */
export const coachPlans = pgTable(
  "coach_plans",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    season: jsonb("season").$type<SeasonPlan>().notNull(),
    block: jsonb("block").$type<BlockPlan>().notNull(),
    week: jsonb("week").$type<WeekPlan>().notNull(),
    today: jsonb("today").$type<DayPlan>().notNull(),
    /** Suggested session for tomorrow; shown after 18:00 local time. */
    tomorrow: jsonb("tomorrow").$type<DayPlan | null>(),
    /** The week containing tomorrow once it has crossed the current week. */
    nextWeek: jsonb("next_week").$type<WeekPlan | null>(),
    /** The block containing tomorrow once it has crossed the current block. */
    nextBlock: jsonb("next_block").$type<BlockPlan | null>(),
    dayDate: text("day_date").notNull(),
    weekStartDate: text("week_start_date").notNull(),
    blockStartDate: text("block_start_date").notNull(),
    blockEndDate: text("block_end_date").notNull(),
    seasonStartDate: text("season_start_date").notNull(),
    seasonEndDate: text("season_end_date").notNull(),
    // The newest question-answer timestamp included in this plan. A newer answer
    // makes the plan stale and triggers a regeneration.
    answersUpdatedAt: timestamp("answers_updated_at", { withTimezone: true }),
    // The newest activity-comment, manual-activity, weekly-note, week-review,
    // or block-review timestamp included in this plan. A newer input triggers a
    // revision of the affected levels without discarding the existing plan.
    coachingInputsUpdatedAt: timestamp("coaching_inputs_updated_at", {
      withTimezone: true,
    }),
    // The newest activity analysis included in this plan. A newer analysis
    // means an imported activity has not reached the plan yet, even if the
    // plan was saved later while the activity sync was still running.
    activitiesUpdatedAt: timestamp("activities_updated_at", {
      withTimezone: true,
    }),
    generatedAt: timestamp("generated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("coach_plans_user_id_idx").on(table.userId)],
);

export type CoachPlanRow = typeof coachPlans.$inferSelect;
export type NewCoachPlan = typeof coachPlans.$inferInsert;

/**
 * Per-user generation status used by the UI to show progress while the coach is
 * thinking. A single row is upserted; `begin` refuses to start a second run
 * while the status is `running`.
 */
export const planGenerations = pgTable(
  "plan_generations",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["idle", "running", "done", "error"] })
      .notNull()
      .default("idle"),
    /** Identifies the run that currently owns this row. */
    runId: text("run_id"),
    step: text("step"),
    /** Stable step key used to learn how long this step takes. */
    stepId: text("step_id"),
    progress: integer("progress").notNull().default(0),
    /** Percentage the current step moves towards while it runs. */
    progressEnd: integer("progress_end").notNull().default(100),
    /** When the current step began; heartbeats only touch `updated_at`. */
    stepStartedAt: timestamp("step_started_at", { withTimezone: true }),
    /** Expected duration of the current step, copied from its learned average. */
    stepExpectedMs: integer("step_expected_ms").notNull().default(0),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("plan_generations_user_id_idx").on(table.userId),
    check(
      "plan_generations_status_check",
      sql`${table.status} in ('idle', 'running', 'done', 'error')`,
    ),
    check(
      "plan_generations_progress_check",
      sql`${table.progress} >= 0 and ${table.progress} <= 100`,
    ),
    check(
      "plan_generations_progress_end_check",
      sql`${table.progressEnd} >= 0 and ${table.progressEnd} <= 100`,
    ),
  ],
);

export type PlanGenerationRow = typeof planGenerations.$inferSelect;
export type NewPlanGeneration = typeof planGenerations.$inferInsert;

/**
 * Learned duration of each generation step. The first observation is used as
 * is; later ones update the average. Shared by all users, because it is a
 * display heuristic rather than a per-account setting.
 */
export const planGenerationStepDurations = pgTable(
  "plan_generation_step_durations",
  {
    stepId: text("step_id").primaryKey(),
    averageMs: integer("average_ms").notNull(),
    samples: integer("samples").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "plan_generation_step_durations_average_check",
      sql`${table.averageMs} > 0`,
    ),
  ],
);

export type PlanGenerationStepDurationRow =
  typeof planGenerationStepDurations.$inferSelect;
