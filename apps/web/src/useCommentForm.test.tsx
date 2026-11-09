import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { useCommentForm, type CommentFormOptions } from "./useCommentForm";

function render(options: CommentFormOptions): string {
  function Probe() {
    const form = useCommentForm(options);
    return (
      <p>
        <span data-testid="comment">{form.shownComment ?? "none"}</span>
        <span data-testid="reply">{form.shownReply ?? "none"}</span>
        <span data-testid="draft">{form.comment}</span>
        <span data-testid="editing">{String(form.editing)}</span>
        <span data-testid="dismissible">{String(form.canDismiss)}</span>
        <span data-testid="submitting">{String(form.submitting)}</span>
        <span data-testid="dismissing">{String(form.dismissing)}</span>
        <span data-testid="error">{form.error ?? "none"}</span>
      </p>
    );
  }
  return renderToStaticMarkup(<Probe />);
}

describe("useCommentForm", () => {
  it("starts with empty draft state and shows the stored comment and reply", () => {
    const html = render({
      storedComment: "Felt strong on the hills.",
      storedReply: "Good work; keep Thursday easy.",
      onSubmit: () => Promise.resolve(null),
      dismissErrorMessage: "Could not mark the activity",
    });

    expect(html).toContain('data-testid="comment">Felt strong on the hills.');
    expect(html).toContain(
      'data-testid="reply">Good work; keep Thursday easy.',
    );
    expect(html).toContain('data-testid="draft"></span>');
    expect(html).toContain('data-testid="editing">false');
    expect(html).toContain('data-testid="dismissible">false');
    expect(html).toContain('data-testid="submitting">false');
    expect(html).toContain('data-testid="dismissing">false');
    expect(html).toContain('data-testid="error">none');
  });

  it("has no comment or reply before one is saved", () => {
    const html = render({
      storedComment: null,
      storedReply: null,
      onSubmit: () => Promise.resolve(null),
      dismissErrorMessage: "Could not mark the review",
    });

    expect(html).toContain('data-testid="comment">none');
    expect(html).toContain('data-testid="reply">none');
  });

  it("offers dismissal only when a dismiss handler is provided", () => {
    const withDismiss = render({
      storedComment: null,
      storedReply: null,
      onSubmit: () => Promise.resolve(null),
      onDismiss: () => Promise.resolve(),
      dismissErrorMessage: "Could not mark the activity",
    });
    const withoutDismiss = render({
      storedComment: null,
      storedReply: null,
      onSubmit: () => Promise.resolve(null),
      dismissErrorMessage: "Could not mark the activity",
    });

    expect(withDismiss).toContain('data-testid="dismissible">true');
    expect(withoutDismiss).toContain('data-testid="dismissible">false');
  });
});
