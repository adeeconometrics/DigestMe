"""JSON bridge used by the browser's Pyodide worker."""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterable, AsyncIterator, Callable, Mapping
from time import perf_counter
from typing import Any, Literal, TypedDict

from pydantic_ai import Agent, AgentStreamEvent, RunContext
from pydantic_ai.messages import PartDeltaEvent, PartStartEvent, ThinkingPart, ThinkingPartDelta

from .agent import build_chat_openrouter_agent, build_openrouter_agent
from .document import DocumentNode
from .schemas import CaseDigest, CaseDigestResult, ChatAnswer
from .tools import DocumentContext


DIGEST_PROMPT = "Create a complete case digest from the supplied source document."


class ChatStreamDelta(TypedDict):
    """One incremental thinking or answer-text update."""

    type: Literal["thinking", "text"]
    delta: str


class ChatStreamFinal(TypedDict):
    """The validated answer emitted after all streamed output is complete."""

    type: Literal["final"]
    answer: ChatAnswer


ChatStreamEvent = ChatStreamDelta | ChatStreamFinal


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


def _thinking_delta(event: AgentStreamEvent) -> str | None:
    """Extract visible thinking content from one pydantic-ai stream event."""
    if isinstance(event, PartStartEvent) and isinstance(event.part, ThinkingPart):
        return event.part.content or None
    if isinstance(event, PartDeltaEvent) and isinstance(event.delta, ThinkingPartDelta):
        return event.delta.content_delta or None
    return None


async def run_chat_stream(
    root: DocumentNode | Mapping[str, object],
    question: str,
    *,
    api_key: str,
    model_name: str,
    agent: Agent[DocumentContext, str] | None = None,
) -> AsyncIterator[ChatStreamEvent]:
    """Stream thinking and markdown text, then yield the validated chat answer."""
    normalized_question = question.strip()
    if not normalized_question:
        raise ValueError("Question must not be empty")

    started_at = perf_counter()
    context = _context(root)
    runner = agent or build_chat_openrouter_agent(api_key=api_key, model_name=model_name)
    queue: asyncio.Queue[ChatStreamEvent | Exception | None] = asyncio.Queue(maxsize=1)

    async def handle_events(
        _run_context: RunContext[DocumentContext],
        events: AsyncIterable[AgentStreamEvent],
    ) -> None:
        async for event in events:
            delta = _thinking_delta(event)
            if delta:
                await queue.put({"type": "thinking", "delta": delta})

    async def produce() -> None:
        try:
            async with runner.run_stream(
                normalized_question,
                deps=context,
                event_stream_handler=handle_events,
            ) as response:
                async for delta in response.stream_text(delta=True, debounce_by=None):
                    if delta:
                        await queue.put({"type": "text", "delta": delta})

                markdown = (await response.get_output()).strip()
                if not markdown:
                    raise ValueError("The agent returned an empty answer")
                answer = ChatAnswer(
                    markdown=markdown,
                    references=context.to_references(),
                    model=model_name,
                    elapsed_ms=_elapsed_ms(started_at),
                )
                await queue.put({"type": "final", "answer": answer})
        except Exception as error:  # pylint: disable=broad-exception-caught
            # Surface every agent failure through the async stream consumer.
            await queue.put(error)
        else:
            await queue.put(None)

    producer = asyncio.create_task(produce())
    try:
        while True:
            item = await queue.get()
            if item is None:
                return
            if isinstance(item, Exception):
                raise item
            yield item
    finally:
        if not producer.done():
            producer.cancel()
        try:
            await producer
        except asyncio.CancelledError:
            pass


def _stream_event_json(event: ChatStreamEvent) -> str:
    """Serialize one stream event for the JavaScript callback boundary."""
    if event["type"] == "final":
        return json.dumps({"type": "final", "result": event["answer"].model_dump(mode="json")})
    return json.dumps(event)


# The optional injected agent keeps the bridge helper deterministic in offline tests.
# pylint: disable=too-many-arguments
async def _run_chat_stream_request(
    root: DocumentNode | Mapping[str, object],
    question: str,
    *,
    api_key: str,
    model_name: str,
    stream_callback: Callable[[str], Any] | None,
    agent: Agent[DocumentContext, str] | None = None,
) -> ChatAnswer:
    """Consume a chat stream, forwarding events and retaining its final answer."""
    final_answer: ChatAnswer | None = None
    async for event in run_chat_stream(
        root,
        question,
        api_key=api_key,
        model_name=model_name,
        agent=agent,
    ):
        if stream_callback is not None:
            stream_callback(_stream_event_json(event))
        if event["type"] == "final":
            final_answer = event["answer"]

    if final_answer is None:
        raise RuntimeError("The chat stream ended without a final answer")
    return final_answer


# pylint: enable=too-many-arguments


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


async def run_request(payload: str, stream_callback: Callable[[str], Any] | None = None) -> str:
    """Dispatch one JSON request and return JSON for safe JS/Python boundary crossing."""
    request: Any = json.loads(payload)
    if not isinstance(request, Mapping):
        raise ValueError("Request must be a JSON object")

    command = _required_string(request, "command")
    root = _required_root(request)
    api_key = _required_string(request, "api_key")
    model_name = _required_string(request, "model_name")
    stream = request.get("stream", False)
    if not isinstance(stream, bool):
        raise ValueError("stream must be a boolean")

    if command == "digest":
        return (
            await run_case_digest(root, api_key=api_key, model_name=model_name)
        ).model_dump_json()
    if command == "chat":
        if stream:
            return (
                await _run_chat_stream_request(
                    root,
                    _required_string(request, "question"),
                    api_key=api_key,
                    model_name=model_name,
                    stream_callback=stream_callback,
                )
            ).model_dump_json()
        result = await run_chat(
            root,
            _required_string(request, "question"),
            api_key=api_key,
            model_name=model_name,
        )
        return result.model_dump_json()

    raise ValueError(f"Unknown command: {command}")
