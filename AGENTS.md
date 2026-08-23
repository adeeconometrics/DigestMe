# AGENTS.md

## What this is

Browser-only case-digest app ("Digest Me"; package name is legacy `recall-cards`). React 19 + Vite + TypeScript, no backend. All data lives in IndexedDB (db `recall-studio`, stores `decks`/`sessions`/`meta`/`documents`/`documentFiles`) — never add network calls or server-side persistence.

Everything is client-side: `@firecrawl/pdf-inspector-wasm` converts a PDF to markdown, `src/parser/contextTree.ts` maps that onto a typed context tree, and the tree is either visualized with sigma.js (`src/components/DigestGraph.tsx`) or rendered to DOCX via `src/lib/caseDigestDocx.ts` (the `docx` package). CSV parsing is hand-rolled in `src/lib/csv.ts` (strict 2-column format, quoted commas/newlines) — don't pull in a CSV library for small fixes.

## Commands

- `npm run dev` — dev server (served at `/`)
- `npm run build` — `tsc -b && vite build`. **The CI check**: no lint. Run it before finishing any change; CI runs exactly this.
- `npx tsc -b` — fast typecheck-only pass (tsconfig is solution-style with app/node references)
- `npm test` — `vitest run` (node environment, no jsdom)
- `npm run test:watch` — vitest watch mode
- `npm run test:coverage` — vitest + v8 coverage over the pure-logic modules
- `npm run preview` — serve the production build

## Test conventions

- Unit tests live next to the module as `src/**/*.test.ts` and run in the node environment (no jsdom).
- Shared fixtures and builders live in `src/test/factories.ts` — prefer a builder with overrides over full literal objects so cases stay readable and extensible.
- `src/lib/db.test.ts` uses `fake-indexeddb`, shimmed in `test/setup.ts`; keep one database per test file and manage state through the exported API.
- Assert the happy path first, then one focused case per edge.

## Deploy gotchas

- **Every push to `main` deploys to production GitHub Pages** (`.github/workflows/ci.yml` has a deploy job gated on push to main). PRs only get the build check.
- `vite.config.ts` sets `base: "/DigestMe/"` when `GITHUB_ACTIONS=true`, otherwise `/`. Reference assets via Vite imports/relative paths — hardcoded absolute URLs break on Pages.

## Layout

- `src/App.tsx` — shell UI (~1000 lines): sidebar rail, deck library/study views, session state, import flow; the main monolith
- `src/pages/DigestPage.tsx` — case-digest workspace: PDF import → context tree → graph + DOCX export
- `src/lib/db.ts` — IndexedDB wrapper, including one-time starter-deck seeding
- `src/lib/caseDigestDocx.ts` — case-digest JSON validation + DOCX generation (largest logic module)
- `src/lib/csv.ts` — strict 2-column CSV parser/validator
- `src/parser/` — WASM PDF parsing (`pdfParser.ts`), markdown→tree (`contextTree.ts`), shared types
- `src/chat/retrieval.ts` — local term-overlap retrieval scoring for chat
- `src/graph/treeGraph.ts` + `src/components/DigestGraph.tsx` — graphology/sigma visualization
- `src/pdf/reference.ts` — pdf.js page-text indexing for highlight references
- `src/types.ts` — shared domain types
