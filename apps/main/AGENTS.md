# @lindocara/main

The **deployable app**: the boot, the build and the deploy, on the Alepha CLI. This is the only
workspace that produces the shipped artifact — one Node service on Alepha Bay that runs the server,
hosts the realtime rooms and serves the client bundle. The repo root holds no deliverable; a
second site would be a sibling `apps/<name>`.

## Responsibility

- `src/main.ts` — the SERVER entry: composes `LindocaraApi` (from `@lindocara/server`) with the
  client's `AppRouter` `$page` tree. This app is the one workspace that depends on both `client`
  and `server`, and composing them is exactly its job — registering the router is what serves the
  HTML shell (`GET /`). Also seeds the raised body-size cap (see its docblock).
- `src/main.browser.ts` — the BROWSER entry (Alepha's `src/main.browser.ts` convention): runs the
  client's `bootClient()` pre-mount bootstrap (locale, theme, the `#stage` canvas), then boots
  Alepha and mounts `AppRouter`.
- `alepha.config.ts` — the platform declaration (`production` = `lindocara.bay.alepha.dev`, adapter
  `bay`) and the authenticated bay-admin endpoint used by CI.
- `vite.config.ts` — auto-loaded by `alepha dev`/`alepha build`. Alepha owns the server/plugin
  wiring; this file only adds what the framework cannot know: the Tailwind plugin, the client
  `publicDir`, the `@` alias, `fs.allow` for workspace-wide asset globs, and the app's **dedicated
  dev port 5273** (`port` + `strictPort`, so a collision fails loudly instead of drifting onto the
  next free port). All local tooling targets that port; see the root
  [`AGENTS.md`](../../AGENTS.md).
- `migrations/sqlite/` — the generated database migrations (`npm run db:generate` here diffs the
  `$entity` schemas; the Bay app applies packed migrations at boot).
- `index.html` — vestigial: the framework generates its own shell from `main.browser.ts`; this
  file exists only in case a raw Vite root is ever pointed at the app directly.

## Graph

- **Depends on:** `client` (the UI + router) and `server` (the API + rooms) — composed at boot.

## Commands

```bash
npm run dev                 # (root delegates here) alepha dev — Node + SQLite, the whole app, :5273
npm run build               # alepha build; add -- --target bare for the Bay production shape
npm run deploy              # alepha platform up -e production (CI runs this on push to main)
npm run db:generate         # alepha db migrations create
npm run check:migrations    # alepha db migrations check (also inside `npm run v`)
```

## Rules

- Keep nothing server- or client-*specific* here — only the composition, the platform config and
  the migrations. Game/API code belongs to `packages/server`; UI belongs to
  `client`/`ui`/`editor`.
- Deploy is `alepha platform up -e production`: build `--target bare`, pack the service, assets and
  migrations, upload them through bay-admin and push the `$env` secrets from the job env. The Bay
  process applies migrations at boot. CI needs `BAY_API_KEY` and `APP_SECRET`. A green
  `alepha build` alone is not a deploy.
- Changing `alepha.config.ts` or the Vite wiring is deploy-critical — verify
  `npm run build -- --target bare`, then smoke the SPA, `/api/*` and `/ws/*` paths.

See the root [`AGENTS.md`](../../AGENTS.md) for the full monorepo layout.
