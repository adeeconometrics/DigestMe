"""JSON bridge used by the browser's Pyodide worker."""

from __future__ import annotations

import json
from collections.abc import Mapping
from time import perf_counter
from typing import Any

from pydantic_ai import Agent

from .agent import build_chat_openrouter_agent, build_openrouter_agent
from .document import DocumentNode
from .schemas import CaseDigest, CaseDigestResult, ChatAnswer
from .tools import DocumentContext


DIGEST_PROMPT = "Create a complete case digest from the supplied source document."


def _context(root: DocumentNode | Mapping[str, object]) -> DocumentContext:
    """Validate a JSON tree and create a fresh per-run dependency context."""
    document = root if isinstance(root, DocumentNode) else DocumentNode.model_validate(root)
    return DocumentContext(root=document, document_name=document.label)


def _elapsed_ms(started_at: float) -> int:
    """Return a non-negative integer duration suitable for UI metadata."""
    return max(0, round((perf_counter() - started_at) * 1000))


async def run_case_digest(
    root: DocumentNode | Mapping[str, object],
    *,
    api_key: str,
    model_name: str,
    agent: Agent[DocumentContext, CaseDigest] | None = None,
) -> CaseDigestResult:
    """Run the structured case-digest agent and retain its source references."""
    started_at = perf_counter()
    context = _context(root)
    runner = agent or build_openrouter_agent(api_key=api_key, model_name=model_name)
    result = await runner.run(DIGEST_PROMPT, deps=context)
    return CaseDigestResult(
        digest=result.output,
        references=context.to_references(),
        model=model_name,
        elapsed_ms=_elapsed_ms(started_at),
    )


async def run_chat(
    root: DocumentNode | Mapping[str, object],
    question: str,
    *,
    api_key: str,
    model_name: str,
    agent: Agent[DocumentContext, str] | None = None,
) -> ChatAnswer:
    """Run the markdown chat agent and retain its source references."""
    normalized_question = question.strip()
    if not normalized_question:
        raise ValueError("Question must not be empty")

    started_at = perf_counter()
    context = _context(root)
    runner = agent or build_chat_openrouter_agent(api_key=api_key, model_name=model_name)
    result = await runner.run(normalized_question, deps=context)
    markdown = result.output.strip()
    if not markdown:
        raise ValueError("The agent returned an empty answer")
    return ChatAnswer(
        markdown=markdown,
        references=context.to_references(),
        model=model_name,
        elapsed_ms=_elapsed_ms(started_at),
    )


def _required_string(request: Mapping[str, object], key: str) -> str:
    """Read a required string from a JSON request."""
    value = request.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{key} must be a non-empty string")
    return value


def _required_root(request: Mapping[str, object]) -> Mapping[str, object]:
    """Read the serialized document root from a JSON request."""
    value = request.get("root")
    if not isinstance(value, Mapping):
        raise ValueError("root must be a document object")
    return value


async def run_request(payload: str) -> str:
    """Dispatch one JSON request and return JSON for safe JS/Python boundary crossing."""
    request: Any = json.loads(payload)
    if not isinstance(request, Mapping):
        raise ValueError("Request must be a JSON object")

    command = _required_string(request, "command")
    root = _required_root(request)
    api_key = _required_string(request, "api_key")
    model_name = _required_string(request, "model_name")

    if command == "digest":
        return (
            await run_case_digest(root, api_key=api_key, model_name=model_name)
        ).model_dump_json()
    if command == "chat":
        result = await run_chat(
            root,
            _required_string(request, "question"),
            api_key=api_key,
            model_name=model_name,
        )
        return result.model_dump_json()

    raise ValueError(f"Unknown command: {command}")
