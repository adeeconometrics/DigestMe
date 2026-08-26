"""Headless case-digest CLI package.

Wraps the browser pipeline as a batch tool for a directory of case PDFs:

    cli(indir, outdir) | pdf-inspector | pydantic-agent | tsx-docx(outdir)

Run ``uv run digest-headless --help`` or ``uv run python -m cli --help``.
"""
