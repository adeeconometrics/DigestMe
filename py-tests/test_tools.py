"""Tests for agent-tool retrieval budgets and defaults."""

from engine.citations import find_citations_in_document
from engine.document import DocumentNode
from engine.search import search_document, search_document_ranked
from engine.tools import REFERENCE_LIMIT, SEARCH_LIMIT, DocumentContext


def _busy_tree(block_count: int) -> DocumentNode:
    """A single-section tree whose blocks each cite 'Sec. N' and mention 'alpha'."""
    blocks = [
        {
            "id": f"n{index}",
            "kind": "block",
            "label": f"See Sec. {index}, alpha",
            "section": "S",
            "page": index,
            "text": f"See Sec. {index}, alpha",
            "children": [],
        }
        for index in range(1, block_count + 1)
    ]
    return DocumentNode.model_validate(
        {
            "id": "n0",
            "kind": "document",
            "label": "Book",
            "heading": "Book",
            "section": "Book",
            "page": None,
            "children": [
                {
                    "id": "s1",
                    "kind": "section",
                    "label": "S",
                    "heading": "S",
                    "section": "S",
                    "page": 1,
                    "children": blocks,
                }
            ],
        }
    )


def test_reference_limit_caps_remembered_sources() -> None:
    tree = _busy_tree(18)
    ctx = DocumentContext(root=tree)

    for index in range(1, 19):
        ctx.remember(f"n{index}")

    references = ctx.to_references()
    assert len(references) == REFERENCE_LIMIT
    assert [ref.node_id for ref in references] == [f"n{index}" for index in range(1, REFERENCE_LIMIT + 1)]


def test_remembering_the_same_source_does_not_double_count() -> None:
    tree = _busy_tree(3)
    ctx = DocumentContext(root=tree)

    ctx.remember("n1")
    ctx.remember("n1")

    assert [ref.node_id for ref in ctx.to_references()] == ["n1"]


def test_search_functions_default_to_the_widened_window() -> None:
    tree = _busy_tree(25)

    regex = search_document(tree, "alpha")
    ranked = search_document_ranked(tree, "alpha")

    assert regex.total == 25
    assert len(regex.hits) == SEARCH_LIMIT
    assert ranked.total == 25
    assert len(ranked.hits) == SEARCH_LIMIT


def test_citation_sweep_defaults_to_the_widened_window() -> None:
    tree = _busy_tree(25)

    result = find_citations_in_document(tree, family="cross_reference")

    assert result.total == 25
    assert len(result.hits) == SEARCH_LIMIT
