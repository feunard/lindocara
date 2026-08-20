import { AlephaSigil } from "@alepha/sigil";
import { BODY_PARSER_OPTIONS_SEED } from "@lindocara/server/api/bodySizeCap.js";
import { LindocaraApi } from "@lindocara/server/api/index.js";
import { Alepha, run } from "alepha";

// Raises Alepha's global body-size ceiling (default 100_000 bytes) to the 4 MiB this app needs
// for a map save — see `bodySizeCap.ts`'s docblock for why this seed exists and why it alone is
// not enough (the narrower per-route caps are enforced in each controller). The equivalent
// WebSocket transport cap (`websocketTransportCap.ts`) is no longer a pre-boot seed here: it
// reads `WEBSOCKET_MAX_PAYLOAD` through `$env` from `WebSocketTransportCapProvider`, registered
// in `LindocaraApi.services`, so it participates in the `$env` allowlist `alepha platform up`
// pushes as Cloudflare secrets — a bare `Alepha.create()` seed cannot.
//
// `{ ...BODY_PARSER_OPTIONS_SEED }`, not the shared constant itself: `Alepha.create(state)`
// stores `state` BY REFERENCE as its whole app store (see `test-api/helpers.ts`'s
// `createTestApp` for the full explanation, where reusing the bare constant across many Alepha
// instances is an actual cross-test leak). One process only ever calls this once, so it is
// harmless here today, but a shallow copy costs nothing and keeps this call site correct if that
// ever changes.
// `AppRouter` (from `@lindocara/client`, which `@lindocara/server` deliberately does not depend
// on) is registered here rather than inside `LindocaraApi` — this app is the one workspace that
// depends on both `client` and `server`, and composing them is exactly its job (see its own
// AGENTS.md). Registering the `$page` tree is what makes it also serve the shell: with the old
// `SpaController` deleted, nothing else answers `GET /`.
const alepha = Alepha.create({ ...BODY_PARSER_OPTIONS_SEED }).with(LindocaraApi);

// Reports errors — and, were they switched on, page views and web vitals — to the sigil sink.
// Without `SIGIL_KEY` the module still captures and sends nothing; errors go to the logger
// instead, so it is safe to register unconditionally, including in development and in tests.
//
// The key is the whole configuration: it names the project too, being shaped
// `sg_lindocara_<secret>`, so there is no second variable to keep in agreement with it. What the
// app collects is `SIGIL_CONFIG`, which is optional and only ever turns things off — sigil used
// to ask the sink for that at render time, and reads the environment now, so what production
// reports is a line in `.github/workflows/deploy.yml` rather than a state held on the other side
// of a network call. A key on its own is a fully enrolled app, not a half-configured one.
alepha.with(AlephaSigil);

// Drizzle executes this entry under plain Node to discover server entities. Importing the browser
// router in that process also imports Vite-only `import.meta.glob` asset modules, which plain Node
// cannot evaluate. The generated schema command sets this flag; every real app boot still composes
// the router and therefore serves the SPA shell and page routes.
const schemaImport = typeof process !== "undefined" && process.env.ALEPHA_CLI_IMPORT === "true";
if (!schemaImport) {
  // The build analyzer must observe the fully composed container before this module finishes.
  // Leaving this import as a detached promise lets analysis complete against the server-only
  // container, which makes Alepha skip the entire browser/public-assets build.
  const { AppRouter } = await import("@lindocara/client/ui/AppRouter.js");
  run(alepha.with(AppRouter));
} else {
  run(alepha);
}
