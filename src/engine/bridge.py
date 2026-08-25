"""JSON bridge used by the browser's Pyodide worker."""

from __future__ import annotations

import json
from collections.abc import Awaitable, Callable, Mapping
from contextlib import AbstractAsyncContextManager
from time import perf_counter, time_ns
from typing import Any

from pydantic_ai import Agent, AgentRunEvents, AgentRunResult, capture_run_messages
from pydantic_ai.exceptions import (
    ContentFilterError,
    ModelAPIError,
    ToolRetryError,
    UnexpectedModelBehavior,
    UsageLimitExceeded,
)
from pydantic_ai.messages import (
    ModelMessage,
    ModelResponse,
    PartDeltaEvent,
    PartEndEvent,
    PartStartEvent,
    TextPart,
    TextPartDelta,
    ThinkingPart,
    ThinkingPartDelta,
    ToolCallEvent,
    ToolCallPart,
    ToolCallPartDelta,
    ToolResultEvent,
)
from pydantic_ai.run import AgentRunResultEvent
from pydantic_core import ValidationError

from .agent import build_chat_openrouter_agent, build_openrouter_agent
from .document import DocumentNode
from .schemas import CaseDigest, CaseDigestResult, ChatAnswer
from .tools import DocumentContext


DIGEST_PROMPT = "Create a complete case digest from the supplied source document."
StreamEmitter = Callable[[str], object]
RequestStreamEmitter = Callable[[int, str], object]
_REQUEST_PAYLOADS: dict[int, str] = {}

_AGENT_RUN_ERRORS = (
    ToolRetryError,
    UnexpectedModelBehavior,
    ModelAPIError,
    UsageLimitExceeded,
    ContentFilterError,
    ValidationError,
)


class AgentRunError(RuntimeError):
    """User-facing failure raised when an agent run cannot recover."""


def _validation_error_details(error: BaseException) -> list[str]:
    """Find structured-output validation details hidden in an agent error chain."""
    seen: set[int] = set()
    pending: list[BaseException] = [error]
    while pending:
        cause = pending.pop()
        if id(cause) in seen:
            continue
        seen.add(id(cause))
        if isinstance(cause, ValidationError):
            details: list[str] = []
            for detail in cause.errors():
                location = ".".join(str(part) for part in detail.get("loc", ())) or "result"
                message = str(detail.get("msg", "")).strip()
                details.append(f"{location}: {message}" if message else location)
            return details
        if cause.__context__ is not None:
            pending.append(cause.__context__)
        if cause.__cause__ is not None:
            pending.append(cause.__cause__)
    return []


def _agent_error_message(error: BaseException) -> str:
    """Translate an internal agent failure into a short actionable message."""
    message = (str(error).strip() or type(error).__name__).splitlines()[0].strip()
    if len(message) > 240:
        message = f"{message[:237]}..."

    details = _validation_error_details(error)
    if details:
        visible_details = details[:6]
        detail_text = "; ".join(visible_details)
        if len(details) > len(visible_details):
            detail_text += f"; and {len(details) - len(visible_details)} more"
        result = f"The model could not produce a valid result: {message} Validation errors: {detail_text}."
        if any(detail.startswith("result: Invalid JSON") for detail in details):
            result += (
                " The reply may have been cut off before it finished;"
                " try again or use a model with a larger output limit."
            )
        return result

    if isinstance(error, ToolRetryError):
        return f"The agent could not recover from repeated invalid model output: {message}"
    if isinstance(error, UnexpectedModelBehavior):
        return f"The model could not produce a valid result: {message}"
    return f"The agent run failed: {message}"


