"""Tests for the structured case-digest and commentary-digest output contracts."""

import pytest
from pydantic import ValidationError

from engine.schemas import CaseDigest, CommentaryDigest, CommentaryDigestResult


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


def commentary_payload() -> dict[str, object]:
    """A minimal but valid commentary-digest reference frame."""
    return {
        "source_title": "Philippine Corporate Law, Villanueva, 2019 ed.",
        "chapter_title": "Board of Directors",
        "sections_covered": "Secs. 21-40, RA No. 11232; former Secs. 21-39, BP 68",
        "subject": "Corporation Law",
    }


def test_commentary_reference_frame_validates() -> None:
    digest = CommentaryDigest.model_validate(commentary_payload())

    assert digest.source_title == "Philippine Corporate Law, Villanueva, 2019 ed."
    assert digest.chapter_title == "Board of Directors"
    assert digest.sections_covered == "Secs. 21-40, RA No. 11232; former Secs. 21-39, BP 68"
    assert digest.subject == "Corporation Law"


def test_commentary_reference_frame_normalizes_missing_fields() -> None:
    payload = dict(commentary_payload())
    payload.pop("chapter_title")
    payload["sections_covered"] = None

    digest = CommentaryDigest.model_validate(payload)

    assert digest.chapter_title == ""
    assert digest.sections_covered == ""


def test_completely_empty_commentary_digest_is_normalized() -> None:
    digest = CommentaryDigest.model_validate({})

    assert digest.model_dump() == {
        "source_title": "",
        "chapter_title": "",
        "sections_covered": "",
        "subject": "",
    }


def test_commentary_schema_requires_the_reference_frame() -> None:
    schema = CommentaryDigest.model_json_schema()

    assert set(schema["required"]) == {
        "source_title",
        "chapter_title",
        "sections_covered",
        "subject",
    }
    assert schema["properties"]["source_title"]["type"] == "string"
    assert "empty string" in schema["properties"]["source_title"]["description"]


def test_commentary_unknown_keys_are_ignored() -> None:
    payload = dict(commentary_payload())
    payload["volume"] = "not a model key"

    digest = CommentaryDigest.model_validate(payload)

    assert "volume" not in digest.model_dump()


def test_commentary_misattributed_types_are_rejected() -> None:
    payload = dict(commentary_payload())
    payload["source_title"] = ["not a narrative string"]

    with pytest.raises(ValidationError):
        CommentaryDigest.model_validate(payload)


def test_commentary_digest_result_wraps_digest_and_metadata() -> None:
    result = CommentaryDigestResult.model_validate(
        {
            "digest": commentary_payload(),
            "references": [],
            "model": "deepseek-v4-flash",
            "elapsed_ms": 120,
        }
    )

    assert result.digest.subject == "Corporation Law"
    assert result.references == []
    assert result.model == "deepseek-v4-flash"
    assert result.elapsed_ms == 120


def test_commentary_digest_result_rejects_a_malformed_digest() -> None:
    with pytest.raises(ValidationError):
        CommentaryDigestResult.model_validate(
            {
                "digest": "not a digest",
                "model": "deepseek-v4-flash",
                "elapsed_ms": 120,
            }
        )
