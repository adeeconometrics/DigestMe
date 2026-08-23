"""Tests for the JSON-facing agent bridge."""

from __future__ import annotations

import asyncio
import json

import pytest
from pydantic_ai.models.test import TestModel

from engine.agent import build_agent, build_chat_agent
from engine.bridge import run_case_digest, run_chat, run_chat_stream
from engine.document import DocumentNode


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


def test_run_chat_stream_emits_text_and_tool_events(document_tree: DocumentNode) -> None:
    agent = build_chat_agent(
        TestModel(
            call_tools=["navigate_document"],
            custom_output_text="## Holding\n\nThe expulsion was void.",
            model_name="test-chat",
        )
    )
    events: list[dict[str, object]] = []

    result = asyncio.run(
        run_chat_stream(
            document_tree,
            "What was the ruling?",
            api_key="unused-in-test",
            model_name="test/chat",
            emit=lambda event: events.append(json.loads(event)),
            agent=agent,
        )
    )

    assert events[0]["type"] == "start"
    assert any(event["type"] == "part-start" and event["kind"] == "tool-call" for event in events)
    assert any(event["type"] == "tool-result" for event in events)
    assert any(event["type"] == "part-delta" and event["kind"] == "text" for event in events)
    assert result.markdown == "## Holding\n\nThe expulsion was void."
    assert result.started_at is not None
    assert result.ended_at is not None
    assert result.started_at <= result.ended_at


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
