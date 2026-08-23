"""Pydantic AI case-digest agent definition."""

import sys
from collections.abc import Iterable

from httpx2 import AsyncClient, Request, Response
from httpx2._transports import AsyncHTTPTransport
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


CHAT_AGENT_INSTRUCTIONS = """\
Answer questions about the supplied source document.
Start with document navigation, then retrieve the sections relevant to the question.
Use global search as a fallback when section names are not descriptive enough, and follow each hit with navigation.
Return only concise GitHub-flavored Markdown. Do not emit HTML, JSON, or invented citations.
Ground every factual claim in the source document and say when the document does not establish an answer.
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


def build_chat_agent(model: Model | str | None = None) -> Agent[DocumentContext, str]:
    """Build a markdown question-answering agent for one injected document context."""
    return Agent(
        model=model,
        name="case-digest-chat",
        deps_type=DocumentContext,
        output_type=str,
        instructions=CHAT_AGENT_INSTRUCTIONS,
        tools=[navigate_document, global_search],
    )


def _browser_safe_headers(headers: Iterable[tuple[str, str]]) -> list[tuple[str, str]]:
    """Drop openai SDK telemetry headers that OpenRouter's CORS list rejects.

    The SDK tags every request with ``x-stainless-*`` headers for observability.
    OpenRouter's ``Access-Control-Allow-Headers`` does not cover all of them
    (notably ``x-stainless-read-timeout``), so the browser blocks the preflight
    and the pyodide fetch transport fails with ``ModelAPIError: Connection error.``
    These headers are informational only, so dropping them costs nothing.
    """
    return [(name, value) for name, value in headers if not name.lower().startswith("x-stainless-")]


def _openrouter_provider(*, api_key: str) -> OpenRouterProvider:
    """Create the OpenRouter provider, shimming the transport in the browser."""
    if sys.platform != "emscripten":
        return OpenRouterProvider(api_key=api_key)

    class _BrowserSafeTransport(AsyncHTTPTransport):
        """Async transport that strips CORS-unsafe telemetry headers."""

        async def handle_async_request(self, request: Request) -> Response:
            safe_request = Request(
                method=request.method,
                url=request.url,
                headers=_browser_safe_headers(request.headers.items()),
                stream=request.stream,
                extensions=request.extensions,
            )
            return await super().handle_async_request(safe_request)

    return OpenRouterProvider(api_key=api_key, http_client=AsyncClient(transport=_BrowserSafeTransport()))


def _openrouter_model(*, api_key: str, model_name: str) -> OpenRouterModel:
    """Validate per-request OpenRouter credentials and construct its model."""
    normalized_key = api_key.strip()
    if not normalized_key:
        raise ValueError("OpenRouter API key is required")

    normalized_model = model_name.strip()
    provider_name, separator, model_id = normalized_model.partition("/")
    if not separator or not provider_name or not model_id:
        raise ValueError("model_name must be an OpenRouter provider/model slug")

    return OpenRouterModel(
        normalized_model,
        provider=_openrouter_provider(api_key=normalized_key),
    )


def build_openrouter_agent(*, api_key: str, model_name: str) -> Agent[DocumentContext, CaseDigest]:
    """Build an OpenRouter-backed agent using credentials supplied for one run.

    The key is passed directly to the provider instead of being copied into the
    process environment, which keeps browser-provided credentials out of global
    configuration and logs.
    """
    return build_agent(_openrouter_model(api_key=api_key, model_name=model_name))


def build_chat_openrouter_agent(*, api_key: str, model_name: str) -> Agent[DocumentContext, str]:
    """Build the markdown chat agent with credentials supplied for one run."""
    return build_chat_agent(_openrouter_model(api_key=api_key, model_name=model_name))
