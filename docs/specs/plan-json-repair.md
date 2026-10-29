# Spec: Repair malformed coach-plan JSON

- **Status:** Accepted (implemented)
- **Date:** 2026-10-22
- **Related:** `docs/specs/coach-plan-lifecycle.md`,
  `docs/specs/coach-plan-prompts.md`, ADR 0004 (OpenRouter).

## Goal

Make plan generation resilient when a model returns valid JSON that does not
match the plan schema. This showed up as the opaque failure "The coach returned
a plan with an unexpected shape" with `~anthropic/claude-haiku-latest`. The
cause must be actionable, and the coach must get one chance to correct itself
before the generation fails.

## Scope

### In scope

1. `PlanJsonError` carries the Zod issues and includes a concise summary (field
   path + problem) in its message.
2. After a response fails validation, send one repair completion: the original
   messages, the rejected response as an assistant message, and a user message
   listing the validation problems with an instruction to return corrected JSON.
   The caller may add a targeted hint, such as the exact dates the week must
   contain, when the generic message does not carry enough information.
3. The week and day prompts state the calendars they must produce: the week
   starts on the requested date, contains exactly that week's seven dates, and
   the day update's `today` date must match one of those sessions. The same
   constraint is validated after the response and included in the repair hint.
4. Use the repair path for all plan completions (season, block, week, day, and
   the single plan-update prompt).
5. Keep the original opaque phrase as a prefix so existing UI/reporting remains
   recognisable.
6. The plan-update response is validated as a complete plan: today must be one
   of the current week's sessions, tomorrow must be in the current or next
   week, and a returned next week must start on its Monday. The repair turn
   repeats those dates.

### Out of scope

- Looping repairs until valid. One repair keeps cost and latency bounded.
- Provider-specific structured outputs. The fix stays inside the
  provider-agnostic seam.
- Weakening the plan schemas to accept malformed values. Invalid enum values are
  rejected; the prompt and repair must produce exact values instead.

## Acceptance criteria

1. A response that fails schema validation triggers exactly one additional
   completion, and a valid repair is returned as the plan.
2. If the repair also fails validation, the error exposes the new validation
   summary.
3. The repair prompt includes the rejected response and the validation details.
4. Prompt contracts explicitly tell the model not to copy `|` choice lists or
   placeholders literally, and state that `type` and `intensity` are exact,
   lowercase enum strings. A `type` is never a session name such as "run",
   "strength", or "rest day". The prompts and the repair message also require
   the exact top-level keys, so a bare inner object, an array, or a wrapper such
   as `{"plan": ...}` is rejected. The repair message repeats the allowed `type`
   values.
5. A day or week response whose dates do not match the requested week is
   rejected, and the repair turn repeats the exact week dates and, for a day
   update, the exact `today` date. A response with the correct dates passes
   without a repair.
6. `bun run typecheck`, `bun run lint`, `bun run format`, and `bun run test`
   pass.
7. A plan-update response with a misplaced tomorrow or a next week that does
   not start on Monday is repaired before it can be saved, so
   `pending.tomorrow` clears instead of triggering another failed generation on
   every visit.

## Data-model / API impact

None. The stored plan shape and routes are unchanged; only the LLM call path and
error message change.
