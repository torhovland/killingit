import {
  coachingInputSaveResponseSchema,
  planDateSchema,
  weeklyNoteRequestSchema,
  weeklyNoteResponseSchema,
} from "@killingit/shared";
import type { Context } from "hono";
import { z } from "zod";
import { getAthlete } from "../../auth/middleware.js";
import { startOfWeek } from "../../plans/dates.js";
import { toCoachAnalysis } from "../../plans/replies.js";
import { replyTo, type ResolvedCoachingDependencies } from "./dependencies.js";

type WeeklyNoteInput = z.infer<typeof weeklyNoteRequestSchema>;

/** The athlete's note about the current training week. */
export function createWeeklyNoteHandlers(deps: ResolvedCoachingDependencies) {
  return {
    async show(c: Context) {
      const user = await deps.users.ensureUser(getAthlete(c).sub);
      const today = planDateSchema.safeParse(c.req.query("today"));
      if (!today.success) {
        return c.text("A valid today date (YYYY-MM-DD) is required", 400);
      }
      const weekStartDate = startOfWeek(today.data);
      const [note, storedReply] = await Promise.all([
        deps.loadNote(user.id, weekStartDate),
        deps.loadNoteReply(user.id, weekStartDate),
      ]);
      return c.json(
        weeklyNoteResponseSchema.parse({
          note,
          reply: storedReply ? toCoachAnalysis(storedReply) : null,
        }),
      );
    },

    async save(c: Context, input: WeeklyNoteInput) {
      const user = await deps.users.ensureUser(getAthlete(c).sub);
      const { today, timezone, note } = input;

      await deps.saveWeekly(user.id, today, note);
      const coachReply = await replyTo(deps, user.id, today, {
        kind: "weekly_note",
        weekStartDate: startOfWeek(today),
        note,
      });

      await deps.trigger(deps.triggerDeps, {
        userId: user.id,
        today,
        ...(timezone !== undefined ? { timezone } : {}),
      });

      return c.json(
        coachingInputSaveResponseSchema.parse({
          message: "Weekly note saved",
          reply: coachReply,
        }),
      );
    },
  };
}
