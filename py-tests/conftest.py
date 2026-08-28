"""Shared fixtures for the Python engine tests."""

from __future__ import annotations

import json
from pathlib import Path
from typing import cast

import pytest

from engine.document import DocumentNode

LONG_HEADING = (
    "SEC. 23. The Board of Directors; Composition; Election; Qualification; "
    "Term of Office; Removal; Filling of Vacancies"
)
TRUNCATED_LABEL = "SEC. 23. The Board of Directors; Composition; Election…"


@pytest.fixture(name="document_tree_payload")
def fixture_document_tree_payload() -> dict[str, object]:
    """Return a serialized tree matching the TypeScript IndexedDB contract."""
    return {
        "id": "n0",
        "kind": "document",
        "label": "Villanueva v. Bayside",
        "section": "Villanueva v. Bayside",
        "page": None,
        "children": [
            {
                "id": "n1",
                "kind": "section",
                "label": "I. Facts",
                "heading": "I. Facts",
                "section": "I. Facts",
                "page": 1,
                "children": [
                    {
                        "id": "n2",
                        "kind": "section",
                        "label": "A. Background",
                        "heading": "A. Background",
                        "section": "I. Facts › A. Background",
                        "page": 1,
                        "children": [
                            {
                                "id": "n3",
                                "kind": "block",
                                "label": "The written notice preceded the hearing.",
                                "section": "I. Facts › A. Background",
                                "page": 2,
                                "text": "The written notice preceded the hearing.",
                                "children": [],
                            }
                        ],
                    },
                    {
                        "id": "n4",
                        "kind": "block",
                        "label": "The committee reviewed the incident.",
                        "section": "I. Facts",
                        "page": 2,
                        "text": "The committee reviewed the incident.",
                        "children": [],
                    },
                ],
            },
            {
                "id": "n5",
                "kind": "section",
                "label": "II. Ruling",
                "heading": "II. Ruling",
                "section": "II. Ruling",
                "page": 5,
                "children": [
                    {
                        "id": "n6",
                        "kind": "block",
                        "label": "The expulsion was void.",
                        "section": "II. Ruling",
                        "page": 6,
                        "text": "The expulsion was void for lack of due process.",
                        "children": [],
                    }
                ],
            },
        ],
    }


@pytest.fixture
def document_tree(document_tree_payload: dict[str, object]) -> DocumentNode:
    """Validate the serialized IndexedDB payload before using it in tests."""
    return DocumentNode.model_validate(document_tree_payload)


@pytest.fixture(name="long_heading_tree")
def fixture_long_heading_tree() -> DocumentNode:
    """A commentary-style section whose full heading exceeds the display label."""
    return DocumentNode.model_validate(
        {
            "id": "n0",
            "kind": "document",
            "label": "Corporation Law",
            "heading": "Corporation Law",
            "section": "Corporation Law",
            "page": None,
            "children": [
                {
                    "id": "n1",
                    "kind": "section",
                    "label": TRUNCATED_LABEL,
                    "heading": LONG_HEADING,
                    "section": f"Corporation Law › {TRUNCATED_LABEL}",
                    "page": 1,
                    "children": [
                        {
                            "id": "n2",
                            "kind": "block",
                            "label": "The board exercises corporate powers.",
                            "section": f"Corporation Law › {TRUNCATED_LABEL}",
                            "page": 1,
                            "text": "The board exercises corporate powers.",
                            "children": [],
                        }
                    ],
                }
            ],
        }
    )


@pytest.fixture(name="citation_tree")
def fixture_citation_tree() -> DocumentNode:
    """A commentary-style tree whose blocks carry inline legal citations."""
    return DocumentNode.model_validate(
        {
            "id": "n0",
            "kind": "document",
            "label": "Corporation Law",
            "heading": "Corporation Law",
            "section": "Corporation Law",
            "page": None,
            "children": [
                {
                    "id": "n1",
                    "kind": "section",
                    "label": "SEC. 23. Board of Directors",
                    "heading": "SEC. 23. Board of Directors",
                    "section": "Corporation Law › SEC. 23. Board of Directors",
                    "page": 1,
                    "children": [
                        {
                            "id": "n2",
                            "kind": "block",
                            "label": "The board's powers were upheld in People v. Santos.",
                            "section": "Corporation Law › SEC. 23. Board of Directors",
                            "page": 1,
                            "text": (
                                "The board's powers were upheld in People v. Santos, "
                                "G.R. No. 123456, January 15, 2001, and reaffirmed at "
                                "G.R. No. 123456."
                            ),
                            "children": [],
                        },
                        {
                            "id": "n3",
                            "kind": "block",
                            "label": "See also SEC Opinion No. 20-01.",
                            "section": "Corporation Law › SEC. 23. Board of Directors",
                            "page": 2,
                            "text": "See also SEC Opinion No. 20-01 and Sec. 23, RCC; Secs. 21-40 of the same code.",
                            "children": [],
                        },
                        {
                            "id": "n4",
                            "kind": "block",
                            "label": "The pre-Code rule under B.P. Blg. 68 remains.",
                            "section": "Corporation Law › SEC. 23. Board of Directors",
                            "page": 3,
                            "text": (
                                "The pre-Code rule under B.P. Blg. 68 and Republic Act "
                                "No. 11232 remains; see also G.R. No. 123456 and PD 902-A."
                            ),
                            "children": [],
                        },
                        {
                            "id": "n5",
                            "kind": "block",
                            "label": "Foo Corp. vs. Bar Inc. distinguished the earlier ruling.",
                            "section": "Corporation Law › SEC. 23. Board of Directors",
                            "page": 4,
                            "text": "Foo Corp. vs. Bar Inc. distinguished the earlier ruling.",
                            "children": [],
                        },
                    ],
                }
            ],
        }
    )


@pytest.fixture
def digest_payload() -> dict[str, object]:
    """Load the digest fixture consumed by the TypeScript DOCX renderer."""
    fixture_path = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "case-digest.mock.json"
    return cast(dict[str, object], json.loads(fixture_path.read_text(encoding="utf-8")))


@pytest.fixture(name="commentary_digest_payload")
def fixture_commentary_digest_payload() -> dict[str, object]:
    """Return a minimal valid commentary-digest payload for bridge tests."""
    return {
        "source_title": "Philippine Corporate Law, Villanueva, 2019 ed.",
        "chapter_title": "Board of Directors",
        "sections_covered": "Secs. 21-40, RA No. 11232",
        "subject": "Corporation Law",
        "summary": "The chapter examines the board.",
        "rule": "Corporate powers are exercised by the board as a body.",
        "elements": ["A board of at least five members"],
        "exceptions": ["Acts within the ordinary course of business"],
        "definitions": ["Controlling stockholder: one who holds sufficient shares."],
        "cases": [
            {
                "case_name": "Villanueva v. Bayside Port Workers Cooperative",
                "citation": "G.R. No. 123456, January 15, 2001",
                "doctrine": "Directors cannot bind the corporation outside board authority.",
            }
        ],
        "implementing_rules": ["SEC MC No. 28, s. 2020 on board composition"],
        "related_provisions": ["Sec. 23, RA 11232 and Sec. 30 on removal"],
        "legislative_history": "The RCC reworked the board powers.",
        "debates": ["Commentators split on veil piercing."],
        "practice_pointers": ["File the GIS within thirty days."],
        "illustrations": ["A director voting for an ultra vires act may be liable."],
        "study_notes": ["The board acts only as a body."],
    }
