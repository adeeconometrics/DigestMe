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


def test_navigation_flattens_a_subtree_when_depth_increases(document_tree: DocumentNode) -> None:
    result = navigate_document_tree(document_tree, depth=2)

    assert result.error is None
    assert [(entry.node_id, entry.depth) for entry in result.entries] == [
        ("n1", 1),
        ("n2", 2),
        ("n4", 2),
        ("n5", 1),
        ("n6", 2),
    ]
    assert result.total == 5


def test_navigation_windows_flattened_entries_with_offset_and_limit(document_tree: DocumentNode) -> None:
    result = navigate_document_tree(document_tree, depth=2, offset=1, limit=2)

    assert result.error is None
    assert [(entry.node_id, entry.depth) for entry in result.entries] == [("n2", 2), ("n4", 2)]
    assert result.total == 5


def test_navigation_reports_total_for_depth_one_outline(document_tree: DocumentNode) -> None:
    result = navigate_document_tree(document_tree)

    assert result.error is None
    assert result.total == 2


def test_navigation_rejects_depth_out_of_range(document_tree: DocumentNode) -> None:
    too_shallow = navigate_document_tree(document_tree, depth=0)
    too_deep = navigate_document_tree(document_tree, depth=4)

    assert too_shallow.entries == []
    assert too_shallow.error == "depth must be between 1 and 3"
    assert too_deep.entries == []
    assert too_deep.error == "depth must be between 1 and 3"


def test_navigation_rejects_negative_offset(document_tree: DocumentNode) -> None:
    result = navigate_document_tree(document_tree, offset=-1)

    assert result.entries == []
    assert result.error == "offset must be non-negative"


def test_navigation_returns_no_entries_for_non_positive_limit(document_tree: DocumentNode) -> None:
    result = navigate_document_tree(document_tree, limit=0)

    assert result.entries == []
    assert result.total == 0
