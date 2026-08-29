"""Persistent API-key and model-slug configuration for headless runs.

Credentials are resolved with the precedence: explicit CLI flag, environment
variable, stored config file, then an interactive prompt. The key is stored
plaintext in a user config file with owner-only permissions; headless batch
runs should prefer the ``DIGEST_API_KEY`` environment variable instead. The
engine talks to either the DeepSeek platform API (``api.deepseek.com``) or
the OpenRouter API (``openrouter.ai``), selected by the ``provider`` field:
DeepSeek keys are ``sk-`` prefixed platform keys and model ids are bare names,
while OpenRouter keys are its own keys and model ids are ``provider/model``
slugs.
"""

from __future__ import annotations

import getpass
import json
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Literal

import platformdirs

Provider = Literal["deepseek", "openrouter"]
"""Headless-run model providers: DeepSeek's platform or OpenRouter."""

DEFAULT_PROVIDER: Provider = "deepseek"
DEFAULT_MODEL_SLUG = "deepseek-v4-flash"
"""Default DeepSeek platform model used when nothing else is configured."""

API_KEY_ENV = "DIGEST_API_KEY"
MODEL_SLUG_ENV = "DIGEST_MODEL_SLUG"
PROVIDER_ENV = "DIGEST_PROVIDER"

CONFIG_FILE_NAME = "config.json"
CONFIG_DIR_NAME = "digest-engine"

_PROVIDER_LABELS: dict[str, str] = {"deepseek": "DeepSeek", "openrouter": "OpenRouter"}


class CredentialError(RuntimeError):
    """Raised when API credentials cannot be resolved without user input."""


@dataclass(frozen=True)
class Credentials:
    """Resolved headless-run credentials: API key, model slug, and provider."""

    api_key: str
    model_slug: str
    provider: Provider = "deepseek"


def normalize_model_slug(raw: str, provider: Provider = "deepseek") -> str:
    """Return the canonical model id for the provider, stripping legacy prefixes.

    DeepSeek's platform serves bare model ids (``deepseek-v4-flash``); legacy
    ``deepseek:`` and ``deepseek/`` prefixed forms are accepted and stripped,
    while slugs for other providers are rejected because the DeepSeek API
    cannot serve them. OpenRouter model ids are the full ``provider/model``
    slugs, which are validated and preserved.
    """
    slug = raw.strip()
    if not slug:
        raise CredentialError(
            f"Invalid model slug {raw!r}: expected a {provider} model id"
        )

    if provider == "openrouter":
        provider_name, separator, model_id = slug.partition("/")
        if not separator or not provider_name or not model_id or "/" in model_id:
            raise CredentialError(
                f"Invalid OpenRouter model slug {raw!r}: "
                "expected provider/model (e.g. openai/gpt-4o-mini)"
            )
        return slug

    provider_name = ""
    separated = False
    if ":" in slug:
        provider_name, _, slug = slug.partition(":")
        separated = True
    elif "/" in slug:
        provider_name, _, slug = slug.partition("/")
        separated = True
    provider_name = provider_name.strip().lower()
    slug = slug.strip()
    if separated and (not provider_name or provider_name != "deepseek"):
        raise CredentialError(
            f"Invalid model slug {raw!r}: expected a DeepSeek model id (e.g. {DEFAULT_MODEL_SLUG})"
        )
    if not slug or ":" in slug or "/" in slug:
        raise CredentialError(
            f"Invalid model slug {raw!r}: expected a DeepSeek model id (e.g. {DEFAULT_MODEL_SLUG})"
        )
    return slug


def mask_key(raw: str) -> str:
    """Return a recognition-only suffix of an API key for console output."""
    return raw[-4:] if len(raw) >= 4 else "<key>"


Prompt = Callable[[str], str]
InteractiveCheck = Callable[[], bool]


def _is_interactive() -> bool:
    """Whether stdin is a terminal that can accept credential prompts."""
    return sys.stdin.isatty()


def _default_config_path() -> Path:
    return Path(platformdirs.user_config_dir(CONFIG_DIR_NAME)) / CONFIG_FILE_NAME