def _last_reply_diagnostic(messages: list[ModelMessage]) -> str | None:
    """Summarize the final model reply without exposing its contents."""
    for message in reversed(messages):
        if not isinstance(message, ModelResponse):
            continue

        parts: list[str] = []
        if message.finish_reason is not None:
            parts.append(f"finish_reason={message.finish_reason}")
        output_tokens = getattr(message.usage, "output_tokens", None)
        if output_tokens:
            parts.append(f"output_tokens={output_tokens}")

        reply_parts: list[str] = []
        for part in message.parts:
            if isinstance(part, TextPart):
                reply_parts.append(f"text {len(part.content)} chars")
            elif isinstance(part, ToolCallPart):
                size = f"{len(part.args)} chars" if isinstance(part.args, str) else "structured args"
                reply_parts.append(f"{part.tool_name} {size}")
        if reply_parts:
            parts.append(f"reply: {', '.join(reply_parts)}")
        return "; ".join(parts) if parts else None
    return None


def _translate_agent_error(
    error: BaseException,
    run_messages: list[ModelMessage] | None = None,
) -> AgentRunError:
    """Wrap a failed agent run while retaining safe diagnostic context."""
    if isinstance(error, AgentRunError):
        return error
    message = _agent_error_message(error)
    diagnostic = _last_reply_diagnostic(run_messages or [])
    if diagnostic is not None:
        message = f"{message} [reply: {diagnostic}]"
    return AgentRunError(message)


def _context(root: DocumentNode | Mapping[str, object]) -> DocumentContext:
    """Validate a JSON tree and create a fresh per-run dependency context."""
    document = root if isinstance(root, DocumentNode) else DocumentNode.model_validate(root)
    return DocumentContext(root=document, document_name=document.label)


def _elapsed_ms(started_at: float) -> int:
    """Return a non-negative integer duration suitable for UI metadata."""
    return max(0, round((perf_counter() - started_at) * 1000))


def _epoch_ms() -> int:
    """Return the current wall-clock time for cross-runtime execution metadata."""
    return time_ns() // 1_000_000


def _emit_stream_event(emit: StreamEmitter, event: Mapping[str, object]) -> None:
    """Serialize one stream event before crossing the Pyodide/JavaScript boundary."""
    emit(json.dumps(event, separators=(",", ":"), ensure_ascii=True, default=str))


def _tool_content(content: object) -> str:
    """Make a tool result safe and readable in the browser activity log."""
    if isinstance(content, str):
        return content
    if content is None:
        return ""
    return json.dumps(content, ensure_ascii=True, default=str)


def _part_kind(part: object) -> str | None:
    """Map supported Pydantic AI response parts to the browser stream vocabulary."""
    if isinstance(part, TextPart):
        return "text"
    if isinstance(part, ThinkingPart):
        return "thinking"
    if isinstance(part, ToolCallPart):
        return "tool-call"
    return None


