"""Tests for provider-specific agent construction."""

from typing import Any, cast

import pytest
from pydantic_ai import UsageLimits
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.models.openrouter import OpenRouterModel
from pydantic_ai.providers.deepseek import DeepSeekProvider
from pydantic_ai.providers.openrouter import OpenRouterProvider

from engine.agent import (
    _browser_safe_headers,
    AGENT_MAX_TOKENS,
    AGENT_INSTRUCTIONS,
    CHAT_MAX_TOKENS,
    COMMENTARY_AGENT_INSTRUCTIONS,
    COMMENTARY_TOOLS,
    DIGEST_USAGE_LIMITS,
    build_agent,
    build_chat_agent,
    build_chat_deepseek_agent,
    build_commentary_agent,
    build_commentary_deepseek_agent,
    build_commentary_openrouter_agent,
    build_deepseek_agent,
    build_openrouter_agent,
)
from engine.schemas import CommentaryDigest


def test_digest_usage_limits_are_generous_for_headless_runs() -> None:
    assert isinstance(DIGEST_USAGE_LIMITS, UsageLimits)
    assert DIGEST_USAGE_LIMITS.request_limit == 300


def test_build_deepseek_agent_uses_explicit_model_and_key() -> None:
    agent = build_deepseek_agent(api_key="test-key", model_name="deepseek-v4-flash")

    assert isinstance(agent.model, OpenAIChatModel)
    assert agent.model.model_name == "deepseek-v4-flash"
    provider = agent.model.provider
    assert isinstance(provider, DeepSeekProvider)
    assert provider.base_url == "https://api.deepseek.com"
    assert provider.client.api_key == "test-key"


def test_build_chat_deepseek_agent_targets_same_platform() -> None:
    agent = build_chat_deepseek_agent(api_key="test-key", model_name="deepseek-chat")

    assert isinstance(agent.model, OpenAIChatModel)
    assert agent.model.model_name == "deepseek-chat"
    assert isinstance(agent.model.provider, DeepSeekProvider)


@pytest.mark.parametrize(
    ("api_key", "model_name"),
    [("", "deepseek-v4-flash"), ("test-key", "  ")],
)
def test_build_deepseek_agent_rejects_incomplete_configuration(api_key: str, model_name: str) -> None:
    with pytest.raises(ValueError):
        build_deepseek_agent(api_key=api_key, model_name=model_name)


def test_build_openrouter_agent_uses_explicit_model_and_key() -> None:
    agent = build_openrouter_agent(api_key="test-key", model_name="openai/gpt-4o-mini")

    assert isinstance(agent.model, OpenRouterModel)
    assert agent.model.model_name == "openai/gpt-4o-mini"
    provider = agent.model.provider
    assert isinstance(provider, OpenRouterProvider)
    assert provider.client.api_key == "test-key"


def test_agents_request_separate_output_budgets() -> None:
    digest_agent = build_agent()
    chat_agent = build_chat_agent()

    assert isinstance(digest_agent.model_settings, dict)
    assert digest_agent.model_settings["max_tokens"] == AGENT_MAX_TOKENS
    assert isinstance(chat_agent.model_settings, dict)
    assert chat_agent.model_settings["max_tokens"] == CHAT_MAX_TOKENS


def test_digest_instructions_define_canonical_empty_values() -> None:
    assert "return every field" in AGENT_INSTRUCTIONS
    assert 'empty string ("")' in AGENT_INSTRUCTIONS
    assert "empty list ([])" in AGENT_INSTRUCTIONS
    assert "never use null" in AGENT_INSTRUCTIONS
    assert "legacy [ruling, ratio] issue" in AGENT_INSTRUCTIONS


def test_commentary_instructions_orchestrate_section_enumeration() -> None:
    assert "enumerating the chapter's structure" in COMMENTARY_AGENT_INSTRUCTIONS
    assert "Enumerate its sections" in COMMENTARY_AGENT_INSTRUCTIONS
    assert "windowed navigation" in COMMENTARY_AGENT_INSTRUCTIONS
    assert "find_citations" in COMMENTARY_AGENT_INSTRUCTIONS
    assert "Do not invent authorities" in COMMENTARY_AGENT_INSTRUCTIONS


