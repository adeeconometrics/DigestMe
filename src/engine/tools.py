"""Pydantic AI tools backed by pure document-tree utilities."""

from dataclasses import dataclass, field

from pydantic_ai import RunContext

from .document import (
    DocumentNode,
    DocumentReference,
    NavigationResult,
    find_section,
    navigate_document_tree,
    reference_for_node,
)
from .search import RankedSearchResult, SearchResult, search_document, search_document_ranked


REFERENCE_LIMIT = 8


@dataclass
class DocumentContext:
    """Dependencies supplied by the TypeScript/pyodide bridge for one document."""

    root: DocumentNode
    document_name: str = "Document"
    _referenced_node_ids: list[str] = field(default_factory=list, repr=False)

    def remember(self, node_id: str) -> None:
        """Remember a non-root node returned by a retrieval tool."""
        if len(self._referenced_node_ids) >= REFERENCE_LIMIT or node_id in self._referenced_node_ids:
            return
        node = next((candidate for candidate in _flatten_without_root(self.root) if candidate.id == node_id), None)
        if node is not None:
            self._referenced_node_ids.append(node.id)

    def remember_section(self, section: str | None) -> None:
        """Remember the section being inspected, when it is a visible tree node."""
        if section is None:
            return
        node = find_section(self.root, section)
        if node is not None and node.kind != "document":
            self.remember(node.id)

    def to_references(self) -> list[DocumentReference]:
        """Return the source references in the order the agent encountered them."""
        nodes = {node.id: node for node in _flatten_without_root(self.root)}
        return [reference_for_node(nodes[node_id]) for node_id in self._referenced_node_ids if node_id in nodes]


def _flatten_without_root(root: DocumentNode) -> list[DocumentNode]:
    """Flatten the tree without exposing the document container as a citation."""
    nodes: list[DocumentNode] = []

    def visit(node: DocumentNode) -> None:
        if node.kind != "document":
            nodes.append(node)
        for child in node.children:
            visit(child)

    for child in root.children:
        visit(child)
    return nodes


def navigate_document(ctx: RunContext[DocumentContext], section_path: str | None = None) -> NavigationResult:
    """Inspect the outline or retrieve a section's immediate contents and source references.

    Call this without a path first to understand the document tree. Then pass an exact ``section``
    path from an entry to inspect that section's children and their ``page`` values.
    """
    result = navigate_document_tree(ctx.deps.root, section_path)
    ctx.deps.remember_section(result.section)
    for entry in result.entries:
        ctx.deps.remember(entry.node_id)
    return result


def global_search(ctx: RunContext[DocumentContext], pattern: str, limit: int = 10) -> SearchResult:
    """Search the document with a case-insensitive regex when section labels are insufficient.

    Each hit includes a node id, ``section``, and ``page`` reference. Use ``navigate_document``
    with the returned section path to retrieve the surrounding context before reasoning.
    """
    result = search_document(ctx.deps.root, pattern, limit)
    for hit in result.hits:
        ctx.deps.remember(hit.node_id)
    return result


def ranked_search(ctx: RunContext[DocumentContext], query: str, limit: int = 10) -> RankedSearchResult:
    """Rank every section and block by plain term overlap with the query.

    Unlike ``global_search``, this tolerates paraphrase: tokens are scored by
    presence and frequency across node text, labels, and section paths, so a
    query can use different words than the source. Use it to locate the best
    passages when exact spelling is unknown, then navigate to the top hits.
    """
    result = search_document_ranked(ctx.deps.root, query, limit)
    for hit in result.hits:
        ctx.deps.remember(hit.node_id)
    return result
