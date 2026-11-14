"""The sidecar's failure taxonomy and its single error boundary.

`rate_limited` turns Garmin's 429 into `RateLimitedError` for every call that
needs it, and `http_errors` turns any unhandled sidecar failure into the HTTP
status the API expects. A new Garmin call uses the context manager and a new
route uses the decorator, so neither can drift into a second copy. See ADR 0058.
"""

from __future__ import annotations

import functools
import logging
from collections.abc import Callable, Iterator
from contextlib import contextmanager

from fastapi import HTTPException
from garminconnect import GarminConnectTooManyRequestsError

logger = logging.getLogger("garmin-sidecar")

# The sentence an operator sees when Garmin rate-limits a request. Login says
# "logins" instead, so it passes its own message to `rate_limited`.
RATE_LIMIT_MESSAGE = (
    "Garmin is rate limiting requests. Wait a few minutes and try again."
)


class LoginError(Exception):
    """Garmin rejected the supplied credentials."""


class MfaRequiredError(Exception):
    """Garmin requires multi-factor authentication."""


class RateLimitedError(Exception):
    """Garmin is rate limiting logins / requests (HTTP 429)."""


class UpstreamError(Exception):
    """Garmin returned an unexpected error."""


@contextmanager
def rate_limited(message: str = RATE_LIMIT_MESSAGE) -> Iterator[None]:
    """Translate Garmin's 429 into the sidecar's own rate-limit error."""
    try:
        yield
    except GarminConnectTooManyRequestsError as exc:
        raise RateLimitedError(message) from exc


def http_error(exc: Exception) -> HTTPException:
    """Map a sidecar domain error to an HTTP response."""
    if isinstance(exc, LoginError):
        return HTTPException(status_code=401, detail=str(exc))
    if isinstance(exc, MfaRequiredError):
        return HTTPException(status_code=403, detail=str(exc))
    if isinstance(exc, RateLimitedError):
        return HTTPException(status_code=429, detail=str(exc))
    if isinstance(exc, UpstreamError):
        return HTTPException(status_code=502, detail=str(exc))
    logger.exception("unhandled sidecar error")
    return HTTPException(status_code=500, detail="internal sidecar error")


def http_errors[**P, R](route: Callable[P, R]) -> Callable[P, R]:
    """Translate every unhandled failure of a route, so no route forgets it."""

    @functools.wraps(route)
    def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
        try:
            return route(*args, **kwargs)
        except HTTPException:
            raise
        except Exception as exc:  # translated to HTTP below
            raise http_error(exc) from exc

    return wrapper
