# @lindocara/main

The **deployable app**: the boot, the build and the deploy. This is the only workspace that produces
the shipped artifact — one Cloudflare Worker that both runs the server and serves the client bundle.
The repo root holds no deliverable; a second site would be a sibling `apps/<name>`.

## Responsibility

- `index.html` — the Vite entry (its script points at `../../packages/client/src/main.tsx`).
- `vite.config.ts` — the Vite root is this directory. The `cloudflare()` plugin reads
  `../../packages/server/wrangler.jsonc`, runs the Worker + Durable Objects in workerd during dev, and
  emits a deployable `dist/lindocara/{index.js,wrangler.json}` beside the client bundle in `dist/client`.
  The `@` alias + `publicDir` point at `../../packages/client`.
- One `vite build` fuses both halves: `dist/client/` (assets) and `dist/lindocara/` (the Worker).

The Worker's config, secrets and D1 migrations live with the server (`packages/server/wrangler.jsonc`,
`.dev.vars`, `migrations/`) — this app *references* them, exactly as it references the client source.

## Graph

- **Depends on:** `client` (bundled as assets) and `server` (bundled as the Worker) — composed at build.

## Commands

```bash
npm run dev        # (root delegates here) Vite + Worker + Durable Object in workerd
npm run build      # -> apps/main/dist/{client, lindocara}
npm run preview
npm run deploy     # build, then wrangler deploy --config dist/lindocara/wrangler.json
```

Root `dev`/`build`/`preview`/`deploy` delegate to `-w @lindocara/main`; `cf-typegen`/`db:migrate`
delegate to `@lindocara/server` (the Worker's config lives there).

## Rules

- Keep nothing server- or client-*specific* here — only the composition. Worker config, DO bindings,
  D1 and secrets belong to `packages/server`; UI belongs to `client`/`ui`/`editor`.
- CI builds this app and uploads `apps/main/dist`; deploy applies the server's D1 migrations, then
  `wrangler deploy` the built `dist/lindocara/wrangler.json`. Changing the Vite/wrangler wiring is
  deploy-critical — verify `npm run build` emits `dist/lindocara/index.js` and dev reaches `/api/*`.

See the root [`AGENTS.md`](../../AGENTS.md) for the full monorepo layout.