def _emit_agent_event(emit: StreamEmitter, event: object) -> None:  # pylint: disable=too-many-return-statements,too-many-branches
    """Translate Pydantic AI lifecycle events into a small browser-facing protocol."""
    if isinstance(event, PartStartEvent):
        kind = _part_kind(event.part)
        if kind is None:
            return
        payload: dict[str, object] = {"type": "part-start", "index": event.index, "kind": kind}
        if isinstance(event.part, (TextPart, ThinkingPart)):
            payload["content"] = event.part.content
        elif isinstance(event.part, ToolCallPart):
            payload["tool_call_id"] = event.part.tool_call_id
            payload["tool_name"] = event.part.tool_name
            if event.part.args is not None:
                payload["args"] = event.part.args
        _emit_stream_event(emit, payload)
        return

    if isinstance(event, PartDeltaEvent):
        delta_payload: dict[str, object] = {"type": "part-delta", "index": event.index}
        if isinstance(event.delta, TextPartDelta):
            delta_payload["kind"] = "text"
            delta_payload["content_delta"] = event.delta.content_delta
        elif isinstance(event.delta, ThinkingPartDelta):
            delta_payload["kind"] = "thinking"
            if event.delta.content_delta is None:
                return
            delta_payload["content_delta"] = event.delta.content_delta
        elif isinstance(event.delta, ToolCallPartDelta):
            delta_payload["kind"] = "tool-call"
            if event.delta.args_delta is not None:
                delta_payload["args_delta"] = event.delta.args_delta
            if event.delta.tool_name_delta is not None:
                delta_payload["tool_name_delta"] = event.delta.tool_name_delta
            if event.delta.tool_call_id is not None:
                delta_payload["tool_call_id"] = event.delta.tool_call_id
            if len(delta_payload) == 3:
                return
        else:
            return
        _emit_stream_event(emit, delta_payload)
        return

    if isinstance(event, PartEndEvent):
        kind = _part_kind(event.part)
        if kind is None:
            return
        payload = {"type": "part-end", "index": event.index, "kind": kind}
        if isinstance(event.part, ToolCallPart) and event.part.args is not None:
            payload["args"] = event.part.args
        _emit_stream_event(emit, payload)
        return

    if isinstance(event, ToolCallEvent):
        _emit_stream_event(
            emit,
            {
                "type": "tool-call",
                "tool_call_id": event.part.tool_call_id,
                "tool_name": event.part.tool_name,
                "args": event.part.args,
            },
        )
        return

    if isinstance(event, ToolResultEvent):
        _emit_stream_event(
            emit,
            {
                "type": "tool-result",
                "tool_call_id": event.tool_call_id,
                "content": _tool_content(event.part.content),
                "is_error": event.part.part_kind == "retry-prompt",
            },
        )


async def _run_agent(
    factory: Callable[[], Awaitable[AgentRunResult[Any]]],
) -> tuple[AgentRunResult[Any], int]:
    """Run one agent call, capturing messages and elapsed time."""
    started_at = perf_counter()
    run_messages: list[ModelMessage] = []
    try:
        with capture_run_messages() as captured_messages:
            run_messages = captured_messages
            result = await factory()
    except _AGENT_RUN_ERRORS as error:
        raise _translate_agent_error(error, run_messages) from error
    return result, _elapsed_ms(started_at)


