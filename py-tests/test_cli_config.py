"""Tests for headless CLI credential resolution and storage."""

from __future__ import annotations

from pathlib import Path

import pytest

from cli.config import (
    API_KEY_ENV,
    DEFAULT_MODEL_SLUG,
    MODEL_SLUG_ENV,
    PROVIDER_ENV,
    CredentialError,
    CredentialStore,
    Credentials,
    normalize_model_slug,
)


def test_normalize_model_slug_strips_colon_provider_prefix() -> None:
    assert normalize_model_slug("deepseek:deepseek-v4-flash") == "deepseek-v4-flash"


def test_normalize_model_slug_strips_slash_provider_prefix() -> None:
    assert normalize_model_slug("deepseek/deepseek-v4-flash") == "deepseek-v4-flash"


def test_normalize_model_slug_passes_bare_model_id_through() -> None:
    assert normalize_model_slug("deepseek-v4-flash") == "deepseek-v4-flash"


def test_normalize_model_slug_strips_surrounding_space() -> None:
    assert normalize_model_slug("  deepseek-v4-flash  ") == "deepseek-v4-flash"


def test_normalize_model_slug_rejects_foreign_provider() -> None:
    with pytest.raises(CredentialError):
        normalize_model_slug("openai/gpt-4o-mini")


def test_normalize_openrouter_slug_preserves_provider_model_form() -> None:
    assert normalize_model_slug("deepseek/deepseek-v4-flash", "openrouter") == "deepseek/deepseek-v4-flash"
    assert normalize_model_slug("  openai/gpt-4o-mini  ", "openrouter") == "openai/gpt-4o-mini"


@pytest.mark.parametrize("slug", ["", "deepseek-v4-flash", "openai", "openai/gpt-4o/mini", "/gpt-4o"])
def test_normalize_openrouter_slug_rejects_malformed_slugs(slug: str) -> None:
    with pytest.raises(CredentialError):
        normalize_model_slug(slug, "openrouter")


@pytest.mark.parametrize("slug", ["", "   ", "deepseek/", "/gpt-4o", "openai:gpt-4o-mini"])
def test_normalize_model_slug_rejects_malformed_slugs(slug: str) -> None:
    with pytest.raises(CredentialError):
        normalize_model_slug(slug)


def test_store_round_trip_with_owner_only_permissions(tmp_path: Path) -> None:
    path = tmp_path / "config.json"
    store = CredentialStore(path)
    credentials = Credentials(api_key="sk-or-abc123", model_slug="openai/gpt-4o-mini", provider="openrouter")
    store.save(credentials)
    assert store.load() == credentials
    assert path.stat().st_mode & 0o777 == 0o600


def test_load_defaults_provider_to_deepseek_for_legacy_configs(tmp_path: Path) -> None:
    path = tmp_path / "config.json"
    path.write_text('{"api_key": "sk-legacy", "model_slug": "deepseek-chat"}', encoding="utf-8")

    credentials = CredentialStore(path).load()

    assert credentials == Credentials(api_key="sk-legacy", model_slug="deepseek-chat", provider="deepseek")


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
    monkeypatch.setenv(API_KEY_ENV, "sk-env")
    monkeypatch.setenv(MODEL_SLUG_ENV, "deepseek-chat")
    store = CredentialStore(tmp_path / "config.json")
    store.save(Credentials(api_key="sk-stored", model_slug="deepseek-reasoner"))

    credentials = store.resolve(api_key="sk-arg", model_slug="deepseek-v4-flash")
    assert credentials == Credentials(api_key="sk-arg", model_slug="deepseek-v4-flash")


