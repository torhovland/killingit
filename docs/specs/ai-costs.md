# AI costs page

## Goal

Show the athlete what their coach's OpenRouter calls cost, split by the model
that answered, so a model choice can be judged on price as well as quality.

## Scope

- A new **AI costs** page in the account menu, directly above Settings.
- A monthly bar chart, stacked by model, with **Last 12 months** and **All
  time** ranges.
- A daily bar chart, stacked by model, with **Last 7 days**, **Last 31 days**,
  **Last 365 days**, and **All time** ranges.
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
      "costUsd": 0.42,
      "calls": 3
    }
  ],
  "daily": [
    {
      "bucket": "2026-11-04",
      "model": "openrouter/some-model",
      "label": "Some Model",
      "costUsd": 0.12,
      "calls": 1
    }
  ]
}
```

- Buckets are UTC months (`YYYY-MM`) and days (`YYYY-MM-DD`).
- Rows are grouped by the routed model OpenRouter reported in
  `metadata.responseModel`, falling back to the requested model id.
- The display label comes from `llm_models`, falling back to the model id.
- A call uses its reported `costUsd` when present. A row without one is
  estimated from its token usage and the catalog's current list price; a model
  with no known price contributes zero rather than a guess.
- The web app fills empty months and days, so the chart's x axis is continuous
  over the selected range.
- Model order and colours come from all-time spend, so changing a range never
  recolours the stacks.

## Acceptance criteria

- The menu entry appears directly above Settings and opens the page.
- The monthly chart shows the selected range and stacks one segment per model.
- The daily chart shows the selected range and stacks one segment per model.
- Each chart shows its total for the selected range and a legend of the models
  that contribute to it.
- Hovering a bar shows its period, total, per-model split, and call count.
- An empty range shows a clear message instead of an empty plot.
- The API route is authenticated and scoped to the account.
- Unit tests cover the aggregation, the range bucketing, the chart rendering,
  and the route.

## Out of scope

- Fetching OpenRouter's account balance or per-generation billing API.
- Budget alerts or spend limits.
- Costs for other providers, which do not exist yet.
