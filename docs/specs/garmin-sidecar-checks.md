# Spec: Garmin sidecar tests and Python quality gates

- **Status:** Accepted (implemented)
- **Date:** 2026-11-11
- **Related:** issue #167, `AGENTS.md` (Development Methodology), ADR 0003,
  `docs/specs/garmin-activity-integration.md`.

## Goal

Run the Garmin sidecar's Python tests, lint, formatting and type checks on every
pull request and push, and give developers one command that runs exactly the
same gates locally. A Python regression in `services/garmin` must no longer be
able to merge unchecked.

## Scope

### In scope

1. A `garmin` CI job that runs the sidecar's checks with Python 3.12, the
   version of the sidecar's deployment image.
2. `pytest`, `ruff check`, `ruff format --check` and `mypy`, with their versions
   pinned in `services/garmin/requirements-dev.txt` and their configuration in
   `services/garmin/pyproject.toml`.
3. `bun run check:garmin`, which CI also runs, so local and CI gates cannot
   drift.
4. The small code and formatting changes needed to make the existing sidecar
   pass the gates.

### Out of scope

- Type-annotating every function. mypy checks the bodies of untyped functions
  (`check_untyped_defs`) but does not require annotations on every parameter.
  Requiring them can be added later as a ratchet.
- Running the sidecar checks as part of `bun run test`. They need a Python
  virtualenv and a network install on first use, so they stay an explicit
  command; CI runs them in their own job.
- Coverage thresholds for the Python suite.

## Behaviour

### Local and CI command

`bun run check:garmin` (script: `scripts/check-garmin.sh`):

1. Creates `services/garmin/.venv` with `python3 -m venv` when it is missing.
2. Installs `requirements-dev.txt`, which includes `requirements.txt` plus the
   pinned tools.
3. Runs `pytest`, `ruff check .`, `ruff format --check .` and `mypy` from
   `services/garmin`.

The CI `garmin` job runs the same script after `actions/setup-python@v7` selects
Python 3.12, and caches pip downloads against `requirements*.txt`.

### Configuration

- `requirements-dev.txt` pins `pytest==8.3.4`, `ruff==0.17.4` and
  `mypy==2.4.1`.
- `pyproject.toml` sets `line-length = 88` and
  `target-version = "py312"` for ruff, enables the `E`, `F`, `W`, `I`, `B`,
  `UP`, `SIM`, `BLE` and `RUF` rule families, and configures mypy with
  `python_version = "3.12"`, `check_untyped_defs`, `ignore_missing_imports` (the
  `garminconnect` package ships no stubs) and the warning flags.
- Test discovery is limited to `test_app.py` so the virtualenv is never walked.

### Code changes required by the gates

- Remove `# noqa: BLE001` comments that ruff reports as unused; every handler
  either re-raises or returns, so the blind-except rule does not fire.
- Replace the unused loop variable in the strength-set timestamp mapping.
- Annotate the two mixed-value dicts (`str` date/timestamp plus numeric
  channels) so mypy does not infer a `dict[str, str]`.
- Apply `ruff format` to `app.py` and `test_app.py`, and unpack the lap lists in
  the lap test instead of concatenating them.

## Data-model and API impact

None. The sidecar's HTTP contract and stored data are unchanged.

## Acceptance criteria

- `bun run check:garmin` passes on `main` and fails non-zero when a test, lint
  rule, formatting check or type check fails.
- CI has a `garmin` job that runs the same script on every pull request and push
  to `main`.
- `services/garmin/README.md` documents the command.
- The pinned tool versions are the only source of truth for the checks.
