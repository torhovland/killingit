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
3. Use the repair path for all plan completions (season, block, week, day, and
   the cascade updates).
4. Keep the original opaque phrase as a prefix so existing UI/reporting remains
   recognisable.

### Out of scope

- Looping repairs until valid. One repair keeps cost and latency bounded.
- Provider-specific structured outputs. The fix stays inside the
  provider-agnostic seam.
- Weakening the plan schemas to accept malformed values.

## Acceptance criteria

1. A response that fails schema validation triggers exactly one additional
   completion, and a valid repair is returned as the plan.
2. If the repair also fails validation, the error exposes the new validation
   summary.
3. The repair prompt includes the rejected response and the validation details.
4. Prompt contracts explicitly tell the model not to copy `|` choice lists or
   placeholders literally.
5. `bun run typecheck`, `bun run lint`, `bun run format`, and `bun run test`
   pass.

## Data-model / API impact

None. The stored plan shape and routes are unchanged; only the LLM call path and
error message change.
