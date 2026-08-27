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
from .search import SearchHit, SearchResult, search_document
from .tools import DocumentContext, global_search, navigate_document

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
    "reference_for_node",
    "search_document",
]
