"""Tests for traceable document navigation."""

from engine.document import DocumentNode, navigate_document_tree


def test_navigation_returns_top_level_outline(document_tree: DocumentNode) -> None:
    result = navigate_document_tree(document_tree)

    assert result.error is None
    assert result.section == "Villanueva v. Bayside"
    assert [(entry.node_id, entry.section, entry.page) for entry in result.entries] == [
        ("n1", "I. Facts", 1),
        ("n5", "II. Ruling", 5),
    ]
    assert result.entries[0].child_count == 2


def test_navigation_retrieves_nested_section_content(document_tree: DocumentNode) -> None:
    result = navigate_document_tree(document_tree, " I. Facts  ›  A. Background ")

    assert result.error is None
    assert result.section == "I. Facts › A. Background"
    assert len(result.entries) == 1
    assert result.entries[0].node_id == "n3"
    assert result.entries[0].text == "The written notice preceded the hearing."
    assert result.entries[0].section == "I. Facts › A. Background"
    assert result.entries[0].page == 2


def test_navigation_reports_an_unknown_section(document_tree: DocumentNode) -> None:
    result = navigate_document_tree(document_tree, "III. Disposition")

    assert result.entries == []
    assert result.error == "Section not found: III. Disposition"
