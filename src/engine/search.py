"""Traceable regex search over a TypeScript document context tree."""

from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from .document import DocumentNode, flatten_tree


SearchField = Literal["label", "section", "text"]


class SearchHit(BaseModel):
    """A matching node and the source reference needed for follow-up navigation."""

    model_config = ConfigDict(extra="forbid", strict=True)

    node_id: str
    label: str
    section: str
    page: int | None
    snippet: str
    matched_field: SearchField


class SearchResult(BaseModel):
    """Global-search output, including a traceable pattern and optional error."""

    model_config = ConfigDict(extra="forbid", strict=True)

    pattern: str
    hits: list[SearchHit] = Field(default_factory=list)
    error: str | None = None


def _snippet(value: str, match: re.Match[str], limit: int = 180) -> str:
    """Keep a useful window around a match while bounding tool output."""
    if len(value) <= limit:
        return value

    half_window = max(1, (limit - 3) // 2)
    start = max(0, match.start() - half_window)
    end = min(len(value), start + limit - 3)
    if end - start < limit - 3:
        start = max(0, end - (limit - 3))

    prefix = "..." if start > 0 else ""
    suffix = "..." if end < len(value) else ""
    return f"{prefix}{value[start:end]}{suffix}"


def search_document(root: DocumentNode, pattern: str, limit: int = 10) -> SearchResult:
    """Search node text, labels, and section paths with a case-insensitive regex."""
    if not pattern:
        return SearchResult(pattern=pattern, error="Search pattern must not be empty.")

    try:
        matcher = re.compile(pattern, re.IGNORECASE)
    except re.error as error:
        return SearchResult(pattern=pattern, error=f"Invalid search pattern: {error}")

    if limit <= 0:
        return SearchResult(pattern=pattern)

    hits: list[SearchHit] = []
    for node in flatten_tree(root):
        if node.kind == "document":
            continue

        values: list[tuple[SearchField, str]] = [("label", node.label), ("section", node.section)]
        if node.text is not None:
            values.insert(0, ("text", node.text))
        for field, value in values:
            match = matcher.search(value)
            if match is None:
                continue

            source = node.text or node.label
            source_match = matcher.search(source) or match
            hits.append(
                SearchHit(
                    node_id=node.id,
                    label=node.label,
                    section=node.section,
                    page=node.page,
                    snippet=_snippet(source, source_match),
                    matched_field=field,
                )
            )
            break

        if len(hits) >= limit:
            break

    return SearchResult(pattern=pattern, hits=hits)
