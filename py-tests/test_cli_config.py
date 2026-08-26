"""Tests for headless CLI credential resolution and storage."""

from __future__ import annotations

from pathlib import Path

import pytest

from cli.config import (
    API_KEY_ENV,
    DEFAULT_MODEL_SLUG,
    MODEL_SLUG_ENV,
    CredentialError,
    CredentialStore,
    Credentials,
    normalize_model_slug,
)


def test_normalize_model_slug_converts_colon_to_slash() -> None:
    assert normalize_model_slug("deepseek:deepseek-v4-flash") == "deepseek/deepseek-v4-flash"


def test_normalize_model_slug_passes_slash_through() -> None:
    assert normalize_model_slug("openai/gpt-4o-mini") == "openai/gpt-4o-mini"


def test_normalize_model_slug_strips_surrounding_space() -> None:
    assert normalize_model_slug("  openai/gpt-4o-mini  ") == "openai/gpt-4o-mini"


@pytest.mark.parametrize("slug", ["", "   ", "openai", "openai/", "/gpt-4o"])
def test_normalize_model_slug_rejects_malformed_slugs(slug: str) -> None:
    with pytest.raises(CredentialError):
        normalize_model_slug(slug)


def test_store_round_trip_with_owner_only_permissions(tmp_path: Path) -> None:
    path = tmp_path / "config.json"
    store = CredentialStore(path)
    credentials = Credentials(api_key="sk-or-abc123", model_slug="openai/gpt-4o-mini")
    store.save(credentials)
    assert store.load() == credentials
    assert path.stat().st_mode & 0o777 == 0o600


def test_load_returns_none_for_missing_or_corrupt_file(tmp_path: Path) -> None:
    assert CredentialStore(tmp_path / "missing.json").load() is None

    corrupt = tmp_path / "corrupt.json"
    corrupt.write_text("{not json", encoding="utf-8")
    assert CredentialStore(corrupt).load() is None

    malformed = tmp_path / "malformed.json"
    malformed.write_text('{"api_key": 42}', encoding="utf-8")
    assert CredentialStore(malformed).load() is None


def test_resolve_prefers_argument_over_env_and_stored(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv(API_KEY_ENV, "sk-or-env")
    monkeypatch.setenv(MODEL_SLUG_ENV, "env/model")
    store = CredentialStore(tmp_path / "config.json")
    store.save(Credentials(api_key="sk-or-stored", model_slug="stored/model"))

    credentials = store.resolve(api_key="sk-or-arg", model_slug="arg/model")
    assert credentials == Credentials(api_key="sk-or-arg", model_slug="arg/model")


def test_resolve_falls_back_to_environment(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv(API_KEY_ENV, "sk-or-env")
    monkeypatch.setenv(MODEL_SLUG_ENV, "env/model")
    credentials = CredentialStore(tmp_path / "config.json").resolve()
    assert credentials == Credentials(api_key="sk-or-env", model_slug="env/model")


def test_resolve_falls_back_to_stored_without_prompting(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.delenv(API_KEY_ENV, raising=False)
    monkeypatch.delenv(MODEL_SLUG_ENV, raising=False)
    store = CredentialStore(tmp_path / "config.json")
    store.save(Credentials(api_key="sk-or-stored", model_slug="stored/model"))

    credentials = store.resolve()
    assert credentials == Credentials(api_key="sk-or-stored", model_slug="stored/model")


def test_resolve_prompts_and_persists_on_first_run(tmp_path: Path) -> None:
    class PromptRecorder:
        def __init__(self) -> None:
            self.messages: list[str] = []

        def prompt(self, message: str) -> str:
            self.messages.append(message)
            return "my/model"

        def secret(self, message: str) -> str:
            self.messages.append(message)
            return "sk-or-typed"

    recorder = PromptRecorder()
    store = CredentialStore(
        tmp_path / "config.json",
        prompt=recorder.prompt,
        secret_prompt=recorder.secret,
        interactive=lambda: True,
    )

    credentials = store.resolve()
    assert credentials == Credentials(api_key="sk-or-typed", model_slug="my/model")
    assert store.load() == credentials
    assert recorder.messages == ["OpenRouter API key: ", "Model slug [deepseek:deepseek-v4-flash]: "]


def test_resolve_uses_default_model_slug_when_prompt_is_blank(tmp_path: Path) -> None:
    store = CredentialStore(
        tmp_path / "config.json",
        prompt=lambda _: "  ",
        secret_prompt=lambda _: "sk-or-typed",
        interactive=lambda: True,
    )
    credentials = store.resolve()
    assert credentials.model_slug == normalize_model_slug(DEFAULT_MODEL_SLUG)


def test_resolve_uses_default_model_slug_without_tty(tmp_path: Path) -> None:
    store = CredentialStore(
        tmp_path / "config.json",
        secret_prompt=lambda _: "sk-or-typed",
        interactive=lambda: False,
    )
    credentials = store.resolve(api_key="sk-or-cli")
    assert credentials.model_slug == normalize_model_slug(DEFAULT_MODEL_SLUG)


def test_resolve_raises_without_tty_when_no_key_configured(tmp_path: Path) -> None:
    store = CredentialStore(tmp_path / "config.json", interactive=lambda: False)
    with pytest.raises(CredentialError, match=API_KEY_ENV):
        store.resolve()


def test_resolve_rejects_blank_prompted_key(tmp_path: Path) -> None:
    store = CredentialStore(
        tmp_path / "config.json",
        secret_prompt=lambda _: "   ",
        interactive=lambda: True,
    )
    with pytest.raises(CredentialError, match="must not be empty"):
        store.resolve()