async def run_case_digest(
    root: DocumentNode | Mapping[str, object],
    *,
    api_key: str,
    model_name: str,
    agent: Agent[DocumentContext, CaseDigest] | None = None,
) -> CaseDigestResult:
    """Run the structured case-digest agent and retain its source references."""
    context = _context(root)
    runner = agent or build_openrouter_agent(api_key=api_key, model_name=model_name)
    result, elapsed_ms = await _run_agent(lambda: runner.run(DIGEST_PROMPT, deps=context))
    return CaseDigestResult(
        digest=result.output,
        references=context.to_references(),
        model=model_name,
        elapsed_ms=elapsed_ms,
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
    started_at_ms = _epoch_ms()
    normalized_question = question.strip()
    if not normalized_question:
        raise ValueError("Question must not be empty")

    context = _context(root)
    runner = agent or build_chat_openrouter_agent(api_key=api_key, model_name=model_name)
    result, elapsed_ms = await _run_agent(lambda: runner.run(normalized_question, deps=context))
    markdown = result.output.strip()
    if not markdown:
        raise ValueError("The agent returned an empty answer")
    ended_at_ms = _epoch_ms()
    return ChatAnswer(
        markdown=markdown,
        references=context.to_references(),
        model=model_name,
        elapsed_ms=max(elapsed_ms, ended_at_ms - started_at_ms),
        started_at=started_at_ms,
        ended_at=ended_at_ms,
    )


async def _run_agent_stream(
    factory: Callable[[], AbstractAsyncContextManager[AgentRunEvents[Any]]],
    emit: StreamEmitter,
) -> tuple[str, int]:
    """Run one streaming agent call, emitting deltas and capturing the final text."""
    started_at = perf_counter()
    run_messages: list[ModelMessage] = []
    markdown: str | None = None
    try:
        with capture_run_messages() as captured_messages:
            run_messages = captured_messages
            async with factory() as events:
                async for event in events:
                    if isinstance(event, AgentRunResultEvent):
                        if not isinstance(event.result.output, str):
                            raise TypeError("The chat agent returned a non-text answer")
                        markdown = event.result.output.strip()
                    else:
                        _emit_agent_event(emit, event)
    except _AGENT_RUN_ERRORS as error:
        raise _translate_agent_error(error, run_messages) from error
    if markdown is None:
        raise ValueError("The agent returned an empty answer")
    return markdown, _elapsed_ms(started_at)


async def run_chat_stream(  # pylint: disable=too-many-arguments
    root: DocumentNode | Mapping[str, object],
    question: str,
    *,
    api_key: str,
    model_name: str,
    emit: StreamEmitter,
    agent: Agent[DocumentContext, str] | None = None,
) -> ChatAnswer:
    """Run the chat agent while emitting model, thinking, and tool-call deltas."""
    normalized_question = question.strip()
    if not normalized_question:
        raise ValueError("Question must not be empty")

    started_at_ms = _epoch_ms()
    context = _context(root)
    runner = agent or build_chat_openrouter_agent(api_key=api_key, model_name=model_name)
    _emit_stream_event(emit, {"type": "start", "model": model_name, "started_at": started_at_ms})

    markdown, elapsed_ms = await _run_agent_stream(
        lambda: runner.run_stream_events(normalized_question, deps=context),
        emit,
    )
    ended_at_ms = _epoch_ms()
    return ChatAnswer(
        markdown=markdown,
        references=context.to_references(),
        model=model_name,
        elapsed_ms=max(elapsed_ms, ended_at_ms - started_at_ms),
        started_at=started_at_ms,
        ended_at=ended_at_ms,
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


async def run_request(payload: str, request_id: int) -> str:
    """Dispatch one JSON request and return JSON for safe JS/Python boundary crossing."""
    _REQUEST_PAYLOADS[request_id] = payload
    try:
        request: Any = json.loads(_REQUEST_PAYLOADS[request_id])
        if not isinstance(request, Mapping):
            raise ValueError("Request must be a JSON object")

        command = _required_string(request, "command")
        root = _required_root(request)
        api_key = _required_string(request, "api_key")
        model_name = _required_string(request, "model_name")

        if command == "digest":
            return (await run_case_digest(root, api_key=api_key, model_name=model_name)).model_dump_json()
        if command == "chat":
            result = await run_chat(
                root,
                _required_string(request, "question"),
                api_key=api_key,
                model_name=model_name,
            )
            return result.model_dump_json()

        raise ValueError(f"Unknown command: {command}")
    finally:
        _REQUEST_PAYLOADS.pop(request_id, None)


def _bind_stream_request_id(emit: RequestStreamEmitter, request_id: int) -> StreamEmitter:
    """Bind the active request id so the JS dispatcher can route each event."""

    def emit_with_request(payload: str) -> object:
        return emit(request_id, payload)

    return emit_with_request


async def run_request_stream(payload: str, request_id: int, emit: RequestStreamEmitter) -> str:
    """Dispatch a chat request and emit JSON events as the agent executes."""
    _REQUEST_PAYLOADS[request_id] = payload
    try:
        request: Any = json.loads(_REQUEST_PAYLOADS[request_id])
        if not isinstance(request, Mapping):
            raise ValueError("Request must be a JSON object")

        command = _required_string(request, "command")
        if command != "chat":
            raise ValueError("Streaming is only supported for chat requests")

        result = await run_chat_stream(
            _required_root(request),
            _required_string(request, "question"),
            api_key=_required_string(request, "api_key"),
            model_name=_required_string(request, "model_name"),
            emit=_bind_stream_request_id(emit, request_id),
        )
        return result.model_dump_json()
    finally:
        _REQUEST_PAYLOADS.pop(request_id, None)
