import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SignInPage } from "./SignInPage";

describe("SignInPage", () => {
  it("explains what the app does before signing in", () => {
    const html = renderToStaticMarkup(<SignInPage onSignIn={() => {}} />);

    expect(html).toContain('data-testid="sign-in-page"');
    expect(html).toContain("AI training coach");
    expect(html).toContain("plans your season, block, week and today");
    expect(html).toContain("Your Garmin");
    expect(html).toContain("forecast");
  });

  it("offers the sign-in action", () => {
    const html = renderToStaticMarkup(<SignInPage onSignIn={() => {}} />);

    expect(html).toContain(">Sign in</button>");
    expect(html).toContain("OpenRouter API key");
  });

  it("lists what the coach covers", () => {
    const html = renderToStaticMarkup(<SignInPage onSignIn={() => {}} />);

    expect(html).toContain("How it works");
    expect(html).toContain("Today, decided");
    expect(html).toContain("A plan at every level");
    expect(html).toContain("Built around real life");
    expect(html).toContain("Reviewed, then revised");
  });
});
