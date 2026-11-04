# Spec: Signed-out landing page

- **Status:** Accepted (implemented)
- **Date:** 2026-11-04

## Goal

A visitor who is not signed in should understand what the app does and why it
is worth signing in to, instead of seeing only a bare sign-in button.

## Scope

- The signed-out view in `apps/web/src/App.tsx` renders `SignInPage`.
- The page explains the product briefly: the AI coach plans the season, block,
  week and today, adapts to training, recovery, weather and daylight, and
  reviews completed work.
- It keeps one prominent `Sign in` action, plus a short note that the athlete
  connects Garmin and supplies their own OpenRouter API key.
- The existing header, install action, and offline/update banners stay as they
  are.

## Acceptance criteria

1. When the Auth0 session resolves to signed out, the app shows the landing
   page rather than a lone button.
2. The page has one `h1`, a short product explanation, at least one `Sign in`
   button that calls the existing login action, and a list of what the coach
   covers.
3. While the session is still loading, the app still shows `Loading…` and never
   flashes the landing page.
4. Styling uses only the existing tokens and Tailwind utilities; no new colors
   or inline styles.
5. `SignInPage` is presentational (`onSignIn` prop) and unit-tested with static
   markup.

## Out of scope

- Marketing pages, pricing, or a public feature tour.
- Sign-up restrictions or invite handling.
- Changes to the auth flow itself (see `docs/specs/auth-integration.md`).
