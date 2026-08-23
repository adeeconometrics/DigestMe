"""Tests for the JSON-facing agent bridge."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterable, AsyncIterator, Awaitable, Callable
from typing import Any, cast

import pytest
from pydantic_ai import Agent, AgentStreamEvent
from pydantic_ai.messages import PartDeltaEvent, PartStartEvent, ThinkingPart, ThinkingPartDelta
from pydantic_ai.models.test import TestModel

from engine.agent import build_agent, build_chat_agent
from engine.bridge import ChatStreamEvent, run_case_digest, run_chat, run_chat_stream
from engine.document import DocumentNode
from engine.tools import DocumentContext


def test_run_chat_returns_markdown_and_tool_references(document_tree: DocumentNode) -> None:
    agent = build_chat_agent(
        TestModel(
            call_tools=["navigate_document"],
            custom_output_text="## Holding\n\nThe expulsion was void.",
            model_name="test-chat",
        )
    )

    result = asyncio.run(
        run_chat(
            document_tree,
            "What was the ruling?",
            api_key="unused-in-test",
            model_name="test/chat",
            agent=agent,
        )
    )

    assert result.markdown == "## Holding\n\nThe expulsion was void."
    assert result.model == "test/chat"
    assert result.elapsed_ms >= 0
    assert [reference.node_id for reference in result.references] == ["n1", "n5"]
    assert result.references[0].kind == "section"


class _FakeStreamResponse:
    async def stream_text(self, *, delta: bool, debounce_by: float | None) -> AsyncIterator[str]:
        assert delta is True
        assert debounce_by is None
        yield "Answer"

    async def get_output(self) -> str:
        return "Answer"


StreamEventHandler = Callable[[Any, AsyncIterable[AgentStreamEvent]], Awaitable[None]]


class _FakeStreamContext:
    def __init__(self, event_stream_handler: StreamEventHandler) -> None:
        self.event_stream_handler = event_stream_handler

    async def __aenter__(self) -> _FakeStreamResponse:
        async def events() -> AsyncIterator[AgentStreamEvent]:
            yield PartStartEvent(index=0, part=ThinkingPart(content="Considering "))
            yield PartDeltaEvent(index=0, delta=ThinkingPartDelta(content_delta="the record."))

        await self.event_stream_handler(None, events())
        return _FakeStreamResponse()

    async def __aexit__(self, exc_type: Any, exc_value: Any, traceback: Any) -> None:
        return None


class _FakeStreamAgent:
    def run_stream(
        self,
        prompt: str,
        *,
        deps: DocumentContext,
        event_stream_handler: StreamEventHandler,
    ) -> _FakeStreamContext:
        assert prompt == "What happened?"
        assert deps.document_name == "Villanueva v. Bayside"
        return _FakeStreamContext(event_stream_handler)


def test_run_chat_stream_emits_thinking_text_and_final_answer(document_tree: DocumentNode) -> None:
    events = asyncio.run(
        _collect_chat_stream(
            document_tree,
            "What happened?",
            agent=cast(Agent[DocumentContext, str], _FakeStreamAgent()),
        )
    )

    assert [event["type"] for event in events] == ["thinking", "thinking", "text", "final"]
    assert [event["delta"] for event in events if event["type"] != "final"] == [
        "Considering ",
        "the record.",
        "Answer",
    ]
    final = events[-1]
    assert final["type"] == "final"
    assert final["answer"].markdown == "Answer"


def test_run_chat_stream_uses_test_model_stream(document_tree: DocumentNode) -> None:
    events = asyncio.run(
        _collect_chat_stream(
            document_tree,
            "What happened?",
            agent=build_chat_agent(
                TestModel(call_tools=[], custom_output_text="First streamed answer.", model_name="test-stream")
            ),
        )
    )

    assert [event["delta"] for event in events if event["type"] != "final"] == [
        "First ",
        "streamed ",
        "answer.",
    ]
    assert events[-1]["type"] == "final"
    assert events[-1]["answer"].model == "test/chat"


async def _collect_chat_stream(
    document_tree: DocumentNode,
    question: str,
    *,
    agent: Agent[DocumentContext, str],
) -> list[ChatStreamEvent]:
    return [
        event
        async for event in run_chat_stream(
            document_tree,
            question,
            api_key="unused-in-test",
            model_name="test/chat",
            agent=agent,
        )
    ]


def test_run_case_digest_preserves_structured_output_and_references(
    document_tree: DocumentNode,
    digest_payload: dict[str, object],
) -> None:
    agent = build_agent(
        TestModel(
            call_tools=["navigate_document"],
            custom_output_args=digest_payload,
            model_name="test-digest",
        )
    )

    result = asyncio.run(
        run_case_digest(
            document_tree,
            api_key="unused-in-test",
            model_name="test/digest",
            agent=agent,
        )
    )

    assert result.digest.case_title == "Villanueva v. Bayside Port Workers Cooperative"
    assert result.model == "test/digest"
    assert result.elapsed_ms >= 0
    assert result.references


def test_run_chat_rejects_empty_questions(document_tree: DocumentNode) -> None:
    agent = build_chat_agent(TestModel(custom_output_text="unused"))

    with pytest.raises(ValueError, match="^Question must not be empty$"):
        asyncio.run(
            run_chat(
                document_tree,
                "  ",
                api_key="unused-in-test",
                model_name="test/chat",
                agent=agent,
            )
        )
