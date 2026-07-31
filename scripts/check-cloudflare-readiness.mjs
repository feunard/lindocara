import { access, readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "apps", "main", "dist");

function invariant(condition, message) {
  if (!condition) throw new Error(`Cloudflare readiness: ${message}`);
}

function sameMembers(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    [...actual].sort().every((value, index) => value === [...expected].sort()[index])
  );
}

async function json(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

const wrangler = await json(join(dist, "wrangler.jsonc"));
const manifest = await json(join(dist, "manifest.json"));

invariant(wrangler.main === "./main.cloudflare.js", "Cloudflare entry point is missing");

const assets = wrangler.assets;
invariant(assets?.directory === "./public", "asset directory must remain ./public");
invariant(assets?.binding === "ASSETS", "ASSETS binding is missing");
invariant(assets?.not_found_handling === "single-page-application", "SPA fallback is missing");
invariant(
  sameMembers(assets?.run_worker_first, ["/api/*", "/ws/*", "/_auth/*", "/oauth/*"]),
  "run_worker_first must preserve API, WebSocket and auth routes",
);

const durableObject = wrangler.durable_objects?.bindings?.find(
  (binding) => binding.name === "ALEPHA_WEBSOCKET",
);
invariant(
  durableObject?.class_name === "AlephaWebSocketDurableObject",
  "Alepha WebSocket Durable Object binding is missing",
);
invariant(
  wrangler.migrations?.some((migration) =>
    migration.new_sqlite_classes?.includes("AlephaWebSocketDurableObject"),
  ),
  "Durable Object SQLite migration is missing",
);

const expectedCrons = ["*/15 * * * *", "0 * * * *"];
invariant(sameMembers(wrangler.triggers?.crons, expectedCrons), "Cloudflare cron triggers drifted");
invariant(sameMembers(manifest.crons, expectedCrons), "manifest cron list drifted");

invariant(manifest.resources?.hasDatabase === true, "Alepha no longer detects the D1");
invariant(manifest.resources?.hasWebSocket === true, "Alepha no longer detects WebSockets");
invariant(manifest.resources?.hasCron === true, "Alepha no longer detects cron jobs");
invariant(
  manifest.environments?.production?.adapter === "cloudflare" &&
    manifest.environments.production.domain === "lindocara.alepha.dev",
  "production Cloudflare domain drifted",
);
invariant(
  sameMembers(manifest.websocketPaths, ["/ws/presence", "/ws/party", "/ws/world"]),
  "room WebSocket paths drifted",
);

for (const name of ["APP_SECRET", "CHEATS_ENABLED", "NAVIGATION_DEBUG", "WEBSOCKET_MAX_PAYLOAD"]) {
  invariant(manifest.env?.includes(name), `${name} is absent from the secret allowlist`);
}

invariant(
  wrangler.routes?.some(
    (route) => route.pattern === "lindocara.alepha.dev" && route.custom_domain === true,
  ),
  "production custom-domain route is missing",
);

await access(join(dist, "public", "assets", "lindocara", "tiny-swords", "catalog.json"));

const migrationsRoot = join(root, "apps", "main", "migrations", "sqlite");
const migrations = await readdir(migrationsRoot, { withFileTypes: true });
const sqlFiles = migrations
  .filter((entry) => entry.isDirectory())
  .map((entry) => join(migrationsRoot, entry.name, "migration.sql"));
invariant(sqlFiles.length > 0, "no Alepha D1 migration is committed");
const migrationSql = (await Promise.all(sqlFiles.map((path) => readFile(path, "utf8")))).join("\n");
invariant(migrationSql.includes("cache_entries"), "D1 auth rate-limit cache table is missing");
invariant(migrationSql.includes("users"), "D1 user table is missing");
invariant(migrationSql.includes("heroes"), "D1 hero table is missing");

const d1 = wrangler.d1_databases?.find((binding) => binding.binding === "DB");
if (d1) {
  invariant(d1.database_id, "prepared D1 binding has no database_id");
  invariant(d1.database_name === "lindocara-main-production", "prepared D1 name drifted");
}

console.log(
  `Cloudflare artifact ready: D1${d1 ? " bound" : " declared"}, ` +
    "rooms, rate-limit storage, routes, assets, crons and secrets verified",
);
