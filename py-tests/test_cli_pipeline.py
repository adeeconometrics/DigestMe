"""Tests for the headless per-case pipeline stages."""

from __future__ import annotations

import asyncio
import json
import subprocess
from collections.abc import Callable
from pathlib import Path

import pytest

from cli.config import Credentials
from cli.pipeline import (
    PIPELINES,
    REPO_ROOT,
    CaseOutcome,
    PipelineDefinition,
    PipelineError,
    process_case,
    process_chapter,
    process_pdf,
    resolve_pipeline,
    run_commentary_deepseek_digest,
    run_deepseek_digest,
    run_node_script,
    stage_agent,
    stage_commentary_agent,
    stage_commentary_docx,
    stage_docx,
    stage_pdf_inspector,
)
from engine.agent import DIGEST_USAGE_LIMITS

CREDENTIALS = Credentials(api_key="sk-test", model_slug="deepseek-v4-flash")


def _registered_route(
    key: str,
    *,
    agent_stage: Callable[..., Path],
    docx_stage: Callable[..., Path],
) -> PipelineDefinition:
    """Rebuild a registry route with fake stages while keeping its labels."""
    base = PIPELINES[key]
    return PipelineDefinition(
        key=key,
        unit_label=base.unit_label,
        summary_unit=base.summary_unit,
        agent_stage=agent_stage,
        docx_stage=docx_stage,
        default_runner=base.default_runner,
    )


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

    async def fake_run_digest(
        root: object, *, api_key: str, model_name: str, agent: object, usage_limits: object
    ) -> FakeResult:
        captured["root"] = str(root)
        captured["api_key"] = api_key
        captured["model_name"] = model_name
        captured["agent_built"] = "True" if agent is not None else "False"
        captured["usage_limits"] = "set" if usage_limits is not None else "unset"
        return FakeResult()

    monkeypatch.setattr("cli.pipeline.run_case_digest", fake_run_digest)
    digest_path = stage_agent(tree_path, CREDENTIALS, tmp_path)
    assert json.loads(digest_path.read_text(encoding="utf-8")) == {"case_title": "A v. B"}
    assert captured == {
        "root": "{'id': 'n0'}",
        "api_key": "sk-test",
        "model_name": "deepseek-v4-flash",
        "agent_built": "True",
        "usage_limits": "set",
    }


def test_run_deepseek_digest_uses_generous_usage_limits(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, object] = {}

    class FakeDigest:
        def model_dump_json(self, *, indent: int) -> str:
            return "{}"

    class FakeResult:
        digest = FakeDigest()

    async def fake_run_digest(root: object, **kwargs: object) -> FakeResult:
        captured["usage_limits"] = kwargs.get("usage_limits")
        return FakeResult()

    monkeypatch.setattr("cli.pipeline.run_case_digest", fake_run_digest)
    asyncio.run(run_deepseek_digest({"id": "n0"}, api_key="sk-test", model_name="deepseek-v4-flash"))
    assert captured["usage_limits"] == DIGEST_USAGE_LIMITS


def test_run_deepseek_digest_raises_on_stage_timeout(monkeypatch: pytest.MonkeyPatch) -> None:
    async def never_finishes(root: object, **kwargs: object) -> object:
        await asyncio.sleep(60)
        return None

    monkeypatch.setattr("cli.pipeline.run_case_digest", never_finishes)
    monkeypatch.setattr("cli.pipeline.DIGEST_STAGE_TIMEOUT_SECONDS", 0.05)

    with pytest.raises(PipelineError, match="exceeded the"):
        asyncio.run(run_deepseek_digest({"id": "n0"}, api_key="sk-test", model_name="deepseek-v4-flash"))


