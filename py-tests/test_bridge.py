"""Tests for the JSON-facing agent bridge."""

from __future__ import annotations

import asyncio

import pytest
from pydantic_ai.models.test import TestModel

from engine.agent import build_agent, build_chat_agent
from engine.bridge import run_case_digest, run_chat
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
