# Digest Me

Digest Me is a browser-only flashcard studio for turning a CSV into randomized study decks.

## Run locally

```bash
npm install
npm run dev
```

Create a production bundle with `npm run build` and preview it with `npm run preview`.

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
