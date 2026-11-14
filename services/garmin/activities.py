"""Activity, sample, lap and strength-set normalization for `/sync`.

Garmin's activity summary, detail, splits and exercise-set payloads each use
their own field names and units. Everything here turns one of those payloads
into the shared app shape; `sync_activities` is the only function that talks to
the Garmin client. A failed optional fetch leaves that channel empty, while a
rate limit aborts the sync. See ADR 0058.
"""

from __future__ import annotations

import logging

from garminconnect.activity_details import parse_activity_detail_metrics

import auth
import values
from errors import RateLimitedError, UpstreamError, rate_limited

logger = logging.getLogger("garmin-sidecar")

# A strength session is normally a few dozen sets. The cap keeps an unusual
# payload from bloating the sync response and the prompt.
MAX_STRENGTH_SETS = 200

# A long ride can record dozens of auto-laps. The cap bounds the stored feed
# and the prompt without dropping the interval structure of a normal session.
MAX_LAPS = 100

# Step-counted sports report cadence per leg in Garmin's detail and legacy lap
# channels, while the app stores and displays total steps per minute. The
# markers mirror STEP_CADENCE_PATTERN in packages/shared/src/activity.ts,
# minus row and swim, whose stroke rate is already strokes per minute.
STEP_CADENCE_MARKERS = ("run", "jog", "walk", "hik")


def is_step_cadence(activity_type: str) -> bool:
    """Whether a Garmin type counts cadence per leg rather than per minute."""
    normalized = activity_type.lower()
    return any(marker in normalized for marker in STEP_CADENCE_MARKERS)


def sync_activities(credentials: auth.Credentials) -> list[dict]:
    """Fetch the sync window's activities with their samples, laps and sets."""
    garmin = auth.login(credentials)
    startdate, enddate = values.date_window()

    try:
        with rate_limited():
            raw_activities = garmin.get_activities_by_date(startdate, enddate)
    except RateLimitedError:
        raise
    except Exception as exc:
        logger.exception("Garmin activity fetch failed")
        raise UpstreamError("Garmin activity fetch failed") from exc

    activities = []
    for raw in raw_activities or []:
        activity_id = raw.get("activityId")
        activity_type = normalize_type(raw.get("activityType"))
        activities.append(
            to_activity(
                raw,
                _samples_for(garmin, activity_id, activity_type),
                _strength_sets_for(garmin, activity_id, activity_type),
                _laps_for(garmin, activity_id, activity_type),
            )
        )
    return activities


def _samples_for(garmin, activity_id, activity_type: str = "") -> list[dict]:
    """Fetch and normalize one activity's timeseries.

    A single failed detail fetch must not fail the whole 42-day sync, so it is
    logged and treated as an activity with no recorded samples. Rate limiting is
    different: it is re-raised so the caller can surface `429`.
    """
    if activity_id is None:
        return []
    try:
        with rate_limited():
            details = garmin.get_activity_details(str(activity_id))
    except RateLimitedError:
        raise
    except Exception:  # any library/network failure
        logger.exception("Garmin activity details fetch failed for %s", activity_id)
        return []
    return to_samples(details or {}, activity_type)


def _strength_sets_for(garmin, activity_id, activity_type: str) -> list[dict]:
    """Fetch and normalize a strength activity's recorded sets.

    Only strength activities have exercise sets, so other activities skip the
    extra Garmin request. The same fail-open/rate-limit split as the timeseries
    fetch applies: one bad set fetch leaves the activity with no sets.
    """
    if activity_id is None or not _is_strength(activity_type):
        return []
    try:
        with rate_limited():
            payload = garmin.get_activity_exercise_sets(str(activity_id))
    except RateLimitedError:
        raise
    except Exception:  # any library/network failure
        logger.exception("Garmin exercise-sets fetch failed for %s", activity_id)
        return []
    return to_strength_sets(payload or {})


def _is_strength(activity_type: str) -> bool:
    """Whether a normalized Garmin type is a strength-training activity."""
    normalized = activity_type.lower()
    return "strength" in normalized or "weight" in normalized or "gym" in normalized


