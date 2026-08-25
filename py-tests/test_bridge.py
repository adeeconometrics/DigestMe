"""Tests for the JSON-facing agent bridge."""

from __future__ import annotations

import asyncio
import json

import pytest
from pydantic import TypeAdapter
from pydantic_ai.exceptions import ToolRetryError, UnexpectedModelBehavior
from pydantic_ai.messages import ModelRequest, ModelResponse, RetryPromptPart, ToolCallPart, UserPromptPart
from pydantic_ai.models.test import TestModel
from pydantic_ai.usage import RequestUsage
from pydantic_core import ValidationError

from engine.agent import build_agent, build_chat_agent
from engine.bridge import (
    AgentRunError,
    _bind_stream_request_id,
    _last_reply_diagnostic,
    _translate_agent_error,
    run_case_digest,
    run_chat,
    run_chat_stream,
)
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


def test_run_case_digest_normalizes_sparse_structured_output(document_tree: DocumentNode) -> None:
    agent = build_agent(TestModel(custom_output_args={}, model_name="test-digest"))

    result = asyncio.run(
        run_case_digest(
            document_tree,
            api_key="unused-in-test",
            model_name="test/digest",
            agent=agent,
        )
    )

    expected_digest = {
        "case_title": "",
        "petitioner": "",
        "respondent": "",
        "topic_subtopic": "",
        "subject": "",
        "ponente": "",
        "gr_no_date": "",
        "full_text": "",
        "summary": "",
        "doctrine": "",
        "provisions": "",
        "facts": {
            "petition": [],
            "petitioner_version": [],
            "respondent_version": [],
        },
        "petitioners_arguments": [],
        "respondents_arguments": [],
        "procedural_posture": [],
        "issues": [],
        "supreme_court_ruling": "",
        "class_notes": [],
    }

    assert result.digest.model_dump() == expected_digest
    assert json.loads(result.model_dump_json())["digest"] == expected_digest


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


def test_bind_stream_request_id_forwards_request_id_and_payload() -> None:
    """The JS dispatcher routes by request id, so the emitter must carry it."""
    calls: list[tuple[int, str]] = []

    def emit(request_id: int, payload: str) -> object:
        calls.append((request_id, payload))

    payload = '{"type": "start", "model": "test/chat", "started_at": 1}'
    bound = _bind_stream_request_id(emit, 42)
    bound(payload)

    assert calls == [(42, payload)]


def _truncated_json_error() -> ValidationError:
    """Produce a validation error matching a response cut off in the middle of JSON."""
    adapter = TypeAdapter(dict[str, list[int]])
    with pytest.raises(ValidationError) as exc_info:
        adapter.validate_json('{"items": [1, 2')
    return exc_info.value


def test_run_case_digest_translates_invalid_output_retries(document_tree: DocumentNode) -> None:
    """A digest that never validates names the field that kept failing."""
    agent = build_agent(TestModel(custom_output_args={"gr_no_date": 12345}, model_name="test-digest"))

    with pytest.raises(AgentRunError, match=r"could not produce a valid result.*gr_no_date"):
        asyncio.run(
            run_case_digest(
                document_tree,
                api_key="unused-in-test",
                model_name="test/digest",
                agent=agent,
            )
        )


def test_translate_tool_retry_error_is_user_facing() -> None:
    error = _translate_agent_error(
        ToolRetryError(RetryPromptPart(content="Tool 'global_search' call failed validation"))
    )

    assert isinstance(error, AgentRunError)
    assert "repeated invalid model output" in str(error)
    assert "Tool 'global_search' call failed validation" in str(error)


def test_translate_unexpected_model_behavior_is_user_facing() -> None:
    error = _translate_agent_error(UnexpectedModelBehavior("Exceeded maximum output retries (3)"))

    assert isinstance(error, AgentRunError)
    assert "could not produce a valid result" in str(error)
    assert "Validation errors" not in str(error)


def test_translate_truncated_json_output_explains_the_cut_off() -> None:
    failure = UnexpectedModelBehavior("Exceeded maximum output retries (3)")
    failure.__cause__ = _truncated_json_error()

    error = _translate_agent_error(failure)

    assert isinstance(error, AgentRunError)
    assert "Invalid JSON" in str(error)
    assert "cut off before it finished" in str(error)


def test_translate_agent_error_includes_reply_diagnostic() -> None:
    response = ModelResponse(
        parts=[ToolCallPart(tool_name="final_result", args='{"case_title": "A v.', tool_call_id="call-1")],
        usage=RequestUsage(output_tokens=87),
        model_name="test-model",
        finish_reason="stop",
    )
    failure = UnexpectedModelBehavior("Exceeded maximum output retries (3)")
    failure.__cause__ = _truncated_json_error()

    error = _translate_agent_error(failure, [response])

    assert isinstance(error, AgentRunError)
    assert "finish_reason=stop" in str(error)
    assert "output_tokens=87" in str(error)
    assert "final_result 20 chars" in str(error)


def test_last_reply_diagnostic_ignores_non_reply_messages() -> None:
    assert _last_reply_diagnostic([]) is None
    assert _last_reply_diagnostic([ModelRequest(parts=[UserPromptPart(content="q")])]) is None


def test_translate_agent_error_passes_existing_agent_run_errors_through() -> None:
    original = AgentRunError("already user-facing")

    assert _translate_agent_error(original) is original
