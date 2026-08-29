"""Per-case headless pipeline: pdf-inspector -> pydantic-agent -> tsx-docx.

Stage 1 shells out to the pdf-inspector tsx script (WASM PDF -> markdown plus
context tree), stage 2 runs the pydantic-agent digest in-process against that
tree, and stage 3 shells out to the tsx-docx script (digest JSON -> .docx).
Both digest families (case and commentary) share this shape; the commentary
family runs the typed ``CommentaryDigest`` agent and its own tsx renderer.
Intermediates live under ``<outdir>/work/<case>/`` and the final document is
written to ``<outdir>/<case>.docx``.
"""

from __future__ import annotations

import asyncio
import json
import shutil
import subprocess
import time
from collections.abc import Callable, Coroutine, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from engine.agent import DIGEST_USAGE_LIMITS, build_commentary_deepseek_agent, build_deepseek_agent
from engine.bridge import run_case_digest, run_commentary_digest
from engine.schemas import CaseDigestResult, CommentaryDigestResult

from .config import Credentials

REPO_ROOT = Path(__file__).resolve().parents[2]
TS_SCRIPT_DIR = Path(__file__).resolve().parent / "ts"
PDF_INSPECTOR_SCRIPT = TS_SCRIPT_DIR / "pdf-inspector.ts"
DOCX_SCRIPT = TS_SCRIPT_DIR / "docx.ts"
COMMENTARY_DOCX_SCRIPT = TS_SCRIPT_DIR / "commentary-docx.ts"

DEFAULT_NODE_TIMEOUT_SECONDS = 900.0
"""Generous cap for WASM parsing or DOCX packing of a large case."""

DIGEST_STAGE_TIMEOUT_SECONDS = 600.0
"""Per-case wall-clock cap (10 minutes) for the in-process agent stage."""

DigestRunner = Callable[..., Coroutine[Any, Any, CaseDigestResult]]
"""Invocable case-digest runner; defaults to the DeepSeek-platform engine bridge."""

CommentaryRunner = Callable[..., Coroutine[Any, Any, CommentaryDigestResult]]
"""Invocable commentary-digest runner; defaults to the DeepSeek-platform engine bridge."""


class PipelineError(RuntimeError):
    """Raised when a pipeline stage fails without a Python-level exception."""


@dataclass
class CaseOutcome:
    """Result of running the full pipeline for one case PDF."""

    pdf: Path
    status: Literal["ok", "failed"]
    docx: Path | None = None
    elapsed_ms: int = 0
    error: str | None = None


def _tsx_command() -> list[str]:
    """Return the local tsx launcher, with a clear error when npm deps are missing."""
    binary = REPO_ROOT / "node_modules" / ".bin" / "tsx"
    if not binary.is_file():
        raise PipelineError(
            "tsx is not installed. Run `npm ci` at the repository root before headless mode."
        )
    return [str(binary)]


def run_node_script(
    script: Path,
    *args: str,
    timeout: float = DEFAULT_NODE_TIMEOUT_SECONDS,
) -> str:
    """Run one TypeScript stage script under tsx, returning its stdout.

    Raises ``PipelineError`` with the captured stderr when the script exits
    non-zero, so a broken PDF or invalid digest is reported without aborting
    the worker.
    """
    completed = subprocess.run(
        [*_tsx_command(), str(script), *args],
        capture_output=True,
        text=True,
        cwd=REPO_ROOT,
        timeout=timeout,
        check=False,
    )
    if completed.returncode != 0:
        detail = (completed.stderr.strip() or completed.stdout.strip()) or "no output"
        raise PipelineError(f"{script.name} failed: {detail[:400]}")
    return completed.stdout


def stage_pdf_inspector(pdf_path: Path, work_dir: Path) -> tuple[Path, Path]:
    """Convert one PDF to markdown and a context tree via the pdf-inspector script."""
    markdown_path = work_dir / "source.md"
    tree_path = work_dir / "tree.json"
    run_node_script(PDF_INSPECTOR_SCRIPT, str(pdf_path), str(markdown_path), str(tree_path))
    if not markdown_path.is_file() or not tree_path.is_file():
        raise PipelineError(f"pdf-inspector produced no output for {pdf_path.name}")
    return markdown_path, tree_path


async def run_deepseek_digest(
    root: Mapping[str, object],
    *,
    api_key: str,
    model_name: str,
) -> CaseDigestResult:
    """Run one digest against DeepSeek's platform API (``api.deepseek.com``).

    The agent run gets the generous headless request budget and a 10-minute
    wall-clock cap so one runaway case cannot stall its worker forever.
    """
    agent = build_deepseek_agent(api_key=api_key, model_name=model_name)
    try:
        return await asyncio.wait_for(
            run_case_digest(
                root,
                api_key=api_key,
                model_name=model_name,
                agent=agent,
                usage_limits=DIGEST_USAGE_LIMITS,
            ),
            timeout=DIGEST_STAGE_TIMEOUT_SECONDS,
        )
    except TimeoutError as error:
        raise PipelineError(
            f"agent stage exceeded the {DIGEST_STAGE_TIMEOUT_SECONDS:g}s per-case limit"
        ) from error


