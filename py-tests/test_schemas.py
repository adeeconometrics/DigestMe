"""Tests for the structured case-digest output contract."""

import pytest
from pydantic import ValidationError

from engine.schemas import CaseDigest


def test_typescript_digest_fixture_validates(digest_payload: dict[str, object]) -> None:
    digest = CaseDigest.model_validate(digest_payload)

    assert digest.case_title == "Villanueva v. Bayside Port Workers Cooperative"
    assert digest.facts.petition
    assert len(digest.issues) == 4
    assert digest.issues[0].ruling == "YES"


def test_legacy_issue_pairs_are_normalized(digest_payload: dict[str, object]) -> None:
    payload = dict(digest_payload)
    payload["issues"] = [["YES", "The notice requirement was not met."]]

    digest = CaseDigest.model_validate(payload)

    assert digest.issues[0].model_dump() == {
        "issue": None,
        "ruling": "YES",
        "ratio": "The notice requirement was not met.",
    }


def test_required_digest_fields_are_enforced(digest_payload: dict[str, object]) -> None:
    payload = dict(digest_payload)
    payload.pop("summary")

    with pytest.raises(ValidationError):
        CaseDigest.model_validate(payload)
