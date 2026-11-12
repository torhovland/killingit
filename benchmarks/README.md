# Benchmarks

Model comparisons and the artifacts they produce.

- `llm-coach/` — runs from `bun run benchmark:llm`, committed with their
  metadata, plans, results, scores and PDF reports. See
  `llm-coach/README.md`.
- `prompts/` — the two-prompt grading benchmark that fills the model catalog.
  The harness lives in `tools/benchmark` and runs from
  `bun run benchmark:prompts <stage>`. Only this README is committed; its run
  directories and generated reports are local output. See `prompts/README.md`.

## Artifact policy

Generated output is committed only when it is the recorded result and small
enough to keep. We do not commit large, reproducible renderings:

- `benchmarks/prompts/runs/` and `benchmarks/prompts/reports/` are ignored. A
  prompt-benchmark run may leave files there, but `git status` stays clean.
- The generated `<RUN_ID>.html` and `.pdf` files under
  `benchmarks/prompts/reports/` are local previews produced by the `report`
  stage. Regenerate one from its run directory instead of committing it.
- `benchmarks/llm-coach/runs/` and its PDF summaries are deliberate
  source-controlled snapshots: they are the recorded comparison history.

If a prompt-benchmark result should become part of the record, summarize it in a
committed README or spec; do not commit the HTML or PDF blob.