async def run_commentary_deepseek_digest(
    root: Mapping[str, object],
    *,
    api_key: str,
    model_name: str,
) -> CommentaryDigestResult:
    """Run one commentary digest against DeepSeek's platform API.

    The commentary agent gets the same generous headless request budget and
    10-minute wall-clock cap as case digests, sized for book-scale chapter
    retrieval sweeps.
    """
    agent = build_commentary_deepseek_agent(api_key=api_key, model_name=model_name)
    try:
        return await asyncio.wait_for(
            run_commentary_digest(
                root,
                api_key=api_key,
                model_name=model_name,
                agent=agent,
                usage_limits=DIGEST_USAGE_LIMITS,
            ),
            timeout=DIGEST_STAGE_TIMEOUT_SECONDS,
        )
    except TimeoutError as error:
        raise PipelineError(
            f"agent stage exceeded the {DIGEST_STAGE_TIMEOUT_SECONDS:g}s per-case limit"
        ) from error


def stage_agent(
    tree_path: Path,
    credentials: Credentials,
    work_dir: Path,
    *,
    runner: DigestRunner | None = None,
) -> Path:
    """Run the structured pydantic-agent digest over the context tree.

    The agent is invoked in-process with a fresh event loop per case so the
    shared service-queue workers stay independent. ``runner`` is injectable so
    tests can substitute a deterministic digest producer. The default runner
    targets the DeepSeek platform directly.
    """
    root: Mapping[str, object] = json.loads(tree_path.read_text(encoding="utf-8"))
    digest_runner = runner or run_deepseek_digest
    result = asyncio.run(digest_runner(root, api_key=credentials.api_key, model_name=credentials.model_slug))
    digest_path = work_dir / "digest.json"
    digest_path.write_text(result.digest.model_dump_json(indent=2), encoding="utf-8")
    return digest_path


def stage_commentary_agent(
    tree_path: Path,
    credentials: Credentials,
    work_dir: Path,
    *,
    runner: CommentaryRunner | None = None,
) -> Path:
    """Run the structured commentary-digest agent over the context tree.

    Mirrors ``stage_agent`` but writes the typed ``CommentaryDigest`` contract
    to ``commentary.json``; the default runner targets the DeepSeek platform.
    """
    root: Mapping[str, object] = json.loads(tree_path.read_text(encoding="utf-8"))
    commentary_runner = runner or run_commentary_deepseek_digest
    result = asyncio.run(
        commentary_runner(root, api_key=credentials.api_key, model_name=credentials.model_slug)
    )
    commentary_path = work_dir / "commentary.json"
    commentary_path.write_text(result.digest.model_dump_json(indent=2), encoding="utf-8")
    return commentary_path


def stage_docx(digest_path: Path, out_dir: Path, stem: str) -> Path:
    """Render the digest JSON to ``<out_dir>/<stem>.docx`` via the tsx-docx script."""
    docx_path = out_dir / f"{stem}.docx"
    run_node_script(DOCX_SCRIPT, str(digest_path), str(docx_path))
    if not docx_path.is_file():
        raise PipelineError(f"tsx-docx produced no document for {stem}")
    return docx_path


def stage_commentary_docx(commentary_path: Path, out_dir: Path, stem: str) -> Path:
    """Render the commentary JSON to ``<out_dir>/<stem>.docx`` via the tsx script."""
    docx_path = out_dir / f"{stem}.docx"
    run_node_script(COMMENTARY_DOCX_SCRIPT, str(commentary_path), str(docx_path))
    if not docx_path.is_file():
        raise PipelineError(f"tsx-commentary-docx produced no document for {stem}")
    return docx_path


def _work_dir(out_dir: Path, stem: str) -> Path:
    work_dir = out_dir / "work" / stem
    shutil.rmtree(work_dir, ignore_errors=True)
    work_dir.mkdir(parents=True, exist_ok=True)
    return work_dir


