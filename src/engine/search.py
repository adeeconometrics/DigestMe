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


class RankedSearchHit(SearchHit):
    """A term-overlap match with the score that produced its ranking."""

    score: float


class RankedSearchResult(BaseModel):
    """Ranked term-overlap search output, with the full match count."""

    model_config = ConfigDict(extra="forbid", strict=True)

    query: str
    hits: list[RankedSearchHit] = Field(default_factory=list)
    total: int = 0


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


def _tokenize(query: str) -> list[str]:
    """Lowercase, strip punctuation, and dedupe tokens of at least three chars."""
    cleaned = re.sub(r"[^a-z0-9\s-]", " ", query.lower())
    return list(dict.fromkeys(token for token in cleaned.split() if len(token) >= 3))


def _count_occurrences(haystack: str, needle: str) -> int:
    """Count non-overlapping substring occurrences, mirroring the browser scorer."""
    count = 0
    at = haystack.find(needle)
    while at >= 0:
        count += 1
        at = haystack.find(needle, at + len(needle))
    return count


def _snippet_ranked(source: str, limit: int = 140) -> str:
    """Keep the leading window of a ranked hit, matching the browser preview."""
    if len(source) <= limit:
        return source
    return f"{source[: limit - 1]}…"


def search_document_ranked(root: DocumentNode, query: str, limit: int = 10) -> RankedSearchResult:
    """Score every tree node with plain term overlap — no network, no model.

    Mirrors the browser-side ``retrieveNodes`` scorer used by local chat:
    longer tokens weigh more, exact phrases get a boost, and section paths
    contribute half weight so headings can be found by name. Paraphrase-tolerant
    where ``search_document``'s regex requires an exact spelling.
    """
    tokens = _tokenize(query)
    if not tokens:
        return RankedSearchResult(query=query)

    phrase = " ".join(tokens)
    ranked: list[RankedSearchHit] = []

    for node in flatten_tree(root):
        if node.kind == "document":
            continue

        body = (node.text or node.label or "").lower()
        path = (node.section or "").lower()

        score = 0
        matched_field: SearchField = "label"
        for token in tokens:
            in_body = _count_occurrences(body, token)
            if in_body > 0:
                score += in_body * len(token)
                matched_field = "text"
            elif token in path:
                score += (len(token) + 1) // 2
                if matched_field == "label":
                    matched_field = "section"

        # Exact phrase presence is the strongest signal; near-phrase follows.
        if phrase in body:
            score += len(phrase) + 8
        elif len(tokens) > 1 and all(token in body for token in tokens):
            score += 6

        if score <= 0:
            continue

        source = (node.text or node.label or "").strip()
        ranked.append(
            RankedSearchHit(
                node_id=node.id,
                label=node.label,
                section=node.section,
                page=node.page,
                snippet=_snippet_ranked(source),
                matched_field=matched_field,
                score=float(score),
            )
        )

    ranked.sort(key=lambda hit: hit.score, reverse=True)
    return RankedSearchResult(query=query, hits=ranked[:limit], total=len(ranked))
