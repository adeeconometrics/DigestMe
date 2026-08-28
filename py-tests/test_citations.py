"""Tests for legal-citation enumeration across the document tree."""

from engine.citations import CITATION_FAMILIES, find_citations_in_document
from engine.document import DocumentNode


def test_find_citations_sweeps_case_numbers_and_dedupes_within_a_node(
    citation_tree: DocumentNode,
) -> None:
    result = find_citations_in_document(citation_tree, family="case_number")

    assert result.error is None
    assert result.total == 2
    assert [(hit.node_id, hit.citation) for hit in result.hits] == [
        ("n2", "G.R. No. 123456"),
        ("n4", "G.R. No. 123456"),
    ]
    assert result.hits[0].page == 1
    assert all(hit.family == "case_number" for hit in result.hits)


def test_find_citations_matches_case_names_with_v_and_vs(citation_tree: DocumentNode) -> None:
    result = find_citations_in_document(citation_tree, family="case_name")

    assert result.error is None
    assert [hit.citation for hit in result.hits] == ["People v. Santos", "Foo Corp. vs. Bar Inc"]
    assert "People v. Santos" in result.hits[0].snippet


def test_find_citations_recognizes_sec_opinions_and_statutes(citation_tree: DocumentNode) -> None:
    opinions = find_citations_in_document(citation_tree, family="sec_opinion")
    statutes = find_citations_in_document(citation_tree, family="statute")

    assert [hit.citation for hit in opinions.hits] == ["SEC Opinion No. 20-01"]
    assert [hit.citation for hit in statutes.hits] == [
        "B.P. Blg. 68",
        "Republic Act No. 11232",
        "PD 902-A",
    ]


def test_find_citations_sweeps_cross_references_only_from_block_text(
    citation_tree: DocumentNode,
) -> None:
    result = find_citations_in_document(citation_tree, family="cross_reference")

    # The "SEC. 23" section label is a heading, not an in-text reference.
    assert result.total == 2
    assert [hit.citation for hit in result.hits] == ["Sec. 23", "Secs. 21-40"]


def test_find_citations_sweeps_every_family_when_omitted(citation_tree: DocumentNode) -> None:
    result = find_citations_in_document(citation_tree)

    assert result.error is None
    assert result.total == 10
    assert {hit.family for hit in result.hits} == set(CITATION_FAMILIES)
    assert result.hits[0].citation == "G.R. No. 123456"


def test_find_citations_pages_hits_with_offset_and_limit(citation_tree: DocumentNode) -> None:
    first_page = find_citations_in_document(citation_tree, limit=4)
    second_page = find_citations_in_document(citation_tree, limit=4, offset=4)

    assert len(first_page.hits) == 4
    assert first_page.total == 10
    assert len(second_page.hits) == 4
    assert second_page.total == 10
    assert [hit.citation for hit in second_page.hits] == [
        "Secs. 21-40",
        "G.R. No. 123456",
        "B.P. Blg. 68",
        "Republic Act No. 11232",
    ]


def test_find_citations_rejects_an_unknown_family(citation_tree: DocumentNode) -> None:
    result = find_citations_in_document(citation_tree, family="writ")

    assert result.hits == []
    assert result.total == 0
    error = result.error
    assert error is not None
    assert "writ" in error
    assert "case_number" in error


def test_find_citations_rejects_a_negative_offset(citation_tree: DocumentNode) -> None:
    result = find_citations_in_document(citation_tree, offset=-1)

    assert result.hits == []
    assert result.total == 0
    assert result.error == "offset must be non-negative"
