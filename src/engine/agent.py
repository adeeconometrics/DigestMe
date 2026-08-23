"""Pydantic AI case-digest agent definition."""

from pydantic_ai import Agent
from pydantic_ai.models import Model

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
