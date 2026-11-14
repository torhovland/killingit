"""Contract test: the sidecar's JSON still matches the shared wire contract.

The sidecar builds its response dicts by hand and TypeScript owns the Zod
schemas, so a field rename on either side used to break only in production.
`contract_fixtures.py` builds each endpoint's whole body by running
representative Garmin payloads through the sidecar's own handlers, and the
result is committed under `services/garmin/contract/`. This test fails when the
sidecar no longer produces those bytes, and the Bun side
(`apps/api/src/garmin/contract.test.ts`) fails when the shared schemas no longer
parse them.

The `/sync` request body is pinned the same way: `sync-request.json` is
validated through the sidecar's own `SyncRequest` model, so a renamed request
field fails one of the two suites.

After a deliberate wire change, regenerate the committed files:

    cd services/garmin
    UPDATE_CONTRACT_FIXTURES=1 .venv/bin/python -m pytest test_contract.py

The normal run only reads them.
"""

import json
import os

import app
from contract_fixtures import (
    CONTRACT_DIR,
    contract_responses,
    sync_response,
    write_contract_responses,
)

UPDATE_ENV = "UPDATE_CONTRACT_FIXTURES"


def _committed_response(name: str) -> object:
    path = CONTRACT_DIR / f"{name}.json"
    return json.loads(path.read_text(encoding="utf-8"))


def test_committed_fixtures_match_the_sidecar():
    responses = contract_responses()
    if os.environ.get(UPDATE_ENV) == "1":
        write_contract_responses(responses)

    mismatched = [
        name
        for name, response in responses.items()
        if _committed_response(name) != response
    ]

    assert mismatched == [], (
        f"{', '.join(f'{name}.json' for name in mismatched)} no longer matches the "
        f"sidecar; after a deliberate wire change regenerate it with {UPDATE_ENV}=1 "
        "and check that the shared schemas still describe it"
    )


def test_the_contract_directory_covers_every_sidecar_body():
    # A new endpoint or request body without a fixture would otherwise pass
    # unnoticed, because the test above only walks `contract_responses`.
    assert sorted(path.name for path in CONTRACT_DIR.glob("*.json")) == [
        "daily.json",
        "metrics.json",
        "sync-request.json",
        "sync.json",
    ]


def test_the_sync_request_fixture_names_the_known_activity_ids():
    request = app.SyncRequest.model_validate(_committed_response("sync-request"))

    assert request.known_activity_ids == ["1", "3"]


def test_a_known_activity_skips_its_bulk_payloads():
    # The committed request names the run and the strength activity, so the
    # sidecar skips their details, laps and sets while the ride is still fetched
    # in full. This pins both the field name and what it means.
    request = app.SyncRequest.model_validate(_committed_response("sync-request"))

    body = sync_response(request)
    by_id = {activity["id"]: activity for activity in body["activities"]}

    assert by_id[1]["samples"] == []
    assert "laps" not in by_id[1]
    assert by_id[2]["samples"] != []
    assert "strengthSets" not in by_id[3]
