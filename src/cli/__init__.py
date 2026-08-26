"""Headless case-digest CLI package.

Wraps the browser pipeline as a batch tool for a directory of case PDFs:

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

__all__ = [
    "API_KEY_ENV",
    "CredentialError",
    "CredentialStore",
    "Credentials",
    "DEFAULT_MODEL_SLUG",
    "MODEL_SLUG_ENV",
    "normalize_model_slug",
]
