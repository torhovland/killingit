# Dashboard layout and navigation

## Goal

Keep the signed-in experience compact and task-focused: a slim horizontal
header, outstanding activities, the plan, and the inputs that shape it.

## Header

- One row with the app name, byline, a status spinner, and the signed-in user.
- The user shows their first name, an optional round avatar, and an `Admin`
  badge for administrators.
- A dropdown on the user links to the coaching dashboard, activities, coaching
  survey, settings, admin settings (admins only), and sign out.
- The spinner reports `loading`, `syncing`, or `thinking` across any page.

## Main coaching page

1. **Activities awaiting attention** — completed activities that have neither a
   comment nor a `No comment` acknowledgement.
2. **Plan** — a tabbed view with `Day`, `Week`, `Block`, and `Season`. `Day` is
   selected by default and shows today plus tomorrow after 18:00.
3. **Coaching inputs** — the weekly note and a by-the-way question.

### Weekly note

The weekly note is for requests and additional information that should
influence the training plan. Saving it starts a plan revision.

### By the way

The by-the-way question is a one-off conversation with the coach. The question
and answer are not stored and never trigger or influence plan generation
(`POST /api/coaching/questions`).

## Activities page

Lists every imported Garmin activity (up to the API limit) and the athlete's
manual activities. It offers manual entry, sync / re-analyse, comments, and
delete. Every activity card on this page and the main page has a delete action.

`No comment` records an acknowledgement in `activity_reviews`, which is a UI
concern only and does not affect plan staleness.

## Settings page

Configures Garmin credentials, OpenRouter (API key and model), and a forced plan
regeneration.

## Coaching survey page

Explains that thorough answers directly influence the training plan, lists the
athlete's answers with an inline editor, and offers a plan regeneration button.

## Activity summaries

The coach summary is brief (2–3 sentences), includes how the activity fit the
plan as part of the summary rather than a separate section, is encouraging when
the activity reasonably conformed, and is direct about improvements. Cards do
not show the generating model or the number of recorded samples.
