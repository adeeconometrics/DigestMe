"""Tests for global regex search, ranked term-overlap search, and source references."""

from engine.document import DocumentNode
from engine.search import search_document, search_document_ranked


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


def test_search_pages_hits_with_offset_and_reports_total(document_tree: DocumentNode) -> None:
    first = search_document(document_tree, "the|was|committee", limit=1)
    second = search_document(document_tree, "the|was|committee", limit=1, offset=1)

    assert [hit.node_id for hit in first.hits] == ["n3"]
    assert first.total == 3
    assert [hit.node_id for hit in second.hits] == ["n4"]
    assert second.total == 3


def test_search_reports_full_total_without_windowing(document_tree: DocumentNode) -> None:
    result = search_document(document_tree, "the")

    assert [hit.node_id for hit in result.hits] == ["n3", "n4", "n6"]
    assert result.total == 3
    assert result.offset == 0


def test_search_offset_beyond_matches_returns_empty_with_total(document_tree: DocumentNode) -> None:
    result = search_document(document_tree, "the", limit=10, offset=5)

    assert result.hits == []
    assert result.total == 3


def test_search_rejects_negative_offset(document_tree: DocumentNode) -> None:
    result = search_document(document_tree, "the", offset=-1)

    assert result.hits == []
    assert result.total == 0
    assert result.error == "offset must be non-negative"


def test_ranked_search_ranks_exact_phrase_matches_first(document_tree: DocumentNode) -> None:
    result = search_document_ranked(document_tree, "written notice")

    assert result.query == "written notice"
    assert result.total == 1
    assert result.hits[0].node_id == "n3"
    assert result.hits[0].matched_field == "text"
    assert result.hits[0].snippet == "The written notice preceded the hearing."
    assert result.hits[0].score > 0


def test_ranked_search_boosts_body_over_section_paths(document_tree: DocumentNode) -> None:
    result = search_document_ranked(document_tree, "ruling")

    # n5 matches its own label as body text; n6 only via its section path (half weight).
    assert [hit.node_id for hit in result.hits] == ["n5", "n6"]
    assert result.hits[0].matched_field == "text"
    assert result.hits[1].matched_field == "section"
    assert result.hits[0].score > result.hits[1].score


def test_ranked_search_reports_total_before_applying_limit(document_tree: DocumentNode) -> None:
    limited = search_document_ranked(document_tree, "the", limit=1)

    assert len(limited.hits) == 1
    assert limited.total == 3


def test_ranked_search_returns_empty_for_no_match_or_empty_query(document_tree: DocumentNode) -> None:
    missing = search_document_ranked(document_tree, "not-present")
    empty = search_document_ranked(document_tree, "")

    assert missing.hits == []
    assert missing.total == 0
    assert empty.hits == []
    assert empty.total == 0
