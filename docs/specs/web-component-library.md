# Web component library

## Goal

Give the web app one source of truth for its most repeated controls, so a
button, field or panel looks the same everywhere and a styling change lands in
one file instead of dozens.

## Scope

The primitives live in `apps/web/src/components/`:

- `Button` — `variant` (`primary`, `secondary`, `danger`, `dangerStrong`,
  `ghost`, `link`, `linkStrong`) and `size` (`none`, `xs`, `sm`, `md`, `lg`,
  `hero`, `icon`, `menu`, `menuSm`). It renders a real `button`, defaults to
  `type="button"`, and dims itself when disabled.
- `Input`, `Textarea` and `Select` — the standard field surface with a `size`
  that carries width, padding and text size. `Input` and `Textarea` default to
  the full-width form field; `Textarea` also has a compact `line` size.
- `HiddenFileInput` — the visually hidden file input behind a camera or upload
  button.
- `Card` — `rounded-lg border p-4` on the card surface, with `as` to keep
  `section`, `article` or `aside` semantics and an `inset` variant for panels
  inside another card.
- `Modal` — a modal dialog with a backdrop click-to-close, Escape to close, a
  Tab focus trap and focus restored to the trigger on close. It takes the
  heading id that names it, an optional description id, and a `className` for
  panel layout such as width or scrolling; see `docs/specs/modal-dialog.md`.
- `StatusBadge` — a week session's status (`completed`, `partial`, `planned`,
  `missed`, `rest`) as a compact capitalised badge, shared by the plan and
  calendar views so a status renders identically wherever it appears.
- `Chip` — a small inline label for a dense list, with an `accent variant` for
  a plan or event marker and a `muted` one for a note such as a rest day. The
  calendar's day cell renders its block start, season end, events and rest note
  through it. A selectable entry stays a `button`, not a chip.
- `CoachReply` — the coach's side of a conversation: the `Coach:` label above
  the reply, formatted through `FormattedText`. The calendar dialog, the
  activity card and the period review card all show a stored reply through it,
  so the label and spacing cannot drift between them.
- `cn` — `clsx` plus `tailwind-merge`, so a caller's `className` overrides a
  primitive's default instead of duplicating it.

## Class composition

A `className` that is built from more than a fixed string is composed with
`cn()`, passing each conditional or optional fragment as its own argument:

```tsx
className={cn(
  "flex flex-col gap-1 rounded border p-1.5 text-sm",
  inMonth ? "bg-card" : "bg-muted/40 text-muted-foreground",
  isToday && "ring-2 ring-ring",
)}
```

This keeps tailwind-merge in the loop, so a caller's `p-6` overrides the
primitive's `p-4`, and an omitted fragment — a false condition, `undefined` or
an empty string — adds neither a class nor a stray space. A template literal
such as ``className={`p-4 ${active ? "bg-card" : ""}`}`` bypasses both and is
reported by the `local/no-template-classname` ESLint rule, which runs on the
web app and fails `bun run lint`. A template literal passed _to_ `cn()` is the
intended dynamic input and stays allowed.

Page components live in the feature directory that owns them, beside their
tests: `calendar/`, `fitness/`, `diet/`, `settings/` and `admin/` each hold a
page, its sections and its single-page helpers. Only shared primitives belong
in `components/`; the shared chart frame, legend and series palette, geometry
and keyboard and hover hooks live in `charts/`, and pieces used across pages
(`TrainingLoadLine`, `CalorieBalancePanel`, `mapProjection`, the current-user and
time-zone providers) stay at the root. The fitness, threshold and cost chart
legends render through `ChartLegend`, which owns the list, swatch shapes and
optional `sport · unit` detail, and the legend inset is the exported
`CHART_LEGEND_INSET_CLASS` utility rather than an inline style. The threshold
chart's series colours come from `seriesClass(index)`, which wraps the shared
palette; the fitness health charts pass their semantic palette to the same
helper. The fitness page's chart variants and their pure data preparation live
in `fitness/charts/`: `dailyHealthData.ts` shapes the recovery series and the
stacked sleep layers, `bodyChartData.ts` prepares the body scales and diet
targets, and `DailyHealthCharts.tsx`, `HealthLineChart.tsx`, `SleepChart.tsx`
and `BodyChart.tsx` only render the prepared data. A page whose sections outgrow
one module keeps the same split: the coach plan's Day, Week, Block and Season
sections and their shared pieces live in `plan/`, while the `CoachPlanView` tab
shell stays in the feature root; the OpenRouter model picker's catalog hook,
filter bar, table and save queue live in `llm/`, while the `LlmSection` entry
point sits in `settings/`. A one-off control with genuinely unique styling may
stay a plain element, but it must not repeat a primitive's base class string.

## Usage rule

Pass `variant` and `size` for the primitive's look. Pass `className` only for
layout (for example `self-start`, `w-fit`, `mt-3`) or a deliberate override such
as `text-sm`. Do not rebuild a button, field or card out of raw utilities in a
page.

`SubmitButton` builds on `Button`: it keeps its `inline-flex items-center gap-2`
layout for the spinner and forwards `variant`, `size` and `className`.

## Acceptance criteria

- Every repeated primary and secondary button string goes through `Button`, and
  every repeated input, textarea and select string through its primitive.
- A card shell that matches the primitive's surface uses `Card`, preserving its
  element (`as="section"`) and any tighter padding through `className`.
- No raw button, input, textarea or select class string is repeated across
  pages; the only remaining native controls are ones with unique styling or
  semantics.
- Every modal dialog renders through `Modal`; no page reimplements the
  backdrop, focus trap, Escape handling or focus restore.
- The primitives have unit tests for their defaults, variants and class
  merging.
- Every conditional `className` is composed with `cn()`, and no JSX attribute is
  built from a template literal; `local/no-template-classname` fails
  `bun run lint` otherwise.
- The fitness, threshold and cost chart legends render through `ChartLegend`;
  the threshold chart and the fitness health charts take their series colours
  from `seriesClass`; no chart repeats that legend markup, series palette or the
  plot inset.
- A chart with several measures keeps its data shaping and scales in a pure
  module beside it, with unit tests, and the component only renders the prepared
  data.
- `bun run typecheck`, `bun run lint`, `bun run format` and `bun run test` pass.

## Data model and API impact

None. This is a frontend-only refactor; no route, schema or prompt changes.
