# @lindocara/catalog

The Tiny Swords **asset source** and its **catalogue pipeline**. Holds the raw art and the codegen
that turns it into typed data the game consumes. Dev-only (no runtime code ships from here), but the
raw art it holds **is** bundled by the renderer at build time.

## Responsibility

- `assets/` — the raw Tiny Swords packs (Free / Update 010 / Enemy), `index.json` (the extracted raw
  index) and `lindocara-asset-catalog.json` (the authored source catalogue). The renderer bundles PNGs
  from here via a Vite glob (`../../catalog/assets/**`); the atlas builder (`build_lindocara_atlas.py`)
  lives here too.
- `src/tiny-swords-catalog-lib.ts` — the pure catalogue model + validation + generators.
  `src/build-tiny-swords-catalog.ts` — writes the generated outputs. `src/check-tiny-swords-catalog.ts`
  — fails if any generated output is stale.
- **Generated outputs land in the consumer packages**, not here: `packages/engine/src/
  tiny-swords-catalog.generated.ts` and `docs/generated/tiny-swords-catalog-coverage.md`.
  `test/catalog.test.ts` validates them. A third output — a compact `catalog.json` served from the
  client's `public/` — was dropped once its only consumer (the `AssetBrowser` debug screen) was
  deleted: it was a 393 KB static asset nothing fetched.

## Graph

- **Depends on:** `engine` (its types); dev tooling (`tsx`, `vitest`).
- **Depended on by:** the renderer bundles its `assets/` (build-time); `engine`/`client` receive its
  generated files (committed, so they have no build-time dependency on this package).

## Commands

```bash
yarn typecheck:catalog          # tsc (Node)
yarn catalog:build              # regenerate the catalogue into engine + client + docs
yarn catalog:check              # fail if any generated output is stale (part of `yarn check`)
yarn workspace @lindocara/catalog run test     # or: yarn test:catalog — Node
```

## Rules

- After changing the source catalogue or the generators, run `yarn catalog:build` and commit the
  regenerated files in `engine`/`client`/`docs` — `catalog:check` (and CI) fails otherwise.
- The generated files are excluded from oxlint and oxfmt alike (`**/generated` in both configs),
  because `catalog:check` compares them byte for byte against a fresh build. Do not hand-edit one,
  and do not take one out of those ignore lists.

See the root [`AGENTS.md`](../../AGENTS.md) for the tileset / catalogued-element model.
