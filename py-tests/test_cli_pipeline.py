"""Tests for the headless per-case pipeline stages."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

from cli.config import Credentials
from cli.pipeline import (
    REPO_ROOT,
    PipelineError,
    process_case,
    run_node_script,
    stage_agent,
    stage_docx,
    stage_pdf_inspector,
)

CREDENTIALS = Credentials(api_key="sk-or-test", model_slug="openai/gpt-4o-mini")


def _completed(stdout: str = "", stderr: str = "", returncode: int = 0) -> subprocess.CompletedProcess[str]:
    return subprocess.CompletedProcess(args=[], returncode=returncode, stdout=stdout, stderr=stderr)


def test_run_node_script_returns_stdout(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}

    def fake_run(cmd: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
        captured["cmd"] = cmd
        captured["cwd"] = kwargs.get("cwd")
        return _completed(stdout="hello\n")

    monkeypatch.setattr("cli.pipeline.subprocess.run", fake_run)
    output = run_node_script(Path("scripts/docx.ts"), "a.json", "b.docx")
    assert output == "hello\n"
    assert captured["cwd"] == REPO_ROOT
    command = captured["cmd"]
    assert isinstance(command, list)
    assert command[0].endswith("node_modules/.bin/tsx")
    assert command[-3:] == ["scripts/docx.ts", "a.json", "b.docx"]


def test_run_node_script_raises_with_stderr_detail(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "cli.pipeline.subprocess.run",
        lambda cmd, **kwargs: _completed(stderr="boom detail", returncode=1),
    )
    with pytest.raises(PipelineError, match="boom detail"):
        run_node_script(Path("scripts/docx.ts"), "a.json", "b.docx")


def test_run_node_script_raises_when_tsx_is_missing(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setattr("cli.pipeline.REPO_ROOT", tmp_path)
    with pytest.raises(PipelineError, match="npm ci"):
        run_node_script(Path("scripts/docx.ts"))


def test_stage_pdf_inspector_writes_artifacts(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    def fake_run(script: Path, pdf: str, md: str, tree: str) -> str:
        Path(md).write_text("# doc", encoding="utf-8")
        Path(tree).write_text("{}", encoding="utf-8")
        return "{}"

    monkeypatch.setattr("cli.pipeline.run_node_script", fake_run)
    work_dir = tmp_path / "work"
    work_dir.mkdir()
    markdown_path, tree_path = stage_pdf_inspector(tmp_path / "case.pdf", work_dir)
    assert markdown_path.read_text(encoding="utf-8") == "# doc"
    assert tree_path.read_text(encoding="utf-8") == "{}"


def test_stage_pdf_inspector_detects_missing_output(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setattr(
        "cli.pipeline.run_node_script", lambda _script, _pdf, _md, _tree: "{}"
    )
    with pytest.raises(PipelineError, match="no output"):
        stage_pdf_inspector(tmp_path / "case.pdf", tmp_path / "work")


def test_stage_agent_writes_digest_json(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    tree_path = tmp_path / "tree.json"
    tree_path.write_text(json.dumps({"id": "n0"}), encoding="utf-8")
    captured: dict[str, str] = {}

    class FakeDigest:
        def model_dump_json(self, *, indent: int) -> str:
            return json.dumps({"case_title": "A v. B"}, indent=indent)

    class FakeResult:
        digest = FakeDigest()

    async def fake_run_digest(root: object, *, api_key: str, model_name: str) -> FakeResult:
        captured["root"] = str(root)
        captured["api_key"] = api_key
        captured["model_name"] = model_name
        return FakeResult()

    monkeypatch.setattr("cli.pipeline.run_case_digest", fake_run_digest)
    digest_path = stage_agent(tree_path, CREDENTIALS, tmp_path)
    assert json.loads(digest_path.read_text(encoding="utf-8")) == {"case_title": "A v. B"}
    assert captured == {"root": "{'id': 'n0'}", "api_key": "sk-or-test", "model_name": "openai/gpt-4o-mini"}


def test_stage_docx_writes_document(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    def fake_run(script: Path, digest: str, docx: str) -> str:
        Path(docx).write_bytes(b"PK")
        return '{"bytes": 2}'

    monkeypatch.setattr("cli.pipeline.run_node_script", fake_run)
    digest_path = tmp_path / "digest.json"
    digest_path.write_text("{}", encoding="utf-8")
    docx_path = stage_docx(digest_path, tmp_path, "A v. B")
    assert docx_path.name == "A v. B.docx"
    assert docx_path.read_bytes() == b"PK"


def test_stage_docx_detects_missing_document(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setattr(
        "cli.pipeline.run_node_script", lambda _script, _digest, _docx: "{}"
    )
    with pytest.raises(PipelineError, match="no document"):
        stage_docx(tmp_path / "digest.json", tmp_path, "A v. B")


def test_process_case_happy_path(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    def fake_pdf_inspector(pdf: Path, work_dir: Path) -> tuple[Path, Path]:
        markdown_path = work_dir / "source.md"
        tree_path = work_dir / "tree.json"
        markdown_path.write_text("# doc", encoding="utf-8")
        tree_path.write_text("{}", encoding="utf-8")
        return markdown_path, tree_path

    def fake_agent(
        tree: Path, credentials: Credentials, work_dir: Path, *, runner: object | None = None
    ) -> Path:
        digest_path = work_dir / "digest.json"
        digest_path.write_text("{}", encoding="utf-8")
        return digest_path

    def fake_docx(digest: Path, out_dir: Path, stem: str) -> Path:
        docx_path = out_dir / f"{stem}.docx"
        docx_path.write_bytes(b"PK")
        return docx_path

    monkeypatch.setattr("cli.pipeline.stage_pdf_inspector", fake_pdf_inspector)
    monkeypatch.setattr("cli.pipeline.stage_agent", fake_agent)
    monkeypatch.setattr("cli.pipeline.stage_docx", fake_docx)

    pdf_path = tmp_path / "A v. B.pdf"
    pdf_path.write_bytes(b"%PDF")
    out_dir = tmp_path / "out"
    outcome = process_case(pdf_path, out_dir, CREDENTIALS)

    assert outcome.status == "ok"
    assert outcome.docx == out_dir / "A v. B.docx"
    assert outcome.error is None
    assert outcome.docx.is_file()
    assert not (out_dir / "work" / "case").exists()


def test_process_case_keeps_intermediates_when_requested(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    def fake_pdf_inspector(pdf: Path, work_dir: Path) -> tuple[Path, Path]:
        tree_path = work_dir / "tree.json"
        tree_path.write_text("{}", encoding="utf-8")
        return work_dir / "source.md", tree_path

    def fake_agent(
        tree: Path, credentials: Credentials, work_dir: Path, *, runner: object | None = None
    ) -> Path:
        digest_path = work_dir / "digest.json"
        digest_path.write_text("{}", encoding="utf-8")
        return digest_path

    def fake_docx(digest: Path, out_dir: Path, stem: str) -> Path:
        docx_path = out_dir / f"{stem}.docx"
        docx_path.write_bytes(b"PK")
        return docx_path

    monkeypatch.setattr("cli.pipeline.stage_pdf_inspector", fake_pdf_inspector)
    monkeypatch.setattr("cli.pipeline.stage_agent", fake_agent)
    monkeypatch.setattr("cli.pipeline.stage_docx", fake_docx)

    pdf_path = tmp_path / "case.pdf"
    pdf_path.write_bytes(b"%PDF")
    out_dir = tmp_path / "out"
    outcome = process_case(pdf_path, out_dir, CREDENTIALS, keep_intermediates=True)

    assert outcome.status == "ok"
    assert (out_dir / "work" / "case" / "tree.json").is_file()
    assert (out_dir / "work" / "case" / "digest.json").is_file()


def test_process_case_isolates_stage_failure(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    def failing_stage(pdf: Path, work_dir: Path) -> tuple[Path, Path]:
        raise PipelineError("pdf-inspector failed: boom")

    monkeypatch.setattr("cli.pipeline.stage_pdf_inspector", failing_stage)

    pdf_path = tmp_path / "case.pdf"
    pdf_path.write_bytes(b"%PDF")
    outcome = process_case(pdf_path, tmp_path / "out", CREDENTIALS)

    assert outcome.status == "failed"
    assert "boom" in (outcome.error or "")
    assert outcome.docx is None
    assert (tmp_path / "out" / "work" / "case").is_dir()
