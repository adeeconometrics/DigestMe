"""Case-digest engine package."""

from .agent import AGENT_INSTRUCTIONS, build_agent, build_openrouter_agent
from .document import (
    DocumentNode,
    NavigationEntry,
    NavigationResult,
    find_section,
    flatten_tree,
    navigate_document_tree,
)
from .schemas import CaseDigest, CaseDigestFacts, CaseDigestIssue
from .search import SearchHit, SearchResult, search_document
from .tools import DocumentContext, global_search, navigate_document

__all__ = [
    "AGENT_INSTRUCTIONS",
    "CaseDigest",
    "CaseDigestFacts",
    "CaseDigestIssue",
    "DocumentContext",
    "DocumentNode",
    "NavigationEntry",
    "NavigationResult",
    "SearchHit",
    "SearchResult",
    "build_agent",
    "build_openrouter_agent",
    "find_section",
    "flatten_tree",
    "global_search",
    "navigate_document",
    "navigate_document_tree",
    "search_document",
]
