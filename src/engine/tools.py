"""Pydantic AI tools backed by pure document-tree utilities."""

from dataclasses import dataclass

from pydantic_ai import RunContext

from .document import DocumentNode, NavigationResult, navigate_document_tree
from .search import SearchResult, search_document


@dataclass(frozen=True)
class DocumentContext:
    """Dependencies supplied by the TypeScript/pyodide bridge for one document."""

    root: DocumentNode
    document_name: str = "Document"


def navigate_document(ctx: RunContext[DocumentContext], section_path: str | None = None) -> NavigationResult:
    """Inspect the outline or retrieve a section's immediate contents and source references.

    Call this without a path first to understand the document tree. Then pass an exact ``section``
    path from an entry to inspect that section's children and their ``page`` values.
    """
    return navigate_document_tree(ctx.deps.root, section_path)


def global_search(ctx: RunContext[DocumentContext], pattern: str, limit: int = 10) -> SearchResult:
    """Search the document with a case-insensitive regex when section labels are insufficient.

    Each hit includes a node id, ``section``, and ``page`` reference. Use ``navigate_document``
    with the returned section path to retrieve the surrounding context before reasoning.
    """
    return search_document(ctx.deps.root, pattern, limit)
