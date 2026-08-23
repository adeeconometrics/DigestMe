"""Tests for provider-specific agent construction."""

import pytest
from pydantic_ai.models.openrouter import OpenRouterModel
from pydantic_ai.providers.openrouter import OpenRouterProvider

from engine.agent import build_openrouter_agent


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
