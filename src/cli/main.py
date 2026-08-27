"""Headless mode entry point.

Batch-digests every PDF in ``indir`` into ``outdir`` using the pipeline
``cli(indir, outdir) | pdf-inspector | pydantic-agent | tsx-docx(outdir)``.
Cases are consumed from a service queue by ``--workers`` parallel workers
(default 8); each worker runs one full case pipeline.
"""

from __future__ import annotations

import argparse
import json
import sys
import threading
from collections.abc import Callable, Sequence
from functools import partial
from pathlib import Path

from .config import DEFAULT_MODEL_SLUG, CredentialError, CredentialStore, mask_key
from .pipeline import CaseOutcome, process_case
from .service_queue import ServiceQueue


def build_parser() -> argparse.ArgumentParser:
    """Build the headless-mode argument parser."""
    parser = argparse.ArgumentParser(
        prog="digest-headless",
        description="Batch case-digest pipeline: pdf-inspector | pydantic-agent | tsx-docx.",
    )
    parser.add_argument("indir", type=Path, help="directory containing one PDF per case")
    parser.add_argument("outdir", type=Path, help="directory for generated .docx files")
    parser.add_argument(
        "--workers",
        type=int,
        default=8,
        help="parallel service workers consuming the case queue (default: 8)",
    )
    parser.add_argument("--api-key", help="DeepSeek API key (overrides stored config)")
    parser.add_argument(
        "--model",
        default=None,
        help=f"model slug (default: {DEFAULT_MODEL_SLUG})",
    )
    parser.add_argument(
        "--keep-intermediates",
        action="store_true",
        help="keep per-case markdown/tree/digest files under <outdir>/work",
    )
    return parser


def discover_cases(indir: Path) -> list[Path]:
    """Return the sorted case PDFs in ``indir``, validating the directory."""
    if not indir.is_dir():
        raise SystemExit(f"error: input directory does not exist: {indir}")
    cases = sorted(indir.glob("*.pdf"))
    if not cases:
        raise SystemExit(f"error: no *.pdf files found in {indir}")
    return cases


def _format_elapsed(elapsed_ms: int) -> str:
    if elapsed_ms < 1000:
        return f"{elapsed_ms}ms"
    return f"{elapsed_ms / 1000:.1f}s"


def _live_progress(total: int) -> Callable[[CaseOutcome], None]:
    """Return a thread-safe reporter that prints each case as it finishes."""
    lock = threading.Lock()
    completed = 0

    def report(outcome: CaseOutcome) -> None:
        nonlocal completed
        with lock:
            completed += 1
            if outcome.status == "ok":
                assert outcome.docx is not None
                print(f"  [{completed}/{total}] ok      {_format_elapsed(outcome.elapsed_ms):>8}  {outcome.docx}")
            else:
                print(
                    f"  [{completed}/{total}] FAILED  {_format_elapsed(outcome.elapsed_ms):>8}  "
                    f"{outcome.pdf.name}: {outcome.error}"
                )

    return report


def _print_summary(outcomes: list[CaseOutcome]) -> None:
    """Print one line per case in input order plus a final tally."""
    ok_count = 0
    for outcome in outcomes:
        if outcome.status == "ok":
            ok_count += 1
            assert outcome.docx is not None
            print(f"  ok      {_format_elapsed(outcome.elapsed_ms):>8}  {outcome.docx}")
        else:
            print(f"  FAILED  {_format_elapsed(outcome.elapsed_ms):>8}  {outcome.pdf.name}: {outcome.error}")
    print(f"\n{ok_count}/{len(outcomes)} cases digested")

    failed = [outcome for outcome in outcomes if outcome.status == "failed"]
    if failed:
        print("Failed cases keep their intermediate artifacts under <outdir>/work/.")


def _on_done(
    job: Path,
    result_or_error: CaseOutcome | Exception,
    is_error: bool,
    report: Callable[[CaseOutcome], None],
) -> None:
    """Adapt a service-queue completion into a live status line."""
    if is_error:
        outcome = CaseOutcome(pdf=job, status="failed", error=str(result_or_error))
    else:
        completed_outcome = result_or_error
        assert isinstance(completed_outcome, CaseOutcome)
        outcome = completed_outcome
    report(outcome)


def main(argv: Sequence[str] | None = None) -> int:
    """Run the headless batch and return a process exit code."""
    args = build_parser().parse_args(argv)

    try:
        credentials = CredentialStore().resolve(api_key=args.api_key, model_slug=args.model)
    except CredentialError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    print(f"model: {credentials.model_slug}  api-key: ...{mask_key(credentials.api_key)}")

    cases = discover_cases(args.indir)
    print(f"digesting {len(cases)} case(s) into {args.outdir} with {args.workers} workers\n")

    worker = partial(
        process_case,
        out_dir=args.outdir,
        credentials=credentials,
        keep_intermediates=args.keep_intermediates,
    )
    report = _live_progress(len(cases))
    results, errors = ServiceQueue(
        cases,
        worker,
        worker_count=args.workers,
        on_done=partial(_on_done, report=report),
    ).run()
    assert not errors, f"unexpected worker failures: {errors}"

    outcomes = dict(results)
    ordered = [outcomes[case] for case in cases]
    _print_summary(ordered)

    summary_path = args.outdir / "summary.json"
    summary_path.parent.mkdir(parents=True, exist_ok=True)
    summary_path.write_text(
        json.dumps(
            [
                {
                    "case": outcome.pdf.name,
                    "status": outcome.status,
                    "docx": str(outcome.docx) if outcome.docx is not None else None,
                    "elapsed_ms": outcome.elapsed_ms,
                    "error": outcome.error,
                }
                for outcome in ordered
            ],
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    return 0 if all(outcome.status == "ok" for outcome in ordered) else 1


if __name__ == "__main__":
    sys.exit(main())