def _laps_for(garmin, activity_id, activity_type: str = "") -> list[dict]:
    """Fetch and normalize one activity's recorded laps.

    The same fail-open/rate-limit split as the timeseries fetch applies: one bad
    splits request leaves the activity with no laps rather than failing the
    sync, while a rate limit is re-raised so the caller can surface `429`.
    """
    if activity_id is None:
        return []
    try:
        with rate_limited():
            payload = garmin.get_activity_splits(str(activity_id))
    except RateLimitedError:
        raise
    except Exception:  # any library/network failure
        logger.exception("Garmin activity splits fetch failed for %s", activity_id)
        return []
    return to_laps(payload or {}, activity_type)


def to_strength_sets(payload: dict) -> list[dict]:
    """Normalize Garmin's exerciseSets response into stable set objects."""
    raw_sets = payload.get("exerciseSets") if isinstance(payload, dict) else None
    sets: list[dict] = []
    for raw in raw_sets or []:
        if not isinstance(raw, dict):
            continue
        item = _strength_set(raw)
        if item is not None:
            sets.append(item)
        if len(sets) >= MAX_STRENGTH_SETS:
            break
    return sets


def _strength_set(raw: dict) -> dict | None:
    """Map one Garmin exercise set, omitting channels it did not record."""
    exercises = []
    for exercise in raw.get("exercises") or []:
        if not isinstance(exercise, dict):
            continue
        category = exercise.get("category")
        if not isinstance(category, str) or category.strip() == "":
            continue
        name = exercise.get("name")
        exercises.append(
            {
                "category": category.strip(),
                "name": name.strip()
                if isinstance(name, str) and name.strip() != ""
                else None,
            }
        )

    item: dict = {}
    set_type = raw.get("setType")
    if isinstance(set_type, str) and set_type.strip() != "":
        item["setType"] = set_type.strip().lower()

    for key in ("startTime", "startTimeGMT"):
        value = raw.get(key)
        if value is not None:
            item["startTime"] = values.iso(value)
            break

    duration = values.finite_or_none(raw.get("duration"))
    if duration is not None and duration >= 0:
        item["durationSeconds"] = duration

    repetitions = values.finite_or_none(raw.get("repetitionCount"))
    if repetitions is not None and repetitions >= 0:
        item["repetitions"] = int(repetitions)

    weight = _exercise_weight_kg(raw.get("weight"))
    if weight is not None:
        item["weightKg"] = weight

    if exercises:
        item["exercises"] = exercises

    # A set with no exercise and no recorded work tells the coach nothing.
    if not exercises and all(
        key not in item for key in ("repetitions", "weightKg", "durationSeconds")
    ):
        return None
    return item


def _exercise_weight_kg(value) -> float | None:
    """Convert Garmin's gram-based exercise weight to kilograms."""
    grams = values.finite_or_none(value)
    if grams is None or grams <= 0:
        return None
    return round(grams / 1000, 2)


def to_laps(payload: dict, activity_type: str = "") -> list[dict]:
    """Normalize Garmin's activity splits into stable lap objects.

    Field names vary by device and sport, so each channel is read through its
    documented aliases and omitted when absent. A lap that carries nothing but
    its number tells the coach nothing and is dropped; the list is capped so an
    unusual auto-lap payload cannot bloat the feed or the prompt.
    """
    raw_laps = payload.get("lapDTOs") if isinstance(payload, dict) else None
    laps: list[dict] = []
    for position, raw in enumerate(raw_laps or [], start=1):
        if not isinstance(raw, dict):
            continue
        lap = _lap(raw, position, activity_type)
        if lap is not None:
            laps.append(lap)
        if len(laps) >= MAX_LAPS:
            break
    return laps


