# Contributing

Thanks for wanting to improve the coach. This file covers how to propose a
change and the terms contributions are accepted under. The product vision, the
development methodology, and the quality bar are in [`AGENTS.md`](./AGENTS.md);
the licence itself is in [`LICENSE.md`](./LICENSE.md).

## Before you write code

- Open an issue first for anything larger than a bug fix or a typo. It saves you
  from building something that does not fit the product.
- Follow the methodology in `AGENTS.md`: tests first, one concern per change,
  and `bun run typecheck`, `bun run lint`, `bun run format`, and `bun run test`
  all passing locally.
- Keep the diff small. A change that touches unrelated files will be sent back.

## Licensing of contributions

This project is **source-available**, not open source: it is licensed under the
[PolyForm Noncommercial License 1.0.0](./LICENSE.md), which permits personal,
hobby, study, and non-commercial-organization use and forbids commercial use.
The licence is **non-exclusive**, and the maintainer keeps the right to grant
commercial licences, to relicense future versions, and to assign the copyright
(for example if the project is sold).

To keep that possible, contributions are accepted only with a Contributor
License Agreement. Without it a contribution would remain jointly owned by its
author, and the project could no longer be relicensed or conveyed as a whole.

### How to sign

1. Sign off every commit:

   ```sh
   git commit -s
   ```

   This adds a `Signed-off-by: Your Name <you@example.com>` trailer.

2. In the description of your **first** pull request, paste this statement
   verbatim, with your name filled in:

   > I have read `CONTRIBUTING.md` and I agree to these contribution terms. I
   > assign to Tor Hovland all copyright and related rights in this
   > contribution, and I confirm that I am its author or am otherwise
   > authorized to make this assignment. To the extent any right cannot be
   > assigned, I grant Tor Hovland an irrevocable, worldwide, royalty-free,
   > sublicensable, and transferable licence to use, modify, distribute,
   > sublicense, and relicense this contribution under any terms.

Once you have signed, later pull requests only need the sign-off. The assignment
transfers ownership to the maintainer; it does not change what everyone else may
do with your work, which stays under `LICENSE.md`.

If you contribute as part of your job, your employer may own the copyright. Get
their written permission before opening the pull request, and say so in the
description — the statement above must be true when you sign it.

### What not to contribute

- Code you did not write and cannot license, including AI-generated code from a
  source whose terms you cannot meet, and code copied from a repository with an
  incompatible or copyleft licence.
- Assets (images, fonts, sample data) without a licence that allows this use and
  redistribution. Say where each asset came from.

## Attribution

The licence requires credit to travel with the software. This is deliberate: the
project is public so it can be read and learned from, and the credit is the
trade.

### If you use, fork, or redistribute this code

The `Notices` section of the licence applies to you. You must pass on, to anyone
who receives a copy of any part of the software from you:

- a copy of [`LICENSE.md`](./LICENSE.md), or its URL
  (`https://polyformproject.org/licenses/noncommercial/1.0.0`), and
- the notice line exactly as it appears in `LICENSE.md`:

  ```text
  Required Notice: Copyright (c) 2026 Tor Hovland
  ```

Keep the line intact and keep it in a place a recipient will find it — the
licence file, an "About", "Credits", or "Third-party notices" screen, or a
`NOTICE` file that ships with the build. Do not remove it, reword it, or claim
the original work as your own. If you publish a modified version, say plainly
that it is modified and link back to
<https://github.com/torhovland/killingit>.

For repository forks, keeping `LICENSE.md` in place satisfies this.

### If you contribute

You keep the credit for your work: your authorship stays in the commit history,
and your sign-off stays attached to the commit. Contributions do not add a
second copyright holder to `LICENSE.md`, because the assignment above moves
ownership to the maintainer.

## Commercial use

Commercial use is not permitted under `LICENSE.md`. That includes running the
coach as a paid product or service, using it inside a for-profit business, or
building a commercial app on top of the code. Personal use, hobby projects,
study, and use by charities, schools, public research, public safety and health,
environmental, and government organizations are permitted — see the licence for
the exact scope.

If you want a commercial licence, open an issue titled "Commercial licence" and
describe what you intend to build.
