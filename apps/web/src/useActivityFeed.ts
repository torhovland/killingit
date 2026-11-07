import { useCallback, useEffect, useRef, useState } from "react";
import {
  analyzedActivitiesResponseSchema,
  coachingInputSaveResponseSchema,
  type AnalyzedActivitiesResponse,
} from "@killingit/shared";
import {
  loadCachedActivities,
  markActivityReviewed,
  mergeActivityFeeds,
  removeActivity,
  saveCachedActivities,
  updateActivityComment,
} from "./activityCache";
import { useBusyReporter } from "./AppStatus";
import type { AuthState } from "./auth";
import { parseCoachingSaveResponse } from "./coachingSave";
import { fetchJsonAuthed } from "./fetchAuthed";
import { reportError } from "./reportError";
import { getToday } from "./useToday";

const API_URL = import.meta.env.VITE_API_URL ?? "";

export interface ActivityFeedState {
  /** The feed on screen, seeded from the per-account browser cache. */
  data: AnalyzedActivitiesResponse | null;
  /** Whether a live feed load is running. */
  syncing: boolean;
  error: string | null;
  /** Increments when the feed changes enough to refresh the plan. */
  revision: number;
  /** Activities commented on during this visit, when `keepAnswered` is set. */
  keptActivityIds: ReadonlySet<string>;
  /** Whether a saved comment is still waiting for the coach's reply. */
  awaitingReplies: boolean;
  loadAnalyses: (refresh?: boolean) => Promise<void>;
  loadCached: () => Promise<void>;
  deleteActivity: (activityId: string) => Promise<void>;
  submitComment: (
    activityId: string,
    comment: string,
    mode: "create" | "edit",
  ) => Promise<string | null>;
  markNoComment: (activityId: string) => Promise<void>;
}

/**
 * The activity feed shared by the coaching dashboard and the Activities page:
 * browser and server caches, live sync, comments, deletions, and the visited
 * set that keeps an answered activity on the dashboard for the visit.
 */