def _lap_cadence(raw: dict, activity_type: str) -> float | None:
    """Resolve a lap's average cadence in the unit the app displays.

    Garmin's lap payload carries two cadence families. `averageRunCadence` is
    the number Garmin Connect shows, already counted in total steps per minute
    for runs, jogs, walks and hikes, so it is never doubled. `avgCadence` is
    the older per-leg value for those sports and is doubled like the
    per-sample `directCadence`; for a ride it is the pedalling rate in rpm.
    `averageBikeCadence` is always rpm.
    """
    bike = values.first_nonnegative(raw.get("averageBikeCadence"))
    if bike is not None:
        return bike
    steps = values.first_nonnegative(raw.get("averageRunCadence"))
    if steps is not None:
        return steps
    cadence = values.first_nonnegative(raw.get("avgCadence"))
    if cadence is None:
        return None
    return cadence * 2 if is_step_cadence(activity_type) else cadence


def _lap(raw: dict, position: int, activity_type: str = "") -> dict | None:
    """Map one Garmin lap, or return None when it has no recorded values."""
    index = values.first_nonnegative(raw.get("lapIndex"), raw.get("lap"))
    lap: dict = {"index": int(index) if index is not None else position}

    intensity = raw.get("intensityType") or raw.get("lapType")
    if isinstance(intensity, str) and intensity.strip() != "":
        lap["type"] = intensity.strip().lower()

    for key in ("startTimeGMT", "startTimeLocal"):
        value = raw.get(key)
        if value is not None:
            lap["startTime"] = values.iso(value)
            break

    for field, keys in (
        ("distance", ("distance",)),
        ("movingTime", ("movingDuration",)),
        ("elapsedTime", ("duration",)),
        ("averageHeartRate", ("averageHR", "avgHR")),
        ("maxHeartRate", ("maxHR",)),
        ("averagePower", ("averagePower", "avgPower")),
        ("maxPower", ("maxPower",)),
        ("averageSpeed", ("averageSpeed", "averageMovingSpeed", "avgSpeed")),
    ):
        value = values.first_nonnegative(*(raw.get(key) for key in keys))
        if value is not None:
            lap[field] = value

    cadence = _lap_cadence(raw, activity_type)
    if cadence is not None:
        lap["averageCadence"] = cadence

    elevation = values.finite_or_none(raw.get("elevationGain"))
    if elevation is not None:
        lap["totalElevationGain"] = elevation

    # The index alone is not recorded work.
    return lap if len(lap) > 1 else None


def to_activity(
    raw: dict,
    samples: list[dict] | None = None,
    strength_sets: list[dict] | None = None,
    laps: list[dict] | None = None,
) -> dict:
    """Map a Garmin activity to the shared normalized shape."""

    def _num(value, default: float = 0.0) -> float:
        try:
            return float(value) if value is not None else default
        except (TypeError, ValueError):
            return default

    # Prefer Garmin's UTC timestamp. `startTimeLocal` is wall-clock time with no
    # zone offset, so treating it as UTC makes every activity shift when the
    # athlete changes their display time zone.
    start = raw.get("startTimeGMT") or raw.get("startTimeLocal")
    distance = _num(raw.get("distance"))
    moving_time = _num(raw.get("movingDuration"))
    elapsed_time = _num(raw.get("duration"))
    average_speed = values.first_positive(
        raw.get("averageSpeed"), raw.get("averageMovingSpeed"), raw.get("avgSpeed")
    )
    if average_speed is None:
        # Some sports (for example indoor rowing) record distance but leave the
        # summary speed at zero. Derive the mean so the athlete still sees pace.
        duration = moving_time if moving_time > 0 else elapsed_time
        if distance > 0 and duration > 0:
            average_speed = distance / duration
    max_speed = values.first_positive(raw.get("maxSpeed"))
    average_heart_rate = values.first_positive(raw.get("averageHR"), raw.get("avgHR"))

    activity = {
        "id": int(raw.get("activityId") or 0),
        "name": raw.get("activityName") or "",
        "type": normalize_type(raw.get("activityType") or "unknown"),
        "startDate": values.iso(start) if start else "",
        "distance": distance,
        "movingTime": moving_time,
        "elapsedTime": elapsed_time,
        "totalElevationGain": _num(raw.get("elevationGain")),
        "samples": samples or [],
    }
    if average_speed is not None:
        activity["averageSpeed"] = average_speed
    if max_speed is not None:
        activity["maxSpeed"] = max_speed
    if average_heart_rate is not None:
        activity["averageHeartRate"] = average_heart_rate
    if strength_sets:
        activity["strengthSets"] = strength_sets
    # A single lap only restates the whole activity, so it carries no interval
    # structure and is treated as no laps at all.
    if laps and len(laps) > 1:
        activity["laps"] = laps
    return activity


