# Season simulation

Runs a full athlete season through the app's real plan pipeline and writes a PDF
report. It records imported activities as if the athlete completed the plan, so
the coach's fitness picture is driven by training rather than free text.

See `docs/specs/season-simulation.md` for the full contract and model
assumptions.

```sh
# A real model key is required.
export BENCHMARK_OPENROUTER_API_KEY=...

# The harness rebuilds this database; the name must end in _season_sim.
export SEASON_SIM_DATABASE_URL=postgres://killingit:killingit@localhost:5432/killingit_season_sim

bun run db:up                  # local PostgreSQL
bun run simulate:season -- --scenario full
bun run simulate:season -- --scenario reduced
bun run simulate:season -- --report-only
```

Smoke run (two weeks, separate files):

```sh
bun run simulate:season -- --scenario full --weeks 2 --suffix -smoke
```

Resume after a model or network failure:

```sh
bun run simulate:season -- --scenario full --resume
```

The results and report are written to `benchmarks/season-simulation/`.
