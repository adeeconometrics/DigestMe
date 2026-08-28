"""Document-tree models and navigation helpers for the agent tools."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


DocumentNodeKind = Literal["document", "section", "block"]

MAX_NAVIGATION_DEPTH = 3
"""Deepest subtree flattening exposed to agent navigation."""


class DocumentNode(BaseModel):
    """Serializable node shape produced by the TypeScript PDF context tree."""

    model_config = ConfigDict(extra="forbid", strict=True)

    id: str
    kind: DocumentNodeKind
    label: str
    heading: str | None = None
    section: str
    page: int | None = None
    text: str | None = None
    children: list[DocumentNode] = Field(default_factory=list)


class DocumentReference(BaseModel):
    """A source node reference that can be highlighted by the browser UI."""

    model_config = ConfigDict(extra="forbid", strict=True)

    node_id: str
    kind: DocumentNodeKind
    label: str
    section: str
    page: int | None
    snippet: str


class NavigationEntry(BaseModel):
    """One child exposed by document navigation with its source reference."""

    model_config = ConfigDict(extra="forbid", strict=True)

    node_id: str
    kind: DocumentNodeKind
    label: str
    heading: str | None = None
    section: str
    page: int | None
    text: str | None = None
    child_count: int = 0
    depth: int = 1


class NavigationResult(BaseModel):
    """A document outline or the contents of one selected section."""

    model_config = ConfigDict(extra="forbid", strict=True)

    requested_section: str | None
    section: str | None = None
    page: int | None = None
    entries: list[NavigationEntry] = Field(default_factory=list)
    error: str | None = None
    total: int = 0


def flatten_tree(root: DocumentNode) -> list[DocumentNode]:
    """Return all nodes in stable depth-first order."""
    nodes: list[DocumentNode] = []

    def visit(node: DocumentNode) -> None:
        nodes.append(node)
        for child in node.children:
            visit(child)

    visit(root)
    return nodes


def reference_for_node(node: DocumentNode) -> DocumentReference:
    """Convert a tree node into the compact source reference sent to the UI."""
    source = (node.text or node.label).strip()
    if len(source) > 180:
        source = f"{source[:177]}..."
    return DocumentReference(
        node_id=node.id,
        kind=node.kind,
        label=node.label,
        section=node.section,
        page=node.page,
        snippet=source,
    )


def find_section(root: DocumentNode, section_path: str) -> DocumentNode | None:
    """Find a section by its path or, when the path falls outside the truncated
    label, by its full untruncated ``heading``."""
    normalized_path = " ".join(section_path.split()).strip()
    if not normalized_path:
        return None

    for node in flatten_tree(root):
        if node.kind == "document" and node.section == normalized_path:
            return node
        if node.kind == "section" and node.section == normalized_path:
            return node
    for node in flatten_tree(root):
        if (
            node.kind == "section"
            and node.heading
            and " ".join(node.heading.split()) == normalized_path
        ):
            return node
    return None


def _navigation_entry(node: DocumentNode, depth: int = 1) -> NavigationEntry:
    return NavigationEntry(
        node_id=node.id,
        kind=node.kind,
        label=node.label,
        heading=node.heading,
        section=node.section,
        page=node.page,
        text=node.text if node.kind == "block" else None,
        child_count=len(node.children),
        depth=depth,
    )


def _collect_entries(
    node: DocumentNode,
    current_depth: int,
    max_depth: int,
    out: list[NavigationEntry],
) -> None:
    """Flatten a subtree into depth-tagged entries in document reading order."""
    for child in node.children:
        out.append(_navigation_entry(child, current_depth))
        if current_depth < max_depth:
            _collect_entries(child, current_depth + 1, max_depth, out)


def navigate_document_tree(
    root: DocumentNode,
    section_path: str | None = None,
    depth: int = 1,
    offset: int = 0,
    limit: int = 10,
) -> NavigationResult:
    """Return the root outline or a bounded window into a section's subtree.

    ``depth`` controls how many levels are flattened in one call (1 = immediate
    children), while ``offset``/``limit`` page through the flattened entries and
    ``total`` reports the full count before windowing so agents know more exist.
    """
    if depth < 1 or depth > MAX_NAVIGATION_DEPTH:
        return NavigationResult(
            requested_section=section_path,
            error=f"depth must be between 1 and {MAX_NAVIGATION_DEPTH}",
        )
    if offset < 0:
        return NavigationResult(
            requested_section=section_path,
            error="offset must be non-negative",
        )

    if section_path is None:
        target = root
    else:
        selected = find_section(root, section_path)
        if selected is None:
            return NavigationResult(
                requested_section=section_path,
                error=f"Section not found: {section_path}",
            )
        target = selected

    flattened: list[NavigationEntry] = []
    _collect_entries(target, 1, depth, flattened)
    if limit <= 0:
        return NavigationResult(
            requested_section=section_path,
            section=target.section,
            page=target.page,
            total=0,
        )

    return NavigationResult(
        requested_section=section_path,
        section=target.section,
        page=target.page,
        entries=flattened[offset : offset + limit],
        total=len(flattened),
    )
