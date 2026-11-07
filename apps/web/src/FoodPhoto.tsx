import { useEffect, useState } from "react";
import { useAuth } from "./auth";
import { fetchFileAuthed } from "./fetchAuthed";

const API_URL = import.meta.env.VITE_API_URL ?? "";

/**
 * A meal photo fetched with the athlete's bearer token. The photo endpoint is
 * authenticated, so an `<img src>` cannot load it directly; the object URL is
 * revoked when the card leaves the page.
 */
export function FoodPhoto({
  entryId,
  alt,
  className,
}: {
  entryId: number;
  alt: string;
  className?: string;
}) {
  const auth = useAuth();
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    const controller = new AbortController();
    void fetchFileAuthed(`${API_URL}/api/diet/entries/${entryId}/photo`, auth, {
      signal: controller.signal,
    })
      .then((file) => {
        if (!active) {
          return;
        }
        objectUrl = URL.createObjectURL(file.blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        // A missing thumbnail must not break the meal card.
      });
    return () => {
      active = false;
      controller.abort();
      if (objectUrl !== null) {
        URL.revokeObjectURL(objectUrl);
      }
    };
    // Only the entry and sign-in state select the photo; `auth` is consumed
    // inside and is not a stable dependency.
  }, [entryId, auth.isAuthenticated]);

  if (url === null) {
    return null;
  }
  return <img src={url} alt={alt} className={className} />;
}