def _process_pdf(  # pylint: disable=too-many-arguments,too-many-locals  # family-parametrized pipeline entry
    pdf_path: Path,
    out_dir: Path,
    credentials: Credentials,
    *,
    agent_stage: Callable[..., Path],
    docx_stage: Callable[..., Path],
    keep_intermediates: bool = False,
    agent_runner: DigestRunner | CommentaryRunner | None = None,
) -> CaseOutcome:
    """Run the shared pdf-inspector -> agent -> docx pipeline for one PDF.

    ``agent_stage`` and ``docx_stage`` select the digest family (case or
    commentary) while failure isolation, work-dir cleanup, and timing stay
    common. Intermediate artifacts are kept when ``keep_intermediates`` is
    true or when the case fails, so failures can be inspected in
    ``<out_dir>/work/<case>/``.
    """
    started_at = time.perf_counter()
    out_dir.mkdir(parents=True, exist_ok=True)
    stem = pdf_path.stem
    work_dir = _work_dir(out_dir, stem)
    try:
        _, tree_path = stage_pdf_inspector(pdf_path, work_dir)
        digest_path = agent_stage(tree_path, credentials, work_dir, runner=agent_runner)
        docx_path = docx_stage(digest_path, out_dir, stem)
    except (OSError, PipelineError, json.JSONDecodeError) as error:
        elapsed_ms = round((time.perf_counter() - started_at) * 1000)
        return CaseOutcome(pdf=pdf_path, status="failed", elapsed_ms=elapsed_ms, error=str(error))
    except Exception as error:  # pylint: disable=broad-exception-caught  # isolate one bad case
        elapsed_ms = round((time.perf_counter() - started_at) * 1000)
        message = str(error) or type(error).__name__
        return CaseOutcome(pdf=pdf_path, status="failed", elapsed_ms=elapsed_ms, error=message)

    if not keep_intermediates:
        shutil.rmtree(work_dir, ignore_errors=True)
    elapsed_ms = round((time.perf_counter() - started_at) * 1000)
    return CaseOutcome(pdf=pdf_path, status="ok", docx=docx_path, elapsed_ms=elapsed_ms)


@dataclass(frozen=True)
class PipelineDefinition:
    """One routable agent pipeline: agent wiring plus its renderer pairing.

    ``key`` is the CLI agent-route identifier, ``unit_label`` and
    ``summary_unit`` drive the progress wording, ``agent_stage``/``docx_stage``
    select the digest family, and ``default_runner`` names the in-process
    agent runner used when no runner is injected.
    """

    key: Literal["case-digest", "commentary-digest"]
    unit_label: str
    summary_unit: str
    agent_stage: Callable[..., Path]
    docx_stage: Callable[..., Path]
    default_runner: DigestRunner | CommentaryRunner


PIPELINES: dict[str, PipelineDefinition] = {
    "case-digest": PipelineDefinition(
        key="case-digest",
        unit_label="case(s)",
        summary_unit="cases",
        agent_stage=stage_agent,
        docx_stage=stage_docx,
        default_runner=run_deepseek_digest,
    ),
    "commentary-digest": PipelineDefinition(
        key="commentary-digest",
        unit_label="chapter(s)",
        summary_unit="chapters",
        agent_stage=stage_commentary_agent,
        docx_stage=stage_commentary_docx,
        default_runner=run_commentary_deepseek_digest,
    ),
}
"""Agent-route registry: the single dispatch table for headless pipelines."""


def resolve_pipeline(key: str) -> PipelineDefinition:
    """Return the pipeline definition registered for an agent route key."""
    try:
        return PIPELINES[key]
    except KeyError as error:
        raise KeyError(f"Unknown agent route {key!r}; choose from {', '.join(sorted(PIPELINES))}") from error


def process_pdf(
    pdf_path: Path,
    out_dir: Path,
    credentials: Credentials,
    pipeline: PipelineDefinition,
    *,
    keep_intermediates: bool = False,
    agent_runner: DigestRunner | CommentaryRunner | None = None,
) -> CaseOutcome:
    """Run the full pipeline for one PDF through a registered agent route.

    The route's ``agent_stage`` and ``docx_stage`` select the digest family,
    and its ``default_runner`` is used unless an explicit runner is injected.
    """
    return _process_pdf(
        pdf_path,
        out_dir,
        credentials,
        agent_stage=pipeline.agent_stage,
        docx_stage=pipeline.docx_stage,
        keep_intermediates=keep_intermediates,
        agent_runner=agent_runner or pipeline.default_runner,
    )


def process_case(
    pdf_path: Path,
    out_dir: Path,
    credentials: Credentials,
    *,
    keep_intermediates: bool = False,
    agent_runner: DigestRunner | None = None,
) -> CaseOutcome:
    """Run the full case-digest pipeline for one case PDF, isolating failures per case."""
    return process_pdf(
        pdf_path,
        out_dir,
        credentials,
        PIPELINES["case-digest"],
        keep_intermediates=keep_intermediates,
        agent_runner=agent_runner,
    )


def process_chapter(
    pdf_path: Path,
    out_dir: Path,
    credentials: Credentials,
    *,
    keep_intermediates: bool = False,
    agent_runner: CommentaryRunner | None = None,
) -> CaseOutcome:
    """Run the full commentary-digest pipeline for one chapter PDF.

    The commentary agent enumerates the chapter's sections with the retrieval
    toolset, then the tsx stage renders the typed ``CommentaryDigest`` contract
    to ``<out_dir>/<stem>.docx`` for review.
    """
    return process_pdf(
        pdf_path,
        out_dir,
        credentials,
        PIPELINES["commentary-digest"],
        keep_intermediates=keep_intermediates,
        agent_runner=agent_runner,
    )
