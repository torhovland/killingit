"""Unit tests for Garmin login and the authenticate route's failure mapping."""

import pytest
from fastapi import HTTPException
from garminconnect import (
    GarminConnectAuthenticationError,
    GarminConnectTooManyRequestsError,
)

import app
import auth
from auth import Credentials
from errors import LoginError, RateLimitedError


def test_login_maps_a_garmin_rate_limit_to_rate_limited(monkeypatch):
    class _RateLimitedGarmin:
        def __init__(self, **kwargs):
            pass

        def login(self, tokenstore):
            raise GarminConnectTooManyRequestsError("429")

    monkeypatch.setattr(auth, "Garmin", _RateLimitedGarmin)

    with pytest.raises(RateLimitedError, match="logins"):
        auth.login(Credentials(username="u", password="p"))


def test_login_maps_rejected_credentials_to_login_error(monkeypatch):
    class _RejectedGarmin:
        def __init__(self, **kwargs):
            pass

        def login(self, tokenstore):
            raise GarminConnectAuthenticationError("bad credentials")

    monkeypatch.setattr(auth, "Garmin", _RejectedGarmin)

    with pytest.raises(LoginError, match="invalid Garmin credentials"):
        auth.login(Credentials(username="u", password="p"))


def test_authenticate_route_maps_a_rejected_login_to_401(monkeypatch):
    def _reject(credentials):
        raise LoginError("invalid Garmin credentials")

    monkeypatch.setattr(auth, "login", _reject)

    with pytest.raises(HTTPException) as raised:
        app.authenticate(Credentials(username="u", password="p"))

    assert raised.value.status_code == 401