export function useActivityFeed(
  auth: AuthState,
  timeZone: string,
  { keepAnswered = false }: { keepAnswered?: boolean } = {},
): ActivityFeedState {
  const reportCommentSave = useBusyReporter("comment-save");
  // Async work outlives a render; keep the latest account id and feed in refs
  // so a cache write after a request settles uses the real `sub` and a poll
  // merges into what is actually on screen.
  const authSub = useRef(auth.sub);
  authSub.current = auth.sub;
  const [data, setData] = useState<AnalyzedActivitiesResponse | null>(() =>
    loadCachedActivities(auth.sub),
  );
  const dataRef = useRef(data);
  dataRef.current = data;
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [keptActivityIds, setKeptActivityIds] = useState<ReadonlySet<string>>(
    new Set(),
  );

  const applyFeed = useCallback((next: AnalyzedActivitiesResponse): void => {
    dataRef.current = next;
    setData(next);
    saveCachedActivities(authSub.current, next);
  }, []);

  // Auth0 can report an authenticated session before it exposes `user.sub`.
  // Pick up the cache again once the account id is known.
  useEffect(() => {
    if (dataRef.current !== null) {
      return;
    }
    const cached = loadCachedActivities(auth.sub);
    if (cached !== null) {
      dataRef.current = cached;
      setData(cached);
    }
  }, [auth.sub]);

  const loadCached = useCallback(async (): Promise<void> => {
    try {
      const res = await fetchJsonAuthed<unknown>(
        `${API_URL}/api/coaching/activities/cached`,
        auth,
      );
      const parsed = analyzedActivitiesResponseSchema.safeParse(res);
      if (!parsed.success || parsed.data.activities.length === 0) {
        return;
      }
      applyFeed(mergeActivityFeeds(dataRef.current, parsed.data));
    } catch (err: unknown) {
      // The live sync is still running; a missing server cache is not an error.
      console.error("Failed to load cached activities:", err);
    }
  }, [auth, applyFeed]);

  const loadAnalyses = useCallback(
    async (refresh = false): Promise<void> => {
      setSyncing(true);
      setError(null);
      try {
        const { today } = getToday(timeZone);
        const params = new URLSearchParams({ today, timezone: timeZone });
        if (refresh) {
          params.set("refresh", "true");
        }
        const res = await fetchJsonAuthed<unknown>(
          `${API_URL}/api/coaching/activities?${params.toString()}`,
          auth,
        );
        const parsed = analyzedActivitiesResponseSchema.safeParse(res);
        if (!parsed.success) {
          throw new Error("Coaching endpoint returned an unexpected response", {
            cause: parsed.error,
          });
        }
        applyFeed(parsed.data);
        setRevision((value) => value + 1);
      } catch (err: unknown) {
        setError(reportError(err));
      } finally {
        setSyncing(false);
      }
    },
    [auth, timeZone, applyFeed],
  );

  const deleteActivity = useCallback(
    async (activityId: string): Promise<void> => {
      const response = await fetchJsonAuthed<unknown>(
        `${API_URL}/api/coaching/activities/${activityId}?${coachingDateQuery(timeZone)}`,
        auth,
        { method: "DELETE" },
      );
      parseCoachingSaveResponse(response);
      const current = dataRef.current;
      if (current !== null) {
        applyFeed(removeActivity(current, activityId));
      }
      // Removing a day changes every later snapshot, so rebuild the feed.
      await loadAnalyses();
    },
    [auth, timeZone, applyFeed, loadAnalyses],
  );

  const submitComment = useCallback(
    async (
      activityId: string,
      comment: string,
      mode: "create" | "edit",
    ): Promise<string | null> => {
      reportCommentSave(true);
      try {
        const { today } = getToday(timeZone);
        const response = await fetchJsonAuthed<unknown>(
          `${API_URL}/api/coaching/activities/${activityId}/comments`,
          auth,
          {
            method: mode === "edit" ? "PUT" : "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              today,
              timezone: timeZone,
              activityDate: activityStartDate(
                dataRef.current,
                activityId,
                today,
              ),
              comment,
            }),
          },
        );
        const parsed = coachingInputSaveResponseSchema.safeParse(response);
        if (!parsed.success) {
          throw new Error(
            "Saving your comment returned an unexpected response",
            { cause: parsed.error },
          );
        }
        // Leave the activity in place for this visit. A reload only shows
        // activities without a response, so the commented activity drops off
        // then.
        if (keepAnswered) {
          setKeptActivityIds((current) => new Set(current).add(activityId));
        }
        const current = dataRef.current;
        if (current !== null) {
          applyFeed(
            updateActivityComment(
              current,
              activityId,
              comment,
              parsed.data.reply,
            ),
          );
        }
        setRevision((value) => value + 1);
        return parsed.data.reply?.text ?? null;
      } finally {
        reportCommentSave(false);
      }
    },
    [auth, timeZone, applyFeed, keepAnswered, reportCommentSave],
  );

  const markNoComment = useCallback(
    async (activityId: string): Promise<void> => {
      const response = await fetchJsonAuthed<unknown>(
        `${API_URL}/api/coaching/activities/${activityId}/reviewed`,
        auth,
        { method: "POST" },
      );
      parseCoachingSaveResponse(response);
      const current = dataRef.current;
      if (current !== null) {
        applyFeed(markActivityReviewed(current, activityId));
      }
    },
    [auth, applyFeed],
  );

  const awaitingReplies =
    data?.activities.some(
      (activity) => activity.comment !== null && activity.coachReply === null,
    ) ?? false;

  return {
    data,
    syncing,
    error,
    revision,
    keptActivityIds,
    awaitingReplies,
    loadAnalyses,
    loadCached,
    deleteActivity,
    submitComment,
    markNoComment,
  };
}

/** The `today` and `timezone` query the coaching mutations need. */
export function coachingDateQuery(timeZone: string): string {
  return new URLSearchParams({
    today: getToday(timeZone).today,
    timezone: timeZone,
  }).toString();
}

/** The activity's own date, falling back to today when it is not in the feed. */
function activityStartDate(
  feed: AnalyzedActivitiesResponse | null,
  activityId: string,
  fallback: string,
): string {
  const activity = feed?.activities.find(
    (entry) => String(entry.id) === activityId,
  );
  return (activity?.startDate ?? fallback).slice(0, 10);
}