def test_resolve_falls_back_to_environment(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv(API_KEY_ENV, "sk-env")
    monkeypatch.setenv(MODEL_SLUG_ENV, "deepseek-chat")
    credentials = CredentialStore(tmp_path / "config.json").resolve()
    assert credentials == Credentials(api_key="sk-env", model_slug="deepseek-chat")


def test_resolve_falls_back_to_stored_without_prompting(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.delenv(API_KEY_ENV, raising=False)
    monkeypatch.delenv(MODEL_SLUG_ENV, raising=False)
    store = CredentialStore(tmp_path / "config.json")
    store.save(Credentials(api_key="sk-stored", model_slug="deepseek-reasoner"))

    credentials = store.resolve()
    assert credentials == Credentials(api_key="sk-stored", model_slug="deepseek-reasoner")


def test_resolve_prompts_and_persists_on_first_run(tmp_path: Path) -> None:
    class PromptRecorder:
        def __init__(self) -> None:
            self.messages: list[str] = []

        def prompt(self, message: str) -> str:
            self.messages.append(message)
            return "deepseek-chat"

        def secret(self, message: str) -> str:
            self.messages.append(message)
            return "sk-typed"

    recorder = PromptRecorder()
    store = CredentialStore(
        tmp_path / "config.json",
        prompt=recorder.prompt,
        secret_prompt=recorder.secret,
        interactive=lambda: True,
    )

    credentials = store.resolve()
    assert credentials == Credentials(api_key="sk-typed", model_slug="deepseek-chat")
    assert store.load() == credentials
    assert recorder.messages == ["DeepSeek API key: ", "Model slug [deepseek-v4-flash]: "]


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


def test_resolve_prefers_argument_provider_over_env_and_stored(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv(PROVIDER_ENV, "openrouter")
    store = CredentialStore(tmp_path / "config.json")
    store.save(
        Credentials(api_key="sk-or-stored", model_slug="openai/gpt-4o-mini", provider="openrouter")
    )

    credentials = store.resolve(api_key="sk-or-arg", model_slug="deepseek/deepseek-chat", provider="deepseek")

    assert credentials == Credentials(api_key="sk-or-arg", model_slug="deepseek-chat", provider="deepseek")


def test_resolve_falls_back_to_provider_environment(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv(PROVIDER_ENV, "openrouter")
    monkeypatch.setenv(API_KEY_ENV, "sk-or-env")
    monkeypatch.setenv(MODEL_SLUG_ENV, "openai/gpt-4o-mini")

    credentials = CredentialStore(tmp_path / "config.json").resolve()

    assert credentials == Credentials(api_key="sk-or-env", model_slug="openai/gpt-4o-mini", provider="openrouter")


def test_resolve_uses_stored_provider_without_prompting(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.delenv(API_KEY_ENV, raising=False)
    monkeypatch.delenv(MODEL_SLUG_ENV, raising=False)
    monkeypatch.delenv(PROVIDER_ENV, raising=False)
    store = CredentialStore(tmp_path / "config.json")
    store.save(
        Credentials(api_key="sk-or-stored", model_slug="deepseek/deepseek-chat", provider="openrouter")
    )

    credentials = store.resolve()

    assert credentials == Credentials(
        api_key="sk-or-stored", model_slug="deepseek/deepseek-chat", provider="openrouter"
    )


def test_resolve_rejects_unknown_provider(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv(PROVIDER_ENV, "anthropic")
    with pytest.raises(CredentialError, match="Invalid provider 'anthropic'"):
        CredentialStore(tmp_path / "config.json").resolve(api_key="sk-x")


def test_resolve_prompts_openrouter_key_and_model_on_first_run(tmp_path: Path) -> None:
    messages: list[str] = []

    def record_model(message: str) -> str:
        messages.append(message)
        return "openai/gpt-4o-mini"

    def record_key(message: str) -> str:
        messages.append(message)
        return "sk-or-typed"

    store = CredentialStore(
        tmp_path / "config.json",
        prompt=record_model,
        secret_prompt=record_key,
        interactive=lambda: True,
    )

    credentials = store.resolve(provider="openrouter")

    assert credentials == Credentials(api_key="sk-or-typed", model_slug="openai/gpt-4o-mini", provider="openrouter")
    assert store.load() == credentials
    assert messages == ["OpenRouter API key: ", "Model slug (provider/model, e.g. openai/gpt-4o-mini): "]


def test_resolve_requires_openrouter_model_slug_without_tty(tmp_path: Path) -> None:
    store = CredentialStore(
        tmp_path / "config.json",
        secret_prompt=lambda _: "sk-or-typed",
        interactive=lambda: False,
    )
    with pytest.raises(CredentialError, match=MODEL_SLUG_ENV):
        store.resolve(api_key="sk-or-cli", provider="openrouter")
