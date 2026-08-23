"""Tests for global regex search and source references."""

from engine.document import DocumentNode
from engine.search import search_document


def test_search_returns_nested_text_with_section_and_page(document_tree: DocumentNode) -> None:
    result = search_document(document_tree, r"written\s+notice")

    assert result.error is None
    assert len(result.hits) == 1
    assert result.hits[0].node_id == "n3"
    assert result.hits[0].section == "I. Facts › A. Background"
    assert result.hits[0].page == 2
    assert result.hits[0].matched_field == "text"
    assert result.hits[0].snippet == "The written notice preceded the hearing."


def test_search_is_case_insensitive_and_can_match_section_labels(document_tree: DocumentNode) -> None:
    result = search_document(document_tree, "rULING")

    assert result.error is None
    assert [(hit.node_id, hit.section, hit.page, hit.matched_field) for hit in result.hits] == [
        ("n5", "II. Ruling", 5, "label"),
        ("n6", "II. Ruling", 6, "section"),
    ]


def test_search_respects_limit_and_returns_empty_for_no_match(document_tree: DocumentNode) -> None:
    limited = search_document(document_tree, "the|was|committee", limit=1)
    missing = search_document(document_tree, "not-present")

    assert len(limited.hits) == 1
    assert missing.hits == []
    assert missing.error is None


def test_search_reports_invalid_or_empty_patterns(document_tree: DocumentNode) -> None:
    invalid = search_document(document_tree, "[")
    empty = search_document(document_tree, "")

    assert invalid.hits == []
    assert invalid.error is not None
    assert empty.error == "Search pattern must not be empty."