class CredentialStore:
    """Load, save, and resolve API credentials for a headless run."""

    def __init__(
        self,
        path: Path | None = None,
        *,
        prompt: Prompt = input,
        secret_prompt: Prompt = getpass.getpass,
        interactive: InteractiveCheck = _is_interactive,
    ) -> None:
        self._path = path or _default_config_path()
        self._prompt = prompt
        self._secret_prompt = secret_prompt
        self._interactive = interactive

    def load(self) -> Credentials | None:
        """Read stored credentials, returning None for a missing or corrupt file."""
        try:
            data = json.loads(self._path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None
        api_key = data.get("api_key")
        model_slug = data.get("model_slug")
        provider = data.get("provider", DEFAULT_PROVIDER)
        if not isinstance(api_key, str) or not isinstance(model_slug, str):
            return None
        if not api_key.strip() or not model_slug.strip():
            return None
        if provider not in ("deepseek", "openrouter"):
            return None
        return Credentials(api_key=api_key, model_slug=model_slug, provider=provider)

    def save(self, credentials: Credentials) -> None:
        """Persist credentials with owner-only permissions."""
        self._path.parent.mkdir(parents=True, exist_ok=True)
        payload = json.dumps(
            {
                "api_key": credentials.api_key,
                "model_slug": credentials.model_slug,
                "provider": credentials.provider,
            },
            indent=2,
            sort_keys=True,
        )
        self._path.write_text(f"{payload}\n", encoding="utf-8")
        self._path.chmod(0o600)

    def resolve(  # pylint: disable=too-many-branches,too-many-locals  # per-field precedence chain
        self,
        api_key: str | None = None,
        model_slug: str | None = None,
        provider: Provider | None = None,
    ) -> Credentials:
        """Resolve credentials, prompting for anything missing on first use.

        Precedence is explicit argument, then environment, then the stored
        config file. When nothing is configured the API key is prompted for
        interactively (raising ``CredentialError`` outside a terminal); the
        model slug falls back to ``DEFAULT_MODEL_SLUG`` for DeepSeek but must
        be supplied for OpenRouter.
        """
        stored = self.load()
        resolved_key = api_key or os.environ.get(API_KEY_ENV)
        if resolved_key is None and stored is not None:
            resolved_key = stored.api_key
        resolved_model = model_slug or os.environ.get(MODEL_SLUG_ENV)
        if resolved_model is None and stored is not None:
            resolved_model = stored.model_slug
        raw_provider = provider or os.environ.get(PROVIDER_ENV)
        if raw_provider is None and stored is not None:
            raw_provider = stored.provider
        if raw_provider is None:
            raw_provider = DEFAULT_PROVIDER
        if raw_provider not in ("deepseek", "openrouter"):
            raise CredentialError(
                f"Invalid provider {raw_provider!r}: expected deepseek or openrouter (see {PROVIDER_ENV})"
            )
        resolved_provider: Provider = "deepseek" if raw_provider == "deepseek" else "openrouter"
        provider_label = _PROVIDER_LABELS[resolved_provider]

        prompted_key = False
        if not resolved_key:
            if not self._interactive():
                raise CredentialError(
                    f"No {provider_label} API key configured. Set {API_KEY_ENV} or run once interactively."
                )
            resolved_key = self._secret_prompt(f"{provider_label} API key: ").strip()
            prompted_key = True
        if not resolved_key:
            raise CredentialError(f"The {provider_label} API key must not be empty")

        prompted_model = False
        if not resolved_model:
            if self._interactive():
                if resolved_provider == "openrouter":
                    answered = self._prompt("Model slug (provider/model, e.g. openai/gpt-4o-mini): ").strip()
                    if not answered:
                        raise CredentialError(f"An OpenRouter model slug is required (see {MODEL_SLUG_ENV})")
                    resolved_model = answered
                    prompted_model = True
                else:
                    answered = self._prompt(f"Model slug [{DEFAULT_MODEL_SLUG}]: ").strip()
                    resolved_model = answered or DEFAULT_MODEL_SLUG
                    prompted_model = True
            elif resolved_provider == "openrouter":
                raise CredentialError(f"An OpenRouter model slug is required; set {MODEL_SLUG_ENV}.")
            else:
                resolved_model = DEFAULT_MODEL_SLUG

        try:
            normalized_model = normalize_model_slug(resolved_model, resolved_provider)
        except CredentialError as error:
            raise CredentialError(
                f"Invalid model slug {resolved_model!r}: {error} (see {MODEL_SLUG_ENV})"
            ) from error

        credentials = Credentials(
            api_key=resolved_key,
            model_slug=normalized_model,
            provider=resolved_provider,
        )
        if prompted_key or prompted_model:
            self.save(credentials)
        return credentials
