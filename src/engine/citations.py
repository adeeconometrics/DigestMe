"""Traceable legal-citation enumeration over a TypeScript document context tree.

Commentaries cite authorities inline (G.R. numbers, case names, SEC opinions,
statutes, and cross-references). This module sweeps block text for each citation
family and returns windowed hits so an agent can enumerate jurisprudence for a
digest's ``cases`` field and statutory references for ``related_provisions``.
"""

from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from .document import DocumentNode, flatten_tree


CitationFamily = Literal[
    "case_number",
    "case_name",
    "sec_opinion",
    "statute",
    "cross_reference",
]

CITATION_FAMILIES: tuple[CitationFamily, ...] = (
    "case_number",
    "case_name",
    "sec_opinion",
    "statute",
    "cross_reference",
)

#: Supreme Court docket numbers, e.g. "G.R. No. 123456", "G.R. No. L-12345",
#: "G.R. Nos. 123456-58".
CASE_NUMBER_PATTERN = re.compile(
    r"G\.?\s*R\.?\s*(?:No\.?|Nos\.?)\s*[A-Z]?\d+(?:\s*-\s*\d+)*",
    re.IGNORECASE,
)

#: Case names of the form "People v. Santos" or "Foo Corp. vs. Bar Inc."
CASE_NAME_PATTERN = re.compile(
    r"\b[A-Z][A-Za-z0-9'&-]*\.?(?:\s+[A-Z][A-Za-z0-9'&-]*\.?)*\s+v(?:s)?\.\s+"
    r"[A-Z][A-Za-z0-9'&-]*\.?(?:\s+[A-Z][A-Za-z0-9'&-]*\.?)*"
)

#: SEC opinions and memorandum circulars, e.g. "SEC Opinion No. 20-01",
#: "SEC MC No. 28, s. 2020", "SEC Memorandum Circular No. 28".
SEC_OPINION_PATTERN = re.compile(
    r"SEC\s+(?:Opinion(?:\s+No\.?)?\s*[\w-]+|MC(?:\s+No\.?)?\s*[\w-]+|"
    r"Memorandum\s+Circular(?:\s+No\.?)?\s*[\w-]+|Circular(?:\s+No\.?)?\s*[\w-]+|Opinion)",
    re.IGNORECASE,
)

#: Enacted laws, e.g. "Republic Act No. 11232", "RA 11232", "B.P. Blg. 68",
#: "PD 902-A", "Commonwealth Act No. 473".
STATUTE_PATTERN = re.compile(
    r"(?:(?:Republic\s+Act|Presidential\s+Decree|Commonwealth\s+Act|RA|PD|CA)"
    r"(?:\s+No\.?)?\s*\d+(?:-\w+)?|B\.?\s*P\.?\s+Blg\.?\s*\d+(?:-\w+)?)",
    re.IGNORECASE,
)

#: In-text statutory cross-references, e.g. "Sec. 23", "Secs. 21-40",
#: "Section 5", "Art. XII".
CROSS_REFERENCE_PATTERN = re.compile(
    r"(?:Sec(?:tion|s|tions)?|Art(?:icle|icles)?)\.?\s*\d+(?:\s*[-–]\s*\d+)?",
    re.IGNORECASE,
)

_FAMILY_PATTERNS: dict[CitationFamily, re.Pattern[str]] = {
    "case_number": CASE_NUMBER_PATTERN,
    "case_name": CASE_NAME_PATTERN,
    "sec_opinion": SEC_OPINION_PATTERN,
    "statute": STATUTE_PATTERN,
    "cross_reference": CROSS_REFERENCE_PATTERN,
}


class CitationHit(BaseModel):
    """One citation match with the source reference needed for follow-up."""

    model_config = ConfigDict(extra="forbid", strict=True)

    node_id: str
    label: str
    section: str
    page: int | None
    snippet: str
    citation: str
    family: CitationFamily


class CitationResult(BaseModel):
    """Citation-sweep output, including the requested family and optional error."""

    model_config = ConfigDict(extra="forbid", strict=True)

    family: str | None
    hits: list[CitationHit] = Field(default_factory=list)
    total: int = 0
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


def find_citations_in_document(
    root: DocumentNode,
    family: str | None = None,
    limit: int = 20,
    offset: int = 0,
) -> CitationResult:
    """Sweep block text for legal citations, one hit per distinct match.

    ``family`` selects a single citation family (see ``CITATION_FAMILIES``);
    when omitted every family is swept. ``offset``/``limit`` page through the
    matches and ``total`` reports the full count before windowing. Duplicate
    citations within one node are reported once.
    """
    if family is not None and family not in _FAMILY_PATTERNS:
        expected = ", ".join(CITATION_FAMILIES)
        return CitationResult(
            family=family,
            error=f"Unknown citation family: {family}. Expected one of: {expected}",
        )
    if offset < 0:
        return CitationResult(family=family, error="offset must be non-negative")
    if limit <= 0:
        return CitationResult(family=family)

    if family is not None:
        family_key: CitationFamily = family
        patterns: dict[CitationFamily, re.Pattern[str]] = {
            family_key: _FAMILY_PATTERNS[family_key]
        }
    else:
        patterns = _FAMILY_PATTERNS

    hits: list[CitationHit] = []
    seen: set[tuple[str, str, str]] = set()
    for node in flatten_tree(root):
        if node.kind == "document" or node.text is None:
            continue

        for hit_family, pattern in patterns.items():
            for match in pattern.finditer(node.text):
                citation = match.group(0).strip().rstrip(".")
                key = (node.id, hit_family, citation)
                if key in seen:
                    continue
                seen.add(key)
                hits.append(
                    CitationHit(
                        node_id=node.id,
                        label=node.label,
                        section=node.section,
                        page=node.page,
                        snippet=_snippet(node.text, match),
                        citation=citation,
                        family=hit_family,
                    )
                )

    return CitationResult(
        family=family,
        hits=hits[offset : offset + limit],
        total=len(hits),
    )
