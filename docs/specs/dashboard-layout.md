# Dashboard layout and navigation

## Goal

Keep the signed-in experience compact and task-focused: a slim horizontal
header, outstanding activities, the plan, and the inputs that shape it.

## Header

- One row with the app name, byline, a status spinner, and the signed-in user.
- The app name is an underline-free link back to the coaching dashboard.
- The account menu is opened from a visible hamburger button. The user's first
  name, optional round avatar, `Admin` badge, and the status spinner sit next to
  the hamburger icon, not inside the menu.
- The menu links to the coaching dashboard, activities, coaching survey,
  settings, admin settings (admins only), and sign out.
- The spinner reports `loading`, `syncing`, or `thinking` across any page.

## Main coaching page

1. **Activities awaiting attention** — completed activities that have neither a
   comment nor a `No comment` acknowledgement. Commenting on an activity keeps
   it in place for the rest of the visit; the next page load drops it because it
   now has a response.
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
manual activities. It offers manual entry, sync / re-analyse, comments and
comment editing, and delete. Every activity card on this page and the main page
has a delete action.

`No comment` records an acknowledgement in `activity_reviews`, which is a UI
concern only and does not affect plan staleness.

## Settings page

Configures the display time zone, Garmin credentials, OpenRouter (API key and
model), and a forced plan regeneration. The time zone is an IANA zone stored on
the account; leaving it unset follows the device's zone. Activity timestamps and
plan generation times are displayed in that local zone, and outgoing coaching
requests send it to the API.

## Coaching survey page

Explains that thorough answers directly influence the training plan, lists the
athlete's answers with an inline editor. Forced plan regeneration lives on the
coaching survey and settings pages, not the dashboard.

## Activity summaries

The coach summary is brief (2–3 sentences), includes how the activity fit the
plan as part of the summary rather than a separate section, is encouraging when
the activity reasonably conformed, and is direct about improvements. Cards do
not show the generating model or the number of recorded samples. Activity types
are shown in natural language (`indoor_cycling` becomes `Indoor cycling`) in
cards and weekly-plan descriptions. Duration is **elapsed** time, not moving
time, so indoor activities report their real elapsed duration. Distance and
climb are omitted when zero.

When an activity has GPS positions, a compact route map on an OpenStreetMap
background (with attribution) is shown next to the coach analysis. Activities
without position data (for example indoor sessions) show no map. The comment box
has no separate "Add a comment" heading; its placeholder and accessible label
describe it.

Times are shown in the athlete's chosen local zone without appending a time-zone
identifier. When Garmin or OpenRouter is not configured, the plan and activities
pages show an "Open settings" action that takes the athlete directly to the
Settings page.

A manually logged activity has only a date and free text, so the weekly plan
labels it `Logged manually` instead of inventing a duration such as one minute.
