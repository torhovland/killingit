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
- `ConfirmDialog` — a destructive confirmation on `Modal`: a title, the
  consequence it describes, Cancel and one labelled destructive action. Cancel
  is first so focus opens on the safe action, and a busy state disables both
  actions and blocks Escape and the backdrop; a failed action's error stays
  inside the dialog. The activity, manual-activity and athlete-question deletes
  use it, so no web source calls the native `confirm()`. See
  `docs/specs/modal-dialog.md`.
- `Menu` — a disclosure button around a labelled navigation panel, with the
  open state owned by the caller. It takes the trigger's accessible name, the
  panel's landmark name, the trigger contents and `onOpenChange`; Escape and a
  click outside close it, focus returns to the trigger when the panel loses it,
  and the caller marks the current item with `aria-current="page"`. The account
  menu renders through it, so a page never wires its own outside-click or
  Escape listener and no code touches the DOM to close a menu. Mount the panel
  only while `open`, as `Modal` is mounted; see `docs/specs/accessibility-lint.md`.
- `Tabs` — a WAI-ARIA horizontal tablist and the selected tab's panel, with the
  selection owned by the caller. It takes the tablist's accessible name, the
  tabs as `{ id, label, content }` entries, `value` and `onChange`. Each tab
  names the panel it controls through `aria-controls`, the panel names its tab
  through `aria-labelledby`, and only the selected panel is mounted. A click,
  ArrowLeft, ArrowRight, Home or End selects a tab, arrow keys move focus with
  roving `tabIndex` and wrap at either end, and the selected tab is the tablist's
  only tab stop. The coach plan's Day, Week, Block and Season levels render
  through it; see `docs/specs/accessibility-lint.md`.
- `Badge` — a compact inline label with `muted` (the default), `accent`,
  `danger` and `outline` variants. The `rounded border px-2 py-0.5 text-sm`
  layout lives here; a caller keeps its own casing, spacing and visibility in
  `className`. `StatusBadge`, a plan day's type, the diet page's "Today"
  marker, the survey's Required/Optional note, the account menu's Admin marker
  and the admin LLM call markers all render through it.
- `StatusBadge` — a week session's status (`completed`, `partial`, `planned`,
  `missed`, `rest`) as a compact capitalised badge, built on `Badge` and shared
  by the plan and calendar views so a status renders identically wherever it
  appears.
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
web app and fails `bun run lint`. The rule also reports a template literal
assigned to a variable that is later passed directly as `className`:

```tsx
const classes = `p-4 ${active ? "bg-card" : ""}`;
<div className={classes} />;
```

It bypasses `cn()` in the same way as the inline form. A template literal
passed _to_ `cn()` is the intended dynamic input and stays allowed.

## Inline styles

A `style` prop is reserved for a value the browser only knows at runtime: a map
layer's pan and zoom `transform`, a tile's or marker's world position, a hover
card's offset, or a progress bar's live width. Each remaining `style` carries a
short comment saying why it cannot be a utility class. A constant — the chart
legend inset, a layer's transform origin or stacking order, a tile's fixed
`TILE_SIZE` edge — is a utility class such as `CHART_LEGEND_INSET_CLASS`,
`origin-top-left` or `size-[256px]`; Tailwind needs the literal value in a
class, and no inline style is added for anything constant.

Page components live in the feature directory that owns them, beside their
tests: `calendar/`, `fitness/`, `diet/`, `settings/` and `admin/` each hold a
page, its sections and its single-page helpers. Only shared primitives belong
in `components/`; the shared chart frame, legend and series palette, geometry
and keyboard and hover hooks live in `charts/`, and pieces used across pages
(`TrainingLoadLine`, `CalorieBalancePanel`, `mapProjection`, the current-user and
time-zone providers, and the app shell's `AppHeader`, `UserMenu` and `AppBody`)
stay at the root. The fitness, threshold and cost chart
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
- Every destructive confirmation renders through `ConfirmDialog`, and no web
  source calls the native `confirm()`.
- Every menu renders through `Menu`; no page attaches its own Escape or
  outside-click listener, and the current page's item carries
  `aria-current="page"`.
- Every tabbed view renders through `Tabs`; no page builds its own `tablist`,
  and the tab, panel and roving-focus ids and key handling stay in the
  primitive.
- Every badge-shaped label renders through `Badge`; `StatusBadge` and the
  admin LLM call markers build on it, and no page repeats its base class
  string.
- The primitives have unit tests for their defaults, variants and class
  merging.
- Every conditional `className` is composed with `cn()`, and no `className` is
  built from a template literal — inline or through a variable holding one;
  `local/no-template-classname` fails `bun run lint` otherwise.
- Every remaining inline `style` holds a value the browser computes at runtime
  and carries a comment explaining why; a constant offset, size or stacking
  order uses a utility class instead. No new inline style is introduced.
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
