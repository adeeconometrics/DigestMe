"""Tests for provider-specific agent construction."""

import pytest
from pydantic_ai.models.openrouter import OpenRouterModel
from pydantic_ai.providers.openrouter import OpenRouterProvider

from engine.agent import _browser_safe_headers, build_openrouter_agent


def test_build_openrouter_agent_uses_explicit_model_and_key() -> None:
    agent = build_openrouter_agent(api_key="test-key", model_name="openai/gpt-4o-mini")

    assert isinstance(agent.model, OpenRouterModel)
    assert agent.model.model_name == "openai/gpt-4o-mini"
    provider = agent.model.provider
    assert isinstance(provider, OpenRouterProvider)
    assert provider.client.api_key == "test-key"


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
