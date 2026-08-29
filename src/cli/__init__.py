"""Headless case-digest CLI package.

Wraps the browser pipeline as a batch tool for a directory of case or
commentary PDFs:

    cli(indir, outdir) | pdf-inspector | pydantic-agent | tsx-docx(outdir)

Run ``uv run digest-headless --help`` or ``uv run python -m cli --help``.
"""

from .config import (
    API_KEY_ENV,
    DEFAULT_MODEL_SLUG,
    MODEL_SLUG_ENV,
    CredentialStore,
    Credentials,
    CredentialError,
    normalize_model_slug,
)
from .pipeline import (
    PIPELINES,
    CaseOutcome,
    PipelineDefinition,
    PipelineError,
    process_case,
    process_chapter,
    process_pdf,
    resolve_pipeline,
)
from .service_queue import ServiceQueue

__all__ = [
    "API_KEY_ENV",
    "CaseOutcome",
    "CredentialError",
    "CredentialStore",
    "Credentials",
    "DEFAULT_MODEL_SLUG",
    "MODEL_SLUG_ENV",
    "PIPELINES",
    "PipelineDefinition",
    "PipelineError",
    "ServiceQueue",
    "normalize_model_slug",
    "process_case",
    "process_chapter",
    "process_pdf",
    "resolve_pipeline",
]
