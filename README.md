# Digest Me

Digest Me is a browser-only flashcard studio for turning a CSV into randomized study decks.

## Run locally

```bash
npm install
npm run dev
```

Create a production bundle with `npm run build` and preview it with `npm run preview`.

## Headless mode

Batch-digest every PDF in a directory into `.docx` without the browser. The
`digest-headless` CLI runs the same three-stage pipeline as the web workspace:
pdf-inspector converts each PDF to a context tree, a pydantic agent generates
the digest, and a tsx script packs the digest into a Word document. Each PDF
is routed through the agent pipeline named by `--agent` — the case-digest
agent for one case per PDF, or the commentary-digest agent for one commentary
chapter per PDF.

### Install

```bash
npm ci         # provides the tsx stage scripts
uv sync        # installs the digest-engine package and the CLI
```

### Usage

```bash
digest-headless <indir> <outdir> [options]
```

| Option | Description |
| --- | --- |
| `indir` | Directory containing one PDF per case |
| `outdir` | Directory for the generated `.docx` files |
| `--agent ROUTE` | Agent pipeline for each PDF: `case-digest` (default) or `commentary-digest` |
| `--provider PROVIDER` | Model provider: `deepseek` (default) or `openrouter` |
| `--workers N` | Parallel service workers consuming the case queue (default: 8) |
| `--api-key KEY` | Provider API key, overrides stored config |
| `--model SLUG` | Provider model slug (default: `deepseek-v4-flash`) |
| `--keep-intermediates` | Keep per-case markdown/tree/digest files under `<outdir>/work/` |

### Credentials

Credentials resolve by precedence: explicit `--api-key` / `--model` /
`--provider` flag, then the `DIGEST_API_KEY` / `DIGEST_MODEL_SLUG` /
`DIGEST_PROVIDER` environment variables, then the stored config file, then an
interactive prompt on first run. Keys entered at a prompt are saved plaintext
to a user config file with owner-only permissions; batch runs should prefer
the environment variable.

With the default `deepseek` provider the engine talks to DeepSeek's own
platform (`api.deepseek.com`), so the key must be a DeepSeek platform key
(`sk-` prefixed) and the model id a bare name such as `deepseek-v4-flash`.
Legacy `deepseek:` / `deepseek/` prefixes are accepted, but slugs for other
providers are rejected. With `--provider openrouter` the engine talks to
OpenRouter (`openrouter.ai`), so the key must be an OpenRouter key and the
model slug the full `provider/model` id (e.g. `deepseek/deepseek-v4-flash`).

### Output

Each case or chapter produces `<outdir>/<case>.docx` plus a machine-readable
`<outdir>/summary.json` with one entry per case (case name, status, docx path,
elapsed time, error). Failed cases keep their intermediate artifacts under
`<outdir>/work/<case>/` for inspection. Live progress prints `[n/total]`
lines as workers finish, and the exit code is 0 only when every case digests
successfully. Per case, the agent stage is capped at a 10-minute wall-clock
timeout and a 300-request usage budget so one runaway case cannot stall a
worker.

### Example

```bash
export DIGEST_API_KEY=sk-...
digest-headless ~/cases ~/digests --workers 4
```

```text
provider: deepseek  model: deepseek-v4-flash  api-key: ...abcd
digesting 2 case(s) into ~/digests with 4 workers

  [1/2] ok      42.3s  /Users/me/digests/People v. State.docx
  [2/2] ok      38.9s  /Users/me/digests/Doe v. Roe.docx

2/2 cases digested
```

Route the same batch through the commentary-digest agent (one chapter per
PDF) with `--agent commentary-digest`:

```bash
digest-headless ~/chapters ~/chapter-digests --agent commentary-digest
```

```text
provider: deepseek  model: deepseek-v4-flash  api-key: ...abcd
digesting 2 chapter(s) into ~/chapter-digests with 8 workers

  [1/2] ok      61.4s  /Users/me/chapter-digests/Board of Directors.docx
  [2/2] ok      57.8s  /Users/me/chapter-digests/Corporate Powers.docx

2/2 chapters digested
```

To run against OpenRouter instead of the DeepSeek platform, select the
provider and use an OpenRouter model slug:

```bash
export DIGEST_API_KEY=sk-or-...
digest-headless ~/chapters ~/chapter-digests \
  --agent commentary-digest --provider openrouter --model deepseek/deepseek-v4-flash
```

## CSV format

The first row must contain exactly two columns: `Question,Answer`. The Quizlet-style
aliases `Question (Front),Answer (Back)` are also accepted. Values may be quoted when
they contain commas or line breaks.

Digest Me validates every row in the browser. A file with a valid header can still import
the usable rows while listing row-level issues for anything missing or malformed.

Imported decks and study-session records are stored in IndexedDB on the current device.
No file or card data is sent to a server. The Deck library supports creating decks by
importing, reading them for study, renaming them, and deleting them.

## OpenRouter connection

Open `My study space` to choose an OpenRouter model from its public catalog and enter a
personal API key. The selected model is stored locally, but the API key is held in memory
only as plaintext during save or an agent call, then sealed with AES-GCM under a
non-exportable device key in IndexedDB. It is never written to localStorage, URLs, or the
public catalog request. When the case-digest agent is connected, the key and document
context will be sent directly to OpenRouter, so use a revocable key with a spending limit
and do not submit documents that must remain offline.

## Study controls

- Click the card or press `Space` to reveal the answer.
- Press `1` for Again, `2` for Hard, or `3` for Got it.
- Use `Next card` or `ArrowRight` to move forward without rating a card.
- Use Mix cards to randomize the current deck or switch back to original order.
