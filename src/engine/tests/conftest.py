"""Shared fixtures for the Python engine tests."""

from __future__ import annotations

import json
from pathlib import Path
from typing import cast

import pytest

from engine.document import DocumentNode


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
                "section": "I. Facts",
                "page": 1,
                "children": [
                    {
                        "id": "n2",
                        "kind": "section",
                        "label": "A. Background",
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


@pytest.fixture
def digest_payload() -> dict[str, object]:
    """Load the digest fixture consumed by the TypeScript DOCX renderer."""
    fixture_path = Path(__file__).resolve().parents[3] / "tests" / "fixtures" / "case-digest.mock.json"
    return cast(dict[str, object], json.loads(fixture_path.read_text(encoding="utf-8")))
