import { useEffect, useState } from "react";
import { useAuth } from "./auth";
import { Button } from "./components/Button";
import { Card } from "./components/Card";
import { DangerIcon } from "./DangerIcon";
import { fetchJsonAuthed } from "./fetchAuthed";
import { reportError } from "./reportError";

const API_URL = import.meta.env.VITE_API_URL ?? "";

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
      <Card
        as="section"
        className="flex flex-col gap-3 border-destructive/40"
        data-testid="delete-account-section"
      >
        <h3 className="text-2xl font-semibold">Delete account</h3>
        <p className="text-base text-muted-foreground">
          Permanently delete your account and all of your coaching data. This
          cannot be undone.
        </p>
        <Button
          variant="danger"
          size="lg"
          className="inline-flex items-center gap-2 self-start border-destructive"
          onClick={onOpen}
          data-testid="delete-account-button"
        >
          <DangerIcon />
          Delete account
        </Button>
        {error && !confirming && (
          <p className="text-base text-destructive">Error: {error}</p>
        )}
      </Card>

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
              <Button
                variant="secondary"
                size="lg"
                onClick={onCancel}
                disabled={deleting}
                autoFocus
              >
                Cancel
              </Button>
              <Button
                variant="dangerStrong"
                size="lg"
                className="font-medium"
                onClick={onConfirm}
                disabled={deleting}
                data-testid="delete-account-confirm"
              >
                {deleting ? "Deleting…" : "Delete everything"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
