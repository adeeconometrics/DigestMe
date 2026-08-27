"""Persistent API-key and model-slug configuration for headless runs.

Credentials are resolved with the precedence: explicit CLI flag, environment
variable, stored config file, then an interactive prompt. The key is stored
plaintext in a user config file with owner-only permissions; headless batch
runs should prefer the ``DIGEST_API_KEY`` environment variable instead. The
engine talks to DeepSeek's own platform API; the key must be a DeepSeek
platform key (``sk-`` prefixed), not an OpenRouter key.
"""

from __future__ import annotations

import getpass
import json
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import platformdirs

DEFAULT_MODEL_SLUG = "deepseek-v4-flash"
"""Default DeepSeek platform model used when nothing else is configured."""

API_KEY_ENV = "DIGEST_API_KEY"
MODEL_SLUG_ENV = "DIGEST_MODEL_SLUG"

CONFIG_FILE_NAME = "config.json"
CONFIG_DIR_NAME = "digest-engine"


class CredentialError(RuntimeError):
    """Raised when API credentials cannot be resolved without user input."""


@dataclass(frozen=True)
class Credentials:
    """Resolved headless-run credentials: API key plus canonical model slug."""

    api_key: str
    model_slug: str


def normalize_model_slug(raw: str) -> str:
    """Return the canonical DeepSeek model id, stripping a provider prefix.

    The engine talks to DeepSeek's own platform (``api.deepseek.com``), whose
    model ids are bare names (``deepseek-v4-flash``). Legacy ``deepseek:`` and
    ``deepseek/`` prefixed forms are accepted and normalized, while slugs for
    other providers are rejected because the DeepSeek API cannot serve them.
    """
    slug = raw.strip()
    if not slug:
        raise CredentialError(
            f"Invalid model slug {raw!r}: expected a DeepSeek model id (e.g. {DEFAULT_MODEL_SLUG})"
        )
    provider = ""
    separated = False
    if ":" in slug:
        provider, _, slug = slug.partition(":")
        separated = True
    elif "/" in slug:
        provider, _, slug = slug.partition("/")
        separated = True
    provider = provider.strip().lower()
    slug = slug.strip()
    if separated and (not provider or provider != "deepseek"):
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
        if not isinstance(api_key, str) or not isinstance(model_slug, str):
            return None
        if not api_key.strip() or not model_slug.strip():
            return None
        return Credentials(api_key=api_key, model_slug=model_slug)

    def save(self, credentials: Credentials) -> None:
        """Persist credentials with owner-only permissions."""
        self._path.parent.mkdir(parents=True, exist_ok=True)
        payload = json.dumps(
            {"api_key": credentials.api_key, "model_slug": credentials.model_slug},
            indent=2,
            sort_keys=True,
        )
        self._path.write_text(f"{payload}\n", encoding="utf-8")
        self._path.chmod(0o600)

    def resolve(self, api_key: str | None = None, model_slug: str | None = None) -> Credentials:
        """Resolve credentials, prompting for anything missing on first use.

        Precedence is explicit argument, then environment, then the stored
        config file. When nothing is configured the API key is prompted for
        interactively (raising ``CredentialError`` outside a terminal) and the
        model slug falls back to ``DEFAULT_MODEL_SLUG``.
        """
        stored = self.load()
        resolved_key = api_key or os.environ.get(API_KEY_ENV)
        if resolved_key is None and stored is not None:
            resolved_key = stored.api_key
        resolved_model = model_slug or os.environ.get(MODEL_SLUG_ENV)
        if resolved_model is None and stored is not None:
            resolved_model = stored.model_slug

        prompted_key = False
        if not resolved_key:
            if not self._interactive():
                raise CredentialError(
                    f"No DeepSeek API key configured. Set {API_KEY_ENV} or run once interactively."
                )
            resolved_key = self._secret_prompt("DeepSeek API key: ").strip()
            prompted_key = True
        if not resolved_key:
            raise CredentialError("The OpenRouter API key must not be empty")

        prompted_model = False
        if not resolved_model:
            if self._interactive():
                answered = self._prompt(f"Model slug [{DEFAULT_MODEL_SLUG}]: ").strip()
                resolved_model = answered or DEFAULT_MODEL_SLUG
                prompted_model = True
            else:
                resolved_model = DEFAULT_MODEL_SLUG

        try:
            normalized_model = normalize_model_slug(resolved_model)
        except CredentialError as error:
            raise CredentialError(
                f"Invalid model slug {resolved_model!r}: {error} (see {MODEL_SLUG_ENV})"
            ) from error

        credentials = Credentials(api_key=resolved_key, model_slug=normalized_model)
        if prompted_key or prompted_model:
            self.save(credentials)
        return credentials
