# Spec: Third-party licence notices in the web build

- **Status:** Accepted (implemented)
- **Date:** 2026-11-07
- **Related:** `LICENSE.md`, `docs/adrs/0022-source-available-noncommercial-license.md`,
  `apps/web/notices/third-party-notices.ts`

## Goal

Ship the licence notices of every dependency the web app bundles. The deployed
build is the code that reaches other people's browsers, and most of the
dependencies in it (MIT, Apache-2.0) require their copyright notice and
permission text to travel with copies of the software. Until now the build
inlined them into `dist/assets/*.js` and shipped no notices.

## Scope

### In scope

1. The Vite build emits `dist/third-party-licenses.txt` at the site root. It
   opens with the app's own terms and the Required Notice line, then reproduces
   each dependency's licence text in full.
2. The package list comes from the build's module graph, then follows each
   included package's declared `dependencies`. The second step exists because a
   published package can contain another package's code in its own dist file:
   `@auth0/auth0-react` ships `auth0-spa-js` that way, and no bundler metadata
   shows it. Following the manifests can list a package that tree-shaking
   dropped; over-reporting a licence is the safe direction.
3. Bun's isolated install puts a package and its dependencies under
   `node_modules/.bun/`, so the walk finds the owning `package.json` rather than
   assuming a flat layout. Nested marker manifests (`{"type": "module"}`, as
   Sentry and zod ship) are skipped because they name no package.
4. `LICENSE`/`LICENCE` wins over `COPYING` and `NOTICE` when a package ships
   several, so the terms are included rather than only the attribution line. A
   package with no licence file still appears, with its declared identifier and
   a note, and the build warns.
5. The Settings page links to `/third-party-licenses.txt` so a user can reach
   the file, and the PWA precaches it with the rest of the static build.

### Out of scope

- The API bundle. It is built and run by the operator of the deployment, not
  handed to third parties, and its dependencies are covered by the same
  manifests in the repository.
- Fonts and other assets that are copied rather than bundled.
  `apps/web/public/fonts/OFL.txt` already ships beside Space Grotesk, which is
  what the OFL requires.
- Gating the build on missing notices. A dependency without a licence file is
  reported as a build warning instead, because failing the build would block
  every unrelated change on a third party's packaging mistake.

## Why this shape

The notices must describe what is actually in the bundle, not everything in
`package.json`. Walking the declared `dependencies` of the whole workspace would
pull in build tooling such as `@sentry/vite-plugin` and its tree, which never
reaches a browser. Starting from the module graph keeps the file about shipped
code, and the dependency closure closes the gap where one package embeds
another.

Generating the file at build time keeps it truthful: a dependency update or a
removal changes the notices with no separate step to remember, and nothing
stale can be committed.

## Acceptance criteria

1. `bun run build` in `apps/web` writes `dist/third-party-licenses.txt`
   containing the Required Notice line and one section per bundled package.
2. Every package the bundle actually contains is listed, including one that
   only arrives inside another package's dist file.
3. A package with no licence file appears with its declared identifier and is
   reported as a build warning.
4. The file is reachable at `/third-party-licenses.txt` in a deployed build and
   is listed in the generated `sw.js` precache.
5. `apps/web/notices/third-party-notices.test.ts` covers package discovery,
   dependency following, licence-file preference, deduplication, and rendering.