def test_run_commentary_deepseek_digest_uses_generous_usage_limits(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, object] = {}

    class FakeDigest:
        def model_dump_json(self, *, indent: int) -> str:
            return "{}"

    class FakeResult:
        digest = FakeDigest()

    async def fake_run_commentary(root: object, **kwargs: object) -> FakeResult:
        captured["usage_limits"] = kwargs.get("usage_limits")
        captured["agent_name"] = getattr(kwargs.get("agent"), "name", None)
        return FakeResult()

    monkeypatch.setattr("cli.pipeline.run_commentary_digest", fake_run_commentary)
    asyncio.run(
        run_commentary_deepseek_digest({"id": "n0"}, api_key="sk-test", model_name="deepseek-v4-flash")
    )
    assert captured["usage_limits"] == DIGEST_USAGE_LIMITS
    assert captured["agent_name"] == "commentary-digest-engine"


def test_stage_commentary_agent_writes_commentary_json(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    tree_path = tmp_path / "tree.json"
    tree_path.write_text(json.dumps({"id": "n0"}), encoding="utf-8")
    captured: dict[str, str] = {}

    class FakeDigest:
        def model_dump_json(self, *, indent: int) -> str:
            return json.dumps({"chapter_title": "Board of Directors"}, indent=indent)

    class FakeResult:
        digest = FakeDigest()

    async def fake_run_commentary(root: object, **kwargs: object) -> FakeResult:
        captured["model_name"] = str(kwargs.get("model_name"))
        captured["usage_limits"] = "set" if kwargs.get("usage_limits") is not None else "unset"
        return FakeResult()

    monkeypatch.setattr("cli.pipeline.run_commentary_deepseek_digest", fake_run_commentary)
    commentary_path = stage_commentary_agent(tree_path, CREDENTIALS, tmp_path)
    assert json.loads(commentary_path.read_text(encoding="utf-8")) == {
        "chapter_title": "Board of Directors"
    }
    assert captured == {"model_name": "deepseek-v4-flash", "usage_limits": "unset"}


def test_stage_commentary_docx_writes_document(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    captured: dict[str, object] = {}

    def fake_run(script: Path, digest: str, docx: str) -> str:
        captured["script"] = script.name
        Path(docx).write_bytes(b"PK")
        return '{"bytes": 2}'

    monkeypatch.setattr("cli.pipeline.run_node_script", fake_run)
    commentary_path = tmp_path / "commentary.json"
    commentary_path.write_text("{}", encoding="utf-8")
    docx_path = stage_commentary_docx(commentary_path, tmp_path, "Board of Directors")
    assert captured["script"] == "commentary-docx.ts"
    assert docx_path.name == "Board of Directors.docx"
    assert docx_path.read_bytes() == b"PK"


def test_process_chapter_happy_path(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    def fake_pdf_inspector(pdf: Path, work_dir: Path) -> tuple[Path, Path]:
        markdown_path = work_dir / "source.md"
        tree_path = work_dir / "tree.json"
        markdown_path.write_text("# doc", encoding="utf-8")
        tree_path.write_text("{}", encoding="utf-8")
        return markdown_path, tree_path

    def fake_agent(
        tree: Path, credentials: Credentials, work_dir: Path, *, runner: object | None = None
    ) -> Path:
        commentary_path = work_dir / "commentary.json"
        commentary_path.write_text("{}", encoding="utf-8")
        return commentary_path

    def fake_docx(digest: Path, out_dir: Path, stem: str) -> Path:
        docx_path = out_dir / f"{stem}.docx"
        docx_path.write_bytes(b"PK")
        return docx_path

    monkeypatch.setattr("cli.pipeline.stage_pdf_inspector", fake_pdf_inspector)
    monkeypatch.setitem(
        PIPELINES,
        "commentary-digest",
        _registered_route("commentary-digest", agent_stage=fake_agent, docx_stage=fake_docx),
    )

    pdf_path = tmp_path / "Board of Directors.pdf"
    pdf_path.write_bytes(b"%PDF")
    outcome = process_chapter(pdf_path, tmp_path / "out", CREDENTIALS)

    assert outcome.status == "ok"
    assert outcome.docx == tmp_path / "out" / "Board of Directors.docx"
    assert outcome.docx.is_file()


def test_process_chapter_isolates_stage_failure(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    def failing_stage(  # pylint: disable=unused-argument
        tree: Path, credentials: Credentials, work_dir: Path, *, runner: object | None = None
    ) -> Path:
        raise PipelineError("tsx-commentary-docx failed: boom")

    def fake_inspector(pdf: Path, work_dir: Path) -> tuple[Path, Path]:
        return work_dir / "s.md", work_dir / "t.json"

    monkeypatch.setattr("cli.pipeline.stage_pdf_inspector", fake_inspector)
    monkeypatch.setitem(
        PIPELINES,
        "commentary-digest",
        _registered_route("commentary-digest", agent_stage=failing_stage, docx_stage=stage_commentary_docx),
    )

    pdf_path = tmp_path / "chapter.pdf"
    pdf_path.write_bytes(b"%PDF")
    outcome = process_chapter(pdf_path, tmp_path / "out", CREDENTIALS)

    assert outcome.status == "failed"
    assert "boom" in (outcome.error or "")
    assert outcome.docx is None


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
    monkeypatch.setitem(
        PIPELINES,
        "case-digest",
        _registered_route("case-digest", agent_stage=fake_agent, docx_stage=fake_docx),
    )

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
    monkeypatch.setitem(
        PIPELINES,
        "case-digest",
        _registered_route("case-digest", agent_stage=fake_agent, docx_stage=fake_docx),
    )

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


def test_pipeline_registry_maps_agent_routes_to_stages() -> None:
    assert set(PIPELINES) == {"case-digest", "commentary-digest"}

    case_route = PIPELINES["case-digest"]
    assert case_route.unit_label == "case(s)"
    assert case_route.summary_unit == "cases"
    assert case_route.agent_stage is stage_agent
    assert case_route.docx_stage is stage_docx
    assert case_route.default_runner is run_deepseek_digest

    commentary_route = PIPELINES["commentary-digest"]
    assert commentary_route.unit_label == "chapter(s)"
    assert commentary_route.summary_unit == "chapters"
    assert commentary_route.agent_stage is stage_commentary_agent
    assert commentary_route.docx_stage is stage_commentary_docx
    assert commentary_route.default_runner is run_commentary_deepseek_digest


def test_resolve_pipeline_rejects_unknown_routes() -> None:
    with pytest.raises(KeyError, match="Unknown agent route 'unknown-digest'"):
        resolve_pipeline("unknown-digest")


def test_process_case_and_chapter_delegate_to_registered_routes(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    captured: dict[str, object] = {}

    def fake_process_pdf(
        pdf: Path,
        out_dir: Path,
        credentials: Credentials,
        pipeline: object,
        *,
        keep_intermediates: bool = False,
        agent_runner: object | None = None,
    ) -> CaseOutcome:
        captured["pipeline"] = pipeline
        return CaseOutcome(pdf=pdf, status="ok")

    monkeypatch.setattr("cli.pipeline.process_pdf", fake_process_pdf)
    pdf_path = tmp_path / "a.pdf"

    process_case(pdf_path, tmp_path / "out", CREDENTIALS)
    assert captured["pipeline"].key == "case-digest"

    process_chapter(pdf_path, tmp_path / "out", CREDENTIALS)
    assert captured["pipeline"].key == "commentary-digest"


def test_process_pdf_defaults_to_the_route_runner(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    captured: dict[str, object] = {}

    def fake_process_pdf(  # pylint: disable=unused-argument
        pdf: Path,
        out_dir: Path,
        credentials: Credentials,
        **kwargs: object,
    ) -> CaseOutcome:
        captured["runner"] = kwargs.get("agent_runner")
        return CaseOutcome(pdf=pdf, status="ok")

    monkeypatch.setattr("cli.pipeline._process_pdf", fake_process_pdf)
    pdf_path = tmp_path / "a.pdf"

    process_pdf(pdf_path, tmp_path / "out", CREDENTIALS, PIPELINES["case-digest"])
    assert captured["runner"] is run_deepseek_digest