# Garmin detail metric keys -> normalized sample fields, in priority order.
# Keys vary by device and activity type; for aliases (temperature, elevation)
# the first key present wins, and absent channels are omitted from the sample
# entirely. Cadence needs activity-type context, so it is resolved separately.
_SAMPLE_METRICS = (
    ("directLatitude", "latitude"),
    ("directLongitude", "longitude"),
    ("directHeartRate", "heartRate"),
    ("directPower", "power"),
    ("directAirTemperature", "temperature"),
    ("directTemperature", "temperature"),
    ("directSpeed", "speed"),
    ("directEnhancedSpeed", "speed"),
    ("directCorrectedElevation", "elevation"),
    ("directElevation", "elevation"),
    ("directUncorrectedElevation", "elevation"),
)


def to_samples(details: dict, activity_type: str = "") -> list[dict]:
    """Resolve Garmin's positional detail metrics into normalized samples."""
    samples = []
    for raw in parse_activity_detail_metrics(details):
        timestamp = values.epoch_iso(raw.get("directTimestamp"))
        if timestamp is None:
            continue

        sample: dict = {"timestamp": timestamp}
        for source_key, field in _SAMPLE_METRICS:
            if field in sample:
                continue
            value = values.finite_or_none(raw.get(source_key))
            if value is not None:
                sample[field] = value

        cadence = _cadence(raw, activity_type)
        if cadence is not None:
            sample["cadence"] = cadence

        # Garmin usually reports cumulative distance as `sumDistance`, but some
        # devices only provide the instantaneous `directDistance`.
        distance = values.finite_or_none(raw.get("sumDistance"))
        if distance is None:
            distance = values.finite_or_none(raw.get("directDistance"))
        if distance is not None:
            sample["distance"] = distance

        samples.append(sample)
    return samples


def _cadence(raw: dict, activity_type: str) -> float | None:
    """Resolve cadence in the unit Garmin Connect displays.

    Step-counted sports count cadence per leg: `directDoubleCadence` already
    holds total steps per minute, while `directCadence` is the per-leg half and
    is doubled for runs, jogs, walks and hikes. Cycling cadence is the pedalling
    rate in rpm, reported by `directBikeCadence` (or `directCadence` as a
    fallback). Rowing and swimming report strokes per minute through
    `directStrokeCadence`, which is already the displayed rate.
    `directFractionalCadence` is only the sub-unit remainder of `directCadence`,
    never a cadence on its own, so reading it alone yields 0 or 1.
    """
    double = values.finite_or_none(raw.get("directDoubleCadence"))
    if double is not None and double > 0:
        return double

    bike = values.finite_or_none(raw.get("directBikeCadence"))
    if bike is not None:
        return bike

    stroke = values.finite_or_none(raw.get("directStrokeCadence"))
    if stroke is not None:
        return stroke

    cadence = values.finite_or_none(raw.get("directCadence"))
    if cadence is None:
        return None
    fraction = values.finite_or_none(raw.get("directFractionalCadence"))
    if fraction is not None and 0 <= fraction < 1:
        cadence += fraction
    return cadence * 2 if is_step_cadence(activity_type) else cadence


def normalize_type(activity_type) -> str:
    """Lowercase the Garmin activity type key so it matches non-Garmin sources."""
    if not activity_type:
        return "unknown"
    if isinstance(activity_type, dict):
        key = activity_type.get("typeKey")
        return str(key).lower() if key else "unknown"
    return activity_type.lower()
