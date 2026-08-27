"""Pydantic AI case-digest agent definition."""

import sys
from collections.abc import AsyncIterator, Iterable

from httpx2 import AsyncClient, Request, Response
from httpx2._transports import AsyncHTTPTransport
from httpx2._types import AsyncByteStream
from pydantic_ai import Agent, UsageLimits
from pydantic_ai.agent.abstract import AgentRetries
from pydantic_ai.models import Model
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.models.openrouter import OpenRouterModel
from pydantic_ai.providers.deepseek import DeepSeekProvider
from pydantic_ai.providers.openrouter import OpenRouterProvider
from pydantic_ai.settings import ModelSettings

from .schemas import CaseDigest
from .tools import DocumentContext, global_search, navigate_document


AGENT_MAX_TOKENS = 16_384
"""Output budget for a complete structured digest response."""

CHAT_MAX_TOKENS = 4096

AGENT_MODEL_SETTINGS: ModelSettings = ModelSettings(max_tokens=AGENT_MAX_TOKENS)
CHAT_MODEL_SETTINGS: ModelSettings = ModelSettings(max_tokens=CHAT_MAX_TOKENS)

AGENT_RETRIES: AgentRetries = {"tools": 2, "output": 3}
"""Retry budgets for recoverable tool and structured-output mistakes."""

DIGEST_USAGE_LIMITS = UsageLimits(request_limit=300)
"""Per-run model request budget for headless digests.

Headless runs pass this to ``Agent.run`` so large cases can spend many tool
rounds on search and navigation; the 10-minute per-case stage timeout in the
CLI pipeline is the binding constraint, not this cap. Browser runs keep the
framework default of 50 requests unless they opt in explicitly.
"""


AGENT_INSTRUCTIONS = """\
Create a case digest from the supplied source document.
Start with document navigation, then retrieve the sections relevant to each digest field.
Use global search as a fallback when section names are not descriptive enough, and follow each hit with navigation.
Ground every field in the source and preserve section/page references in study notes when useful.
Always return every field defined by the output schema. Never omit a field and never use null: return an empty string ("")
for an unsupported scalar, an empty list ([]) for an unsupported list, an object containing all three empty-or-populated
fact lists, and an array of issue objects containing issue, ruling, and ratio. Do not use the legacy [ruling, ratio] issue
pair form.
Keep each field concise enough that the entire digest fits in one response.
Keep scalar fields to concise paragraphs, use no more than six items in any list,
and include no more than four issue objects. Keep scalar fields at most 1,200
characters and list items at most 600 characters. Paraphrase instead of
reproducing long source passages.
Return only the fields defined by the output schema; never add extra keys.
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
        model_settings=AGENT_MODEL_SETTINGS,
        retries=AGENT_RETRIES,
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
        model_settings=CHAT_MODEL_SETTINGS,
        retries=AGENT_RETRIES,
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


class _BytesStream(AsyncByteStream):
    """Coerce pyodide ``memoryview`` chunks into ``bytes`` for the SSE decoder.

    httpcore2's pyodide network backend yields ``memoryview`` slices, which the
    openai SDK's streaming parser feeds to ``str.splitlines`` and rejects. Wrapping
    the response stream normalizes every chunk to ``bytes`` without copying.
    """

    def __init__(self, stream: AsyncByteStream) -> None:
        self._stream = stream

    async def __aiter__(self) -> AsyncIterator[bytes]:
        async for chunk in self._stream:
            yield bytes(chunk) if isinstance(chunk, memoryview) else chunk

    async def aclose(self) -> None:
        await self._stream.aclose()


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
        response = await super().handle_async_request(safe_request)
        stream = response.stream
        if not isinstance(stream, AsyncByteStream):
            raise AssertionError("async transport must return an async byte stream")
        return Response(
            response.status_code,
            headers=response.headers,
            stream=_BytesStream(stream),
            request=safe_request,
            extensions=response.extensions,
            history=response.history,
            default_encoding=response.default_encoding,
        )


def _browser_safe_client() -> AsyncClient:
    """An HTTP client with the transport shim required by pyodide."""
    return AsyncClient(transport=_BrowserSafeTransport())


def _openrouter_provider(*, api_key: str) -> OpenRouterProvider:
    """Create the OpenRouter provider, shimming the transport in the browser."""
    if sys.platform != "emscripten":
        return OpenRouterProvider(api_key=api_key)
    return OpenRouterProvider(api_key=api_key, http_client=_browser_safe_client())


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


def _deepseek_provider(*, api_key: str) -> DeepSeekProvider:
    """Create the DeepSeek platform provider, shimming the transport in the browser."""
    if sys.platform != "emscripten":
        return DeepSeekProvider(api_key=api_key)

    return DeepSeekProvider(api_key=api_key, http_client=_browser_safe_client())


def _deepseek_model(*, api_key: str, model_name: str) -> OpenAIChatModel:
    """Validate per-request DeepSeek credentials and construct its model."""
    normalized_key = api_key.strip()
    if not normalized_key:
        raise ValueError("DeepSeek API key is required")

    normalized_model = model_name.strip()
    if not normalized_model:
        raise ValueError("model_name must be a DeepSeek model id")

    return OpenAIChatModel(normalized_model, provider=_deepseek_provider(api_key=normalized_key))


def build_deepseek_agent(*, api_key: str, model_name: str) -> Agent[DocumentContext, CaseDigest]:
    """Build a DeepSeek-platform-backed agent using credentials supplied for one run."""
    return build_agent(_deepseek_model(api_key=api_key, model_name=model_name))


def build_chat_deepseek_agent(*, api_key: str, model_name: str) -> Agent[DocumentContext, str]:
    """Build the markdown chat agent backed by the DeepSeek platform."""
    return build_chat_agent(_deepseek_model(api_key=api_key, model_name=model_name))


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
