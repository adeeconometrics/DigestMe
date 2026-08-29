"""Tests for the headless CLI entry point."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from cli.config import CredentialError, Credentials
from cli.main import main
from cli.pipeline import CaseOutcome, PipelineDefinition

CREDENTIALS = Credentials(api_key="sk-test", model_slug="deepseek-v4-flash")


def _indir(tmp_path: Path) -> Path:
    indir = tmp_path / "in"
    indir.mkdir()
    (indir / "a.pdf").write_bytes(b"%PDF")
    (indir / "b.pdf").write_bytes(b"%PDF")
    return indir


def _fake_process_pdf(  # pylint: disable=unused-argument,too-many-arguments
    pdf: Path,
    out_dir: Path,
    credentials: Credentials,
    pipeline: PipelineDefinition,
    *,
    keep_intermediates: bool = False,
    agent_runner: object | None = None,
) -> CaseOutcome:
    out_dir.mkdir(parents=True, exist_ok=True)
    docx = out_dir / f"{pdf.stem}.docx"
    docx.write_bytes(b"PK")
    return CaseOutcome(pdf=pdf, status="ok", docx=docx, elapsed_ms=5)


class FakeStore:
    """Credential store stub that returns fixed credentials without IO."""

    def __init__(self) -> None:
        self.resolved: dict[str, object] = {}

    def resolve(
        self,
        api_key: str | None = None,
        model_slug: str | None = None,
        provider: str | None = None,
    ) -> Credentials:
        self.resolved = {"provider": provider}
        return CREDENTIALS


class FailingStore:
    """Credential store stub that always fails resolution."""

    def resolve(
        self,
        api_key: str | None = None,
        model_slug: str | None = None,
        provider: str | None = None,
    ) -> Credentials:
        raise CredentialError("No DeepSeek API key configured. Set DIGEST_API_KEY.")


def test_main_writes_summary_and_returns_zero(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    routed: dict[str, PipelineDefinition] = {}

    def fake_process_pdf(  # pylint: disable=unused-argument,too-many-arguments
        pdf: Path,
        out_dir: Path,
        credentials: Credentials,
        pipeline: PipelineDefinition,
        *,
        keep_intermediates: bool = False,
        agent_runner: object | None = None,
    ) -> CaseOutcome:
        routed["pipeline"] = pipeline
        return _fake_process_pdf(pdf, out_dir, credentials, pipeline, keep_intermediates=keep_intermediates)

    monkeypatch.setattr("cli.main.CredentialStore", FakeStore)
    monkeypatch.setattr("cli.main.process_pdf", fake_process_pdf)

    outdir = tmp_path / "out"
    code = main([str(_indir(tmp_path)), str(outdir), "--workers", "2"])

    assert code == 0
    assert routed["pipeline"].key == "case-digest"
    assert outdir.joinpath("a.docx").is_file()
    assert outdir.joinpath("b.docx").is_file()
    summary = json.loads(outdir.joinpath("summary.json").read_text(encoding="utf-8"))
    assert [row["case"] for row in summary] == ["a.pdf", "b.pdf"]
    assert all(row["status"] == "ok" for row in summary)
    output = capsys.readouterr().out
    assert "deepseek-v4-flash" in output
    assert "[1/2] ok" in output
    assert "[2/2] ok" in output
    assert "2/2 cases digested" in output


def test_main_reports_missing_credentials(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr("cli.main.CredentialStore", FailingStore)

    code = main([str(_indir(tmp_path)), str(tmp_path / "out")])
    assert code == 1
    assert "DIGEST_API_KEY" in capsys.readouterr().err


def test_main_returns_one_when_cases_fail(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def failing_process_pdf(  # pylint: disable=unused-argument
        pdf: Path,
        out_dir: Path,
        credentials: Credentials,
        pipeline: PipelineDefinition,
        *,
        keep_intermediates: bool = False,
        agent_runner: object | None = None,
    ) -> CaseOutcome:
        return CaseOutcome(pdf=pdf, status="failed", error="boom")

    monkeypatch.setattr("cli.main.CredentialStore", FakeStore)
    monkeypatch.setattr("cli.main.process_pdf", failing_process_pdf)

    code = main([str(_indir(tmp_path)), str(tmp_path / "out"), "--workers", "2"])
    assert code == 1


def test_main_commentary_agent_routes_commentary_pipeline(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    routed: dict[str, PipelineDefinition] = {}

    def fake_process_pdf(  # pylint: disable=unused-argument,too-many-arguments
        pdf: Path,
        out_dir: Path,
        credentials: Credentials,
        pipeline: PipelineDefinition,
        *,
        keep_intermediates: bool = False,
        agent_runner: object | None = None,
    ) -> CaseOutcome:
        routed["pipeline"] = pipeline
        return _fake_process_pdf(pdf, out_dir, credentials, pipeline, keep_intermediates=keep_intermediates)

    monkeypatch.setattr("cli.main.CredentialStore", FakeStore)
    monkeypatch.setattr("cli.main.process_pdf", fake_process_pdf)

    outdir = tmp_path / "out"
    code = main([str(_indir(tmp_path)), str(outdir), "--agent", "commentary-digest"])

    assert code == 0
    assert routed["pipeline"].key == "commentary-digest"
    output = capsys.readouterr().out
    assert "chapter(s)" in output
    assert "2/2 chapters digested" in output


def test_main_rejects_unknown_agent_routes(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("cli.main.CredentialStore", FakeStore)

    with pytest.raises(SystemExit) as exc_info:
        main([str(_indir(tmp_path)), str(tmp_path / "out"), "--agent", "unknown-digest"])
    assert exc_info.value.code == 2


def test_main_forwards_provider_to_credential_resolution(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store = FakeStore()
    monkeypatch.setattr("cli.main.CredentialStore", lambda: store)
    monkeypatch.setattr("cli.main.process_pdf", _fake_process_pdf)

    code = main([str(_indir(tmp_path)), str(tmp_path / "out"), "--provider", "openrouter"])

    assert code == 0
    assert store.resolved == {"provider": "openrouter"}


def test_main_rejects_missing_input_directory(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("cli.main.CredentialStore", FakeStore)
    with pytest.raises(SystemExit, match="input directory does not exist"):
        main([str(tmp_path / "nope"), str(tmp_path / "out")])
