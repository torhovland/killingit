interface SignInPageProps {
  onSignIn: () => void;
}

const HIGHLIGHTS = [
  {
    title: "Today, decided",
    body: "Open the app to a suggested workout or rest day, sometimes with alternatives, and the coach's reasoning. Steer it with a note before you start.",
  },
  {
    title: "A plan at every level",
    body: "Season, block, week and day stay in sync, so every session has a purpose in the bigger picture.",
  },
  {
    title: "Built around real life",
    body: "Your Garmin activities, recovery data, the forecast and daylight at your location all shape the next session.",
  },
  {
    title: "Reviewed, then revised",
    body: "Every workout is analysed against the plan, completed weeks and blocks get a review, and your input regenerates what follows.",
  },
] as const;

/**
 * Landing page for a visitor who is not signed in. Presentational so the
 * sign-in state stays in `App` and the page can be tested with static markup.
 */
export function SignInPage({ onSignIn }: SignInPageProps) {
  return (
    <main
      className="flex w-full flex-col gap-10 py-8 sm:py-14"
      data-testid="sign-in-page"
    >
      <section className="flex flex-col items-center gap-5 text-center">
        <p className="rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-sm font-medium text-primary">
          Your AI training coach
        </p>
        <h1 className="max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl">
          Training that thinks ahead.
        </h1>
        <p className="max-w-2xl text-lg text-muted-foreground">
          Killing It is an AI coach that plans your season, block, week and
          today, then adjusts them as your training, recovery and the weather
          change. You get one clear session to do next — and a coach who can
          explain why.
        </p>
        <button
          className="rounded border border-transparent bg-primary px-6 py-2.5 text-lg font-medium text-primary-foreground enabled:hover:bg-primary-hover"
          onClick={onSignIn}
        >
          Sign in
        </button>
        <p className="max-w-xl text-sm text-muted-foreground">
          Sign in, connect your training data, and add your own OpenRouter API
          key. Your coach takes it from there.
        </p>
      </section>

      <section aria-labelledby="how-it-works">
        <h2
          id="how-it-works"
          className="mb-4 text-center text-2xl font-semibold"
        >
          How it works
        </h2>
        <ul className="grid gap-4 sm:grid-cols-2">
          {HIGHLIGHTS.map((highlight) => (
            <li
              key={highlight.title}
              className="flex flex-col gap-2 rounded-lg border bg-card p-4 text-left"
            >
              <h3 className="text-lg font-medium">{highlight.title}</h3>
              <p className="text-base text-muted-foreground">
                {highlight.body}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <p className="text-center text-base text-muted-foreground">
        Bring your own training data and model. Killing It does the coaching.
      </p>
    </main>
  );
}