def test_commentary_toolset_combines_navigation_search_and_citations() -> None:
    assert sorted(tool.__name__ for tool in COMMENTARY_TOOLS) == [
        "find_citations",
        "global_search",
        "navigate_document",
        "ranked_search",
    ]


def test_commentary_agent_registers_the_full_toolset() -> None:
    agent = build_commentary_agent()

    toolset = cast(Any, agent.toolsets[0])
    assert set(toolset.tools) == {
        "navigate_document",
        "global_search",
        "ranked_search",
        "find_citations",
    }
    assert agent.name == "commentary-digest-engine"
    assert isinstance(agent.model_settings, dict)
    assert agent.model_settings["max_tokens"] == AGENT_MAX_TOKENS


def test_commentary_agent_uses_the_typed_commentary_schema() -> None:
    agent = build_commentary_agent()

    assert agent.output_type is CommentaryDigest


def test_commentary_instructions_define_canonical_empty_values() -> None:
    assert "return every field" in COMMENTARY_AGENT_INSTRUCTIONS
    assert 'empty string ("")' in COMMENTARY_AGENT_INSTRUCTIONS
    assert "empty list ([])" in COMMENTARY_AGENT_INSTRUCTIONS
    assert "never use null" in COMMENTARY_AGENT_INSTRUCTIONS
    assert "case objects each containing case_name" in COMMENTARY_AGENT_INSTRUCTIONS


def test_build_commentary_deepseek_agent_uses_explicit_model_and_key() -> None:
    agent = build_commentary_deepseek_agent(api_key="test-key", model_name="deepseek-v4-flash")

    assert isinstance(agent.model, OpenAIChatModel)
    assert agent.model.model_name == "deepseek-v4-flash"
    assert isinstance(agent.model.provider, DeepSeekProvider)


@pytest.mark.parametrize(
    ("api_key", "model_name"),
    [("", "deepseek-v4-flash"), ("test-key", "  ")],
)
def test_build_commentary_deepseek_agent_rejects_incomplete_configuration(
    api_key: str, model_name: str
) -> None:
    with pytest.raises(ValueError):
        build_commentary_deepseek_agent(api_key=api_key, model_name=model_name)


def test_build_commentary_openrouter_agent_uses_explicit_model_and_key() -> None:
    agent = build_commentary_openrouter_agent(api_key="test-key", model_name="openai/gpt-4o-mini")

    assert isinstance(agent.model, OpenRouterModel)
    assert agent.model.model_name == "openai/gpt-4o-mini"
    assert isinstance(agent.model.provider, OpenRouterProvider)


@pytest.mark.parametrize(
    ("api_key", "model_name"),
    [("", "openai/gpt-4o-mini"), ("test-key", "gpt-4o-mini"), ("test-key", "/model")],
)
def test_build_openrouter_agent_rejects_incomplete_configuration(api_key: str, model_name: str) -> None:
    with pytest.raises(ValueError):
        build_openrouter_agent(api_key=api_key, model_name=model_name)


def test_browser_safe_headers_strips_stainless_telemetry() -> None:
    headers = [
        ("Authorization", "Bearer test"),
        ("Content-Type", "application/json"),
        ("x-stainless-read-timeout", "600"),
        ("X-Stainless-Package-Version", "3.3.1"),
        ("X-Openrouter-Title", "Digest Me"),
    ]

    filtered = _browser_safe_headers(headers)

    assert filtered == [
        ("Authorization", "Bearer test"),
        ("Content-Type", "application/json"),
        ("X-Openrouter-Title", "Digest Me"),
    ]


def test_browser_safe_headers_preserves_plain_headers() -> None:
    headers = [("Accept", "application/json"), ("traceparent", "00-0af7-1-01")]

    assert _browser_safe_headers(headers) == headers
