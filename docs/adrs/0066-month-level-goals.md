# ADR 0066: Keep month-level goals and a complete season headline

- **Status:** Accepted
- **Date:** 2026-11-25
- **Deciders:** torhovland
- **Related:** `docs/specs/goal-ledger.md`, ADR 0064, ADR 0065

## Context

The athlete's answers included Paris-Brest-Paris in August 2027 and a 200 km
brevet in April 2027, but the Test season listed only the Atlas Mountain Race in
`season.goals`. The Atlas race had an exact date from the event reading; the
other goals did not, and `SeasonGoal.date` required an exact day. The model
therefore left them out of the ledger, which left every block after Atlas with
an empty `subGoals` array and produced a season headline that named only Atlas.

The athlete had not invented the missing goals: they were in the survey text.
The app was forcing an exact-day schema onto month-level goals.

## Decision

- Add an optional `dateText` to `SeasonGoal`.
- When the athlete gives only a month or year, the coach includes the goal with
  `date` set to the last day of that period as a planning anchor and `dateText`
  set to the athlete's words, such as "August 2027". The anchor is not a claim
  about the exact day.
- The season `goal` headline must name every goal in order with its target, not
  only the nearest one.
- When a race goal has no distance, elevation or target time, the coach plans a
  completion target and asks one `coachQuestion` for the missing course details
  and target rather than inventing them.

## Alternatives considered

- **Allow a null goal date.** The block coverage and sub-goal references need a
  date to decide which blocks must account for the goal; a null would need a
  second coverage model.
- **Use the first day of the month.** It would stop requiring coverage too early
  for a goal late in the month. The last day is the safe anchor.
- **Leave it to the model's prose.** The Test plan shows that the model will
  mention PBP in block names while omitting it from the structured ledger.

## Consequences

- Month-level goals appear in the Season goals list and require sub-goals in
  every block up to the anchor date.
- The UI shows `dateText` when present; the anchor date is used for planning
  and validation, not displayed as an exact event day.
- The schema field is optional, so existing stored plans still parse.
- The goal-steering benchmark season revision now keeps Atlas, the 200 km
  brevet and PBP in `season.goals`, with sub-goals in every block leading to
  them.
