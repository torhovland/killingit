# AI costs page

## Goal

Show the athlete what their coach's OpenRouter calls cost, split by the model
that answered or by the type of prompt, so a model choice can be judged on
price as well as quality and the prompts driving spend can be found.

## Scope

- A new **AI costs** page in the account menu, directly above Settings.
- A **Stack by** choice that switches both charts between **Model** and
  **Prompt type**.
- A monthly bar chart with **Last 12 months** and **All time** ranges.
- A daily bar chart with **Last 7 days**, **Last 31 days**, **Last 365 days**,
  and **All time** ranges.
- Costs are for the signed-in account only.
- The admin prompt log shows the reported cost of one call in its metadata
  rows when the provider returned one.

## Data and API

OpenRouter returns `usage.cost` on every chat completion response. The
normalizer now stores that value as `costUsd` in the existing `llm_calls.usage`
JSON, so no migration is needed. The field is optional because rows written
before cost capture have no value.

`GET /api/llm/costs` returns:

```json
{
  "monthly": [
    {
      "bucket": "2026-11",
      "model": "openrouter/some-model",
      "label": "Some Model",
      "kind": "season_plan",
      "costUsd": 0.42,
      "calls": 3
    }
  ],
  "daily": [
    {
      "bucket": "2026-11-04",
      "model": "openrouter/some-model",
      "label": "Some Model",
      "kind": "activity_analysis",
      "costUsd": 0.12,
      "calls": 1
    }
  ]
}
```

- Buckets are UTC months (`YYYY-MM`) and days (`YYYY-MM-DD`).
- Rows are grouped by the routed model OpenRouter reported in
  `metadata.responseModel`, falling back to the requested model id, and by the
  call's prompt `kind`, so the same spend can be stacked either way without
  counting a call twice.
- The display label comes from `llm_models`, falling back to the model id. A
  prompt type's label comes from `LLM_PROMPT_KIND_LABELS`.
- A call uses its reported `costUsd` when present. A row without one is
  estimated from its token usage and the catalog's current list price; a model
  with no known price contributes zero rather than a guess.
- The web app fills empty months and days, so the chart's x axis is continuous
  over the selected range.
- Model order and colours come from all-time spend, so changing a range never
  recolours the stacks. Prompt types are ordered by all-time spend the same
  way.

## Acceptance criteria

- The menu entry appears directly above Settings and opens the page.
- The monthly chart shows the selected range and stacks one segment per model
  or prompt type, according to the **Stack by** choice.
- The daily chart shows the selected range and stacks one segment per model or
  prompt type, according to the **Stack by** choice.
- Each chart shows its total for the selected range and a legend of the series
  that contribute to it.
- Hovering a bar shows its period, total, per-series split, and call count,
  with each series' own call count shown before its cost.
- An empty range shows a clear message instead of an empty plot.
- The API route is authenticated and scoped to the account.
- Unit tests cover the aggregation, the range bucketing, both stack dimensions,
  the chart rendering, and the route.

## Out of scope

- Fetching OpenRouter's account balance or per-generation billing API.
- Budget alerts or spend limits.
- Costs for other providers, which do not exist yet.
