"""Tests for the structured case-digest output contract."""

import pytest
from pydantic import ValidationError

from engine.schemas import CaseDigest


def test_typescript_digest_fixture_validates(digest_payload: dict[str, object]) -> None:
    digest = CaseDigest.model_validate(digest_payload)

    assert digest.case_title == "Villanueva v. Bayside Port Workers Cooperative"
    assert digest.facts is not None
    assert digest.facts.petition
    assert digest.issues is not None
    assert len(digest.issues) == 4
    assert digest.issues[0].ruling == "YES"


def test_legacy_issue_pairs_are_normalized(digest_payload: dict[str, object]) -> None:
    payload = dict(digest_payload)
    payload["issues"] = [["YES", "The notice requirement was not met."]]

    digest = CaseDigest.model_validate(payload)

    assert digest.issues is not None
    assert digest.issues[0].model_dump() == {
        "issue": None,
        "ruling": "YES",
        "ratio": "The notice requirement was not met.",
    }


def test_missing_digest_elements_are_accepted(digest_payload: dict[str, object]) -> None:
    """A source may omit sections that it does not support."""
    payload = dict(digest_payload)
    payload.pop("summary")
    payload.pop("facts")
    payload.pop("issues")
    payload["provisions"] = None

    digest = CaseDigest.model_validate(payload)

    assert digest.summary is None
    assert digest.facts is None
    assert digest.issues is None
    assert digest.provisions is None


def test_completely_empty_digest_is_accepted() -> None:
    digest = CaseDigest.model_validate({})

    assert digest.case_title is None
    assert digest.facts is None


def test_empty_nested_elements_are_accepted() -> None:
    digest = CaseDigest.model_validate({"facts": {}, "issues": [{}]})

    assert digest.facts is not None
    assert digest.facts.petition is None
    assert digest.issues is not None
    assert digest.issues[0].ruling is None
    assert digest.issues[0].ratio is None


def test_unknown_digest_keys_are_ignored(digest_payload: dict[str, object]) -> None:
    payload = dict(digest_payload)
    payload["headnotes"] = "not a model key"
    facts_value = payload["facts"]
    assert isinstance(facts_value, dict)
    facts = dict(facts_value)
    facts["dissent"] = "not a facts key"
    payload["facts"] = facts

    digest = CaseDigest.model_validate(payload)

    assert "headnotes" not in digest.model_dump()
    assert digest.facts is not None
    assert "dissent" not in digest.facts.model_dump()


def test_misattributed_digest_types_are_rejected(digest_payload: dict[str, object]) -> None:
    payload = dict(digest_payload)
    payload["summary"] = ["not a narrative string"]

    with pytest.raises(ValidationError):
        CaseDigest.model_validate(payload)

    payload = dict(digest_payload)
    facts_value = payload["facts"]
    assert isinstance(facts_value, dict)
    facts = dict(facts_value)
    facts["petition"] = "not a list"
    payload["facts"] = facts

    with pytest.raises(ValidationError):
        CaseDigest.model_validate(payload)
