# ADR 0022: Source-available licence with a non-commercial grant

- **Status:** Accepted
- **Date:** 2026-11-07
- **Deciders:** torhovland

## Context

The repository is public and has no licence file, which under default copyright
law means nobody may copy, modify, or redistribute it at all. The intent is
narrower and more useful: let people read the code, learn from it, run it for
themselves, and use it for hobby and non-commercial purposes, while preventing
anyone from shipping a commercial product built on it.

Two constraints shape the choice:

1. The maintainer must keep the ability to grant a commercial licence later, to
   relicense future versions, and to assign the copyright if the project is
   ever sold. A copyleft licence would still allow dual licensing, but only if
   every contributor assigns or grants enough rights — so the contribution
   terms matter as much as the licence text.
2. Attribution should be required. Credit is the consideration for making the
   source public.

## Decision

License the repository under the **PolyForm Noncommercial License 1.0.0**
(`PolyForm-Noncommercial-1.0.0`), a short software-specific licence with a
copyright grant, a distribution grant, a changes-and-new-works grant, a patent
grant, a 32-day cure period for accidental violations, and explicit permitted
cases for personal and non-commercial-organization use.

- `LICENSE.md` carries the licence text and the binding credit line:
  `Required Notice: Copyright (c) 2026 Tor Hovland`.
- Every `package.json` declares `"license": "PolyForm-Noncommercial-1.0.0"`.
- `README.md` states the licence and the required attribution in one short
  section, so a visitor does not mistake the project for open source.
- `CONTRIBUTING.md` requires a `Signed-off-by` trailer and a one-time copyright
  assignment (with a broad fallback licence for rights that cannot be assigned)
  before a first contribution is merged.
- The licence is non-exclusive. The `No Other Rights` section states that the
  terms do not prevent the licensor from granting licences to anyone else, so
  commercial licensing, relicensing, and assignment stay available.

### Why attribution uses the Required Notice mechanism

An "attribution requirement" bolted onto the licence as an extra condition
would no longer be PolyForm 1.0.0, would break SPDX short-identifier matching,
and would make the permission harder to reason about for anyone doing a
compliance review. The licence already makes a notice line binding: the
`Notices` section obliges anyone distributing the software to pass on the
licence terms or their URL **and** any `Required Notice:` lines. Putting the
credit in that line gives a real, enforceable attribution duty inside the
licence's own machinery, with no amendment. `CONTRIBUTING.md` spells out the
exact string and where it must survive.

Displaying the credit inside the running app is not required by the licence and
is left as an optional product nicety.

## Alternatives considered

- **Creative Commons BY-NC 4.0 / BY-NC-SA 4.0.** Best-known non-commercial
  licences, but Creative Commons advises against using them for software: no
  patent grant, no distribution or source-code terms, and a vaguer
  "primarily intended for commercial advantage" test. BY-NC-SA adds an awkward
  copyleft obligation for linked code.
- **Prosperity Public License 3.0.0.** Fits the goal and adds a 30-day
  commercial trial plus a paid-licence path, but it presupposes running a
  licence-sales process. Kept as the upgrade path if commercial licensing
  becomes a real business rather than a safeguard.
- **Business Source License 1.1.** Corporate-legible and time-boxed, but each
  release needs its own Change Date and Change License, and its trigger is
  "production use" rather than "commercial use". Too much machinery here.
- **Elastic License 2.0 / Functional Source License 1.1.** Rejected: both
  permit commercial use and only block competing use or a managed service,
  which is not the intent.
- **A custom proprietary licence.** Can say exactly what is meant, but needs a
  lawyer, has no tooling recognition, and is read narrowly when tested.
- **AGPL-3.0 plus a commercial licence.** The conventional dual-licensing
  model, and genuinely open source, but it does not forbid commercial use: it
  only obliges a commercial service to publish its source. It also makes some
  corporate legal teams refuse the project outright.

## Consequences

- The project is **source-available, not open source**. It cannot be described
  as open source, and it is excluded from most distributions, package-manager
  policies, and corporate dependency allowlists.
- Commercial use is forbidden, including internal use by a for-profit business.
  The boundary cases ("is this hobby project commercial?") are narrower than
  with Creative Commons but still a matter of judgement at the edges.
- Grants already made cannot be revoked. Anything published under this licence
  stays usable non-commercially forever, so a later switch to a permissive or
  proprietary licence applies only to future versions. A purchaser of the
  project inherits that, which is worth disclosing in any sale.
- Contributions require an assignment. Without one, relicensing and assignment
  become impossible, so external pull requests must not be merged until the
  statement in `CONTRIBUTING.md` is in place. A CI job checks the `Signed-off-by`
  trailer that goes with it, exempting the copyright holder's own commits.
- Third-party dependencies keep their own licences and cannot be relicensed;
  their notices must keep shipping with the build. The web build now emits
  `third-party-licenses.txt` at the site root from the packages it actually
  loads, so the notices travel with the deployed app. See
  `docs/specs/third-party-notices.md`.
- No trademark rights are granted, so the project name and logo stay reserved.
- Enforcement is a cost, not a given. The licence is a speed bump that has to be
  defended to mean anything.

## Revisit when

- Commercial licensing turns into a product, in which case switch to the
  Prosperity licence so the trial-and-purchase path is in the licence itself.
- The project wants contributors who can only contribute to open-source
  software, in which case the choice is between losing those contributions and
  moving to AGPL-3.0 with a commercial licence.
