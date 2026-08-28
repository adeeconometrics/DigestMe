"""Case-digest engine package."""

from .agent import (
    AGENT_INSTRUCTIONS,
    CHAT_AGENT_INSTRUCTIONS,
    DIGEST_USAGE_LIMITS,
    build_agent,
    build_chat_agent,
    build_chat_deepseek_agent,
    build_chat_openrouter_agent,
    build_deepseek_agent,
    build_openrouter_agent,
)
from .document import (
    DocumentNode,
    DocumentReference,
    NavigationEntry,
    NavigationResult,
    find_section,
    flatten_tree,
    navigate_document_tree,
    reference_for_node,
)
from .schemas import CaseDigest, CaseDigestFacts, CaseDigestIssue, CaseDigestResult, ChatAnswer
from .search import (
    RankedSearchHit,
    RankedSearchResult,
    SearchHit,
    SearchResult,
    search_document,
    search_document_ranked,
)
from .tools import DocumentContext, global_search, navigate_document, ranked_search

__all__ = [
    "AGENT_INSTRUCTIONS",
    "CHAT_AGENT_INSTRUCTIONS",
    "DIGEST_USAGE_LIMITS",
    "CaseDigest",
    "CaseDigestFacts",
    "CaseDigestIssue",
    "CaseDigestResult",
    "ChatAnswer",
    "DocumentContext",
    "DocumentNode",
    "DocumentReference",
    "NavigationEntry",
    "NavigationResult",
    "RankedSearchHit",
    "RankedSearchResult",
    "SearchHit",
    "SearchResult",
    "build_agent",
    "build_chat_agent",
    "build_chat_deepseek_agent",
    "build_chat_openrouter_agent",
    "build_deepseek_agent",
    "build_openrouter_agent",
    "find_section",
    "flatten_tree",
    "global_search",
    "navigate_document",
    "navigate_document_tree",
    "ranked_search",
    "reference_for_node",
    "search_document",
    "search_document_ranked",
]
