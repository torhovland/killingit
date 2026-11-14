"""Unit tests for the sidecar's single rate-limit handler and route boundary."""

import pytest
from fastapi import HTTPException
from garminconnect import GarminConnectTooManyRequestsError

from errors import (
    LoginError,
    MfaRequiredError,
    RateLimitedError,
    UpstreamError,
    http_error,
    http_errors,
    rate_limited,
)


def test_rate_limited_translates_a_garmin_rate_limit():
    with pytest.raises(RateLimitedError, match="wait"), rate_limited("please wait"):
        raise GarminConnectTooManyRequestsError("429")


def test_rate_limited_leaves_other_failures_alone():
    with pytest.raises(ValueError, match="boom"), rate_limited():
        raise ValueError("boom")


@pytest.mark.parametrize(
    ("exc", "status"),
    [
        (LoginError("invalid Garmin credentials"), 401),
        (MfaRequiredError("MFA is not supported"), 403),
        (RateLimitedError("rate limited"), 429),
        (UpstreamError("Garmin is unreachable"), 502),
    ],
)
def test_http_error_maps_each_domain_error(exc, status):
    response = http_error(exc)
    assert response.status_code == status
    assert response.detail == str(exc)


def test_http_error_hides_an_unexpected_failure():
    try:
        raise RuntimeError("database password is hunter2")
    except RuntimeError as exc:
        response = http_error(exc)

    assert response.status_code == 500
    assert response.detail == "internal sidecar error"


def test_http_errors_translates_a_domain_error():
    @http_errors
    def route():
        raise LoginError("invalid Garmin credentials")

    with pytest.raises(HTTPException) as raised:
        route()

    assert raised.value.status_code == 401


def test_http_errors_passes_an_http_exception_through():
    @http_errors
    def route():
        raise HTTPException(status_code=400, detail="date must be YYYY-MM-DD")

    with pytest.raises(HTTPException) as raised:
        route()

    assert raised.value.status_code == 400
    assert raised.value.detail == "date must be YYYY-MM-DD"


def test_http_errors_returns_the_route_value_unchanged():
    @http_errors
    def route(value: int) -> dict:
        return {"value": value}

    assert route(3) == {"value": 3}
