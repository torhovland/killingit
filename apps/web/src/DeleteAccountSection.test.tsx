import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DeleteAccountSectionView } from "./DeleteAccountSection";

function render({
  confirming = false,
  deleting = false,
  error = null,
}: {
  confirming?: boolean;
  deleting?: boolean;
  error?: string | null;
}): string {
  return renderToStaticMarkup(
    <DeleteAccountSectionView
      confirming={confirming}
      deleting={deleting}
      error={error}
      onOpen={() => undefined}
      onCancel={() => undefined}
      onConfirm={() => undefined}
    />,
  );
}

describe("DeleteAccountSectionView", () => {
  it("shows a red-outlined delete button with a danger icon", () => {
    const html = render({});

    expect(html).toContain("Delete account");
    expect(html).toContain('data-testid="delete-account-button"');
    expect(html).toContain('data-testid="danger-icon"');
    expect(html).toContain("border-destructive");
    expect(html).not.toContain('data-testid="delete-account-dialog"');
  });

  it("warns what will be deleted before confirming", () => {
    const html = render({ confirming: true });

    expect(html).toContain('role="dialog"');
    expect(html).toContain("Delete your account?");
    expect(html).toContain("permanently deletes your account");
    expect(html).toContain("cannot be undone");
    expect(html).toContain("Cancel");
    expect(html).toContain('data-testid="delete-account-confirm"');
  });

  it("disables both dialog actions while deletion is running", () => {
    const html = render({ confirming: true, deleting: true });

    expect(html).toContain("Deleting…");
    expect(html.match(/ disabled=""/g)).toHaveLength(2);
  });

  it("shows a failed deletion inside the dialog", () => {
    const html = render({ confirming: true, error: "The API is unavailable" });

    expect(html).toContain("Error: The API is unavailable");
    expect(html).toContain('data-testid="delete-account-dialog"');
  });
});
