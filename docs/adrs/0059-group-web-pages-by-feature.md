# ADR 0059: Group web pages by feature

- **Status:** Accepted
- **Date:** 2026-11-15
- **Deciders:** torhovland
- **Related:** `docs/specs/web-component-library.md`,
  `docs/adrs/0027-own-tailwind-primitives.md`,
  `docs/adrs/0047-page-sections-in-a-named-directory.md`, issue #329,
  issue #420, issue #492

## Context

`apps/web/src/` held roughly 190 flat entries: every page, its sections, its
single-page hooks and its helpers sat in one directory beside shared modules.
ADR 0027 kept page components flat to distinguish them from the shared
primitives in `components/`, and ADR 0047 allowed one page's sections to move
into a named directory. That worked while the app was small, but a reader now
has to know which of the flat names belong to the Calendar page, which to
Fitness, Diet, Settings or Admin, and which are cross-page.

Issue #329 separated the current user from the app shell and asked for the file
grouping afterwards. The provider half landed in ADR 0052; the move is tracked
in issue #420 so the behaviour change and the mechanical rename stay apart.

## Decision

- Give each page or feature its own directory in `apps/web/src/`: `calendar/`,
  `fitness/`, `diet/`, `settings/`, `admin/`, `plan/`, `costs/` and
  `activities/`. A directory holds the page or feature component, its own
  sections, its single-page helpers and their tests; the coaching dashboard's
  plan section, its shell, provider and hooks all live in `plan/`, and the
  activity page, cards and feed hooks live in `activities/` even though the
  dashboard renders the pending activity section.
- Keep shared primitives in `components/`. Keep the shared chart frame,
  geometry and keyboard and hover hooks in `charts/`, and the model picker's
  own sections in `llm/` as ADR 0047 established.
- Keep pieces used across pages at the root: `TrainingLoadLine`,
  `CalorieBalancePanel`, `mapProjection`, the current-user provider, the
  time-zone and PWA contexts, routing, authentication and the app shell. The
  plan generation provider is mounted by the shell but owns the plan feature's
  state, so it lives in `plan/` beside the section and hooks that read it.
- Move files with a pure rename plus import updates. Do not combine a move with
  a behaviour change.
- Update AGENTS.md and `docs/specs/web-component-library.md` when a directory
  lands so new files are created in the right home.

## Alternatives considered

- **Keep everything flat.** Rejected: the flat directory no longer shows which
  page owns a module, and the current-user work already removed the last reason
  the shell had to own page state.
- **Move every page into `app/`.** Rejected: it recreates the flat directory
  one level down without naming a feature.
- **Group by layer (`pages/`, `hooks/`, `helpers/`).** Rejected: a change to one
  page would still span three directories, and the repositories' specs describe
  behaviour per page rather than per layer.
- **Move the cross-page components into `components/`.** Rejected: they are not
  primitives and several are page-specific compositions; `components/` stays
  the shared control surface.

## Consequences

- A page's files are found from its feature name, and its tests sit beside it.
- The cross-page modules are the deliberate exception and are listed in the
  component-library spec, so a new file has an obvious home.
- The move produces large but mechanical diffs; each feature directory can land
  as its own rename-only pull request.
- ADR 0027's "page components stay flat" rule and ADR 0047's assumption that
  `LlmSection` stays at the root are superseded for file placement, while both
  decisions about primitives and section splits still hold.
