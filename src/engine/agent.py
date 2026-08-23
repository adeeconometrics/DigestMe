"""Pydantic AI case-digest agent definition."""

from pydantic_ai import Agent
from pydantic_ai.models import Model
from pydantic_ai.models.openrouter import OpenRouterModel
from pydantic_ai.providers.openrouter import OpenRouterProvider

from .schemas import CaseDigest
from .tools import DocumentContext, global_search, navigate_document


AGENT_INSTRUCTIONS = """\
Create a case digest from the supplied source document.
Start with document navigation, then retrieve the sections relevant to each digest field.
Use global search as a fallback when section names are not descriptive enough, and follow each hit with navigation.
Ground every field in the source and preserve section/page references in study notes when useful.
"""


def build_agent(model: Model | str | None = None) -> Agent[DocumentContext, CaseDigest]:
    """Build a structured case-digest agent for one injected document context."""
    return Agent(
        model=model,
        name="case-digest-engine",
        deps_type=DocumentContext,
        output_type=CaseDigest,
        instructions=AGENT_INSTRUCTIONS,
        tools=[navigate_document, global_search],
    )


def build_openrouter_agent(*, api_key: str, model_name: str) -> Agent[DocumentContext, CaseDigest]:
    """Build an OpenRouter-backed agent using credentials supplied for one run.

    The key is passed directly to the provider instead of being copied into the
    process environment, which keeps browser-provided credentials out of global
    configuration and logs.
    """
    normalized_key = api_key.strip()
    if not normalized_key:
        raise ValueError("OpenRouter API key is required")

    normalized_model = model_name.strip()
    provider_name, separator, model_id = normalized_model.partition("/")
    if not separator or not provider_name or not model_id:
        raise ValueError("model_name must be an OpenRouter provider/model slug")

    return build_agent(
        OpenRouterModel(
            normalized_model,
            provider=OpenRouterProvider(api_key=normalized_key),
        )
    )
