# @lindocara/testing

Shared **test fixtures**, dev-only. It exists so fixtures used by more than one package's tests live
in one place instead of being duplicated or reached for across package boundaries.

## Responsibility

- `src/map-fixtures.ts` — `mapDataFromBlocks` and friends: build `MapData` from the old block model
  for tests (used by engine, server, renderer and editor tests).
- `src/tiles.ts` — tile/collider fixtures (`tileMapFromRects`, …) for engine + server tests.
- `src/jsdom-setup.ts` — the jsdom setup (testing-library matchers, a `ResizeObserver` stub, per-test
  cleanup). Referenced as `setupFiles` by the renderer/client/editor `vitest.config.ts`.

Single-package helpers do **not** live here — they sit with their package's tests (e.g. the server's
`world-harness.ts`/`adventure-fixtures.ts`, the renderer's `editor-asset-art-stub.ts`).

## Graph

- **Depends on:** `engine` (fixtures build engine types); dev-only `@testing-library/react`, `vitest`.
- **Depended on by:** the tests of `engine`, `server`, `renderer`, `client`, `editor`
  (`import "@lindocara/testing/map-fixtures.js"` etc.).

## Commands

```bash
npm run typecheck:testing   # tsc (no tests of its own — it *is* test support)
```

## Rules

- Keep a fixture here only when **more than one** package's tests use it; otherwise co-locate it with
  the one package that does.
- Fixtures are data + pure builders — no network, no DOM beyond the jsdom setup, no product logic.

See the root [`AGENTS.md`](../../AGENTS.md) for the per-package test layout.
