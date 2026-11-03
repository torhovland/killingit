import { useEffect, useState } from "react";
import { useAuth } from "./auth";
import { DangerIcon } from "./DangerIcon";
import { fetchJsonAuthed } from "./fetchAuthed";
import { reportError } from "./reportError";

const API_URL = import.meta.env.VITE_API_URL ?? "";

const DANGER_BUTTON =
  "inline-flex items-center gap-2 rounded border border-destructive px-4 py-2 text-base text-destructive enabled:hover:bg-destructive/10 disabled:opacity-50";
const CONFIRM_BUTTON =
  "rounded border border-destructive bg-destructive/15 px-4 py-2 text-base font-medium text-destructive enabled:hover:bg-destructive/25 disabled:opacity-50";
const SECONDARY_BUTTON =
  "rounded border bg-card px-4 py-2 text-base enabled:hover:bg-muted disabled:opacity-50";

/**
 * Permanent account deletion. The API removes the account row and, through the
 * schema's cascades, every plan, activity, connection, and coach message that
 * belongs to it. Signing out afterwards stops the still-valid token from
 * provisioning a fresh account.
 */
export function DeleteAccountSection() {
  const auth = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function deleteAccount(): Promise<void> {
    setDeleting(true);
    setError(null);
    try {
      await fetchJsonAuthed<unknown>(`${API_URL}/api/me`, auth, {
        method: "DELETE",
      });
      setConfirming(false);
      await auth.logout();
    } catch (err: unknown) {
      setError(reportError(err));
      setDeleting(false);
    }
  }

  return (
    <DeleteAccountSectionView
      confirming={confirming}
      deleting={deleting}
      error={error}
      onOpen={() => {
        setError(null);
        setConfirming(true);
      }}
      onCancel={() => {
        if (!deleting) {
          setConfirming(false);
        }
      }}
      onConfirm={() => void deleteAccount()}
    />
  );
}

interface DeleteAccountSectionViewProps {
  confirming: boolean;
  deleting: boolean;
  error: string | null;
  onOpen: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}

/** Pure presentation, so both the section and its warning can be tested. */
export function DeleteAccountSectionView({
  confirming,
  deleting,
  error,
  onOpen,
  onCancel,
  onConfirm,
}: DeleteAccountSectionViewProps) {
  useEffect(() => {
    if (!confirming) {
      return;
    }
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !deleting) {
        onCancel();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [confirming, deleting, onCancel]);

  return (
    <>
      <section
        className="flex flex-col gap-3 rounded-lg border border-destructive/40 bg-card p-4"
        data-testid="delete-account-section"
      >
        <h3 className="text-2xl font-semibold">Delete account</h3>
        <p className="text-base text-muted-foreground">
          Permanently delete your account and all of your coaching data. This
          cannot be undone.
        </p>
        <button
          type="button"
          className={`self-start ${DANGER_BUTTON}`}
          onClick={onOpen}
          data-testid="delete-account-button"
        >
          <DangerIcon />
          Delete account
        </button>
        {error && !confirming && (
          <p className="text-base text-destructive">Error: {error}</p>
        )}
      </section>

      {confirming && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-3"
          role="presentation"
          onClick={onCancel}
        >
          <div
            className="w-full max-w-md rounded-lg border bg-card p-4 shadow-lg"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-account-title"
            onClick={(event) => event.stopPropagation()}
            data-testid="delete-account-dialog"
          >
            <h3
              id="delete-account-title"
              className="flex items-center gap-2 text-xl font-semibold text-destructive"
            >
              <DangerIcon />
              Delete your account?
            </h3>
            <p className="mt-2 text-base">
              This permanently deletes your account and everything associated
              with it: your profile, training plans, synced and manual
              activities, connections, and coach history. This cannot be undone.
            </p>
            {error && (
              <p className="mt-2 text-base text-destructive">Error: {error}</p>
            )}
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                className={SECONDARY_BUTTON}
                onClick={onCancel}
                disabled={deleting}
                autoFocus
              >
                Cancel
              </button>
              <button
                type="button"
                className={CONFIRM_BUTTON}
                onClick={onConfirm}
                disabled={deleting}
                data-testid="delete-account-confirm"
              >
                {deleting ? "Deleting…" : "Delete everything"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
