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


def test_legacy_issue_pairs_are_rejected(digest_payload: dict[str, object]) -> None:
    payload = dict(digest_payload)
    payload["issues"] = [["YES", "The notice requirement was not met."]]

    with pytest.raises(ValidationError):
        CaseDigest.model_validate(payload)


def test_missing_digest_elements_are_normalized(digest_payload: dict[str, object]) -> None:
    """Unsupported sections become canonical empty values before validation."""
    payload = dict(digest_payload)
    payload.pop("summary")
    payload.pop("facts")
    payload.pop("issues")
    payload["provisions"] = None
    payload["petitioners_arguments"] = None

    digest = CaseDigest.model_validate(payload)

    assert digest.summary == ""
    assert digest.facts.model_dump() == {
        "petition": [],
        "petitioner_version": [],
        "respondent_version": [],
    }
    assert digest.issues == []
    assert digest.provisions == ""
    assert digest.petitioners_arguments == []


def test_completely_empty_digest_is_normalized() -> None:
    digest = CaseDigest.model_validate({})

    assert digest.model_dump() == {
        "case_title": "",
        "petitioner": "",
        "respondent": "",
        "topic_subtopic": "",
        "subject": "",
        "ponente": "",
        "gr_no_date": "",
        "full_text": "",
        "summary": "",
        "doctrine": "",
        "provisions": "",
        "facts": {
            "petition": [],
            "petitioner_version": [],
            "respondent_version": [],
        },
        "petitioners_arguments": [],
        "respondents_arguments": [],
        "procedural_posture": [],
        "issues": [],
        "supreme_court_ruling": "",
        "class_notes": [],
    }


def test_empty_nested_elements_are_normalized() -> None:
    digest = CaseDigest.model_validate({"facts": {}, "issues": [{}]})

    assert digest.facts.model_dump() == {
        "petition": [],
        "petitioner_version": [],
        "respondent_version": [],
    }
    assert digest.issues[0].model_dump() == {"issue": "", "ruling": "", "ratio": ""}


def test_digest_schema_requires_every_canonical_field() -> None:
    schema = CaseDigest.model_json_schema()

    assert set(schema["required"]) == {
        "case_title",
        "petitioner",
        "respondent",
        "topic_subtopic",
        "subject",
        "ponente",
        "gr_no_date",
        "full_text",
        "summary",
        "doctrine",
        "provisions",
        "facts",
        "petitioners_arguments",
        "respondents_arguments",
        "procedural_posture",
        "issues",
        "supreme_court_ruling",
        "class_notes",
    }
    facts_schema = schema["$defs"]["CaseDigestFacts"]
    assert set(facts_schema["required"]) == {"petition", "petitioner_version", "respondent_version"}
    issue_schema = schema["$defs"]["CaseDigestIssue"]
    assert set(issue_schema["required"]) == {"issue", "ruling", "ratio"}
    assert schema["properties"]["case_title"]["type"] == "string"
    assert "empty string" in schema["properties"]["case_title"]["description"]
    assert "empty list" in facts_schema["properties"]["petition"]["description"]


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
