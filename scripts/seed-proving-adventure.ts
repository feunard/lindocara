/**
 * One playable heightfield adventure, from nothing, in one command.
 *
 * This is the testing counterpart to `scripts/legacy/` — every adventure parked in there is a tile
 * map, and since S3's first increment a tile map draws NOTHING (the renderer builds its scene from
 * a heightfield). So there was no adventure left that a person could join and actually look at.
 * This script makes one.
 *
 * It does two things the pieces around it could not do alone: `build-proving-map.ts` writes a
 * heightfield but needs a map row to write it onto, and the authoring API creates adventures but
 * cannot reach `MapService.saveHeightfield` (no controller exposes it). So this walks both halves —
 * HTTP for the account and the adventure, the app's own services for the heightfield.
 *
 * IDEMPOTENT. Re-running reuses the adventure with the same title and re-stamps its default map,
 * which is what you want while iterating on the terrain: regenerate, reload, look.
 *
 * A DEV SCRIPT. It lives in the repo's root `scripts/` so `tsconfig.tooling.json` typechecks it,
 * and nothing a package ships may import it.
 *
 * Run (from the repo root, with `npm run dev` already up):
 *   npm run adventure:proving
 *   npm run adventure:proving -- --title="Another Island" --target=http://localhost:5173
 *
 * Flags:
 *   --target=<url>    the running app; defaults to http://localhost:5173
 *   --title=<text>    adventure title; defaults to "HD-2D Proving Ground"
 *   --username=<name> account to author under; defaults to `proving-pilot`
 *   --password=<text> its password; defaults to a fixed dev passphrase
 *   --database=<path> SQLite file to stamp; defaults to the dev database
 *
 * WHY IT IS LOCAL-ONLY: the heightfield step opens the SQLite file directly, so `--target` may
 * point anywhere but `--database` must be a file this process can see. Against a deployed instance
 * the adventure would be created and then left blank — the database lives inside the Bay process.
 * Seeding a remote heightfield needs a controller that does not exist yet; see
 * `scripts/legacy/README.md`.
 */

import { encodeMap } from "@lindocara/engine/hd2d/map-data.js";
import { BODY_PARSER_OPTIONS_SEED } from "@lindocara/server/api/bodySizeCap.js";
import { LindocaraApi } from "@lindocara/server/api/index.js";
import { MapService } from "@lindocara/server/api/services/MapService.js";
import { Alepha } from "alepha";
import { buildProvingMap } from "./build-proving-map.js";

const DEV_DATABASE = new URL("../apps/main/node_modules/.alepha/sqlite.db", import.meta.url)
  .pathname;

const DEFAULTS = {
  target: "http://localhost:5173",
  title: "HD-2D Proving Ground",
  username: "proving-pilot",
  // Alepha's own registration rules reject a password with no uppercase, which is exactly the
  // kind of thing that turns a five-second seed into a ten-minute detour. Kept compliant here.
  password: "Proving-Pilot-2026",
} as const;

function argumentsOf(argv: readonly string[]): Map<string, string> {
  const args = new Map<string, string>();
  for (const raw of argv) {
    if (!raw.startsWith("--")) continue;
    const eq = raw.indexOf("=");
    if (eq === -1) args.set(raw.slice(2), "true");
    else args.set(raw.slice(2, eq), raw.slice(eq + 1));
  }
  return args;
}

interface Session {
  target: URL;
  token: string;
}

async function request(
  session: { target: URL; token: string | null },
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  if (session.token) headers.Authorization = `Bearer ${session.token}`;
  const response = await fetch(new URL(path, session.target), { ...init, headers });
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  return { status: response.status, body };
}

/** Login first, register only if that fails — accounts survive across runs, and the two-phase
 *  registration (intent, then complete) is Alepha's, not this app's. */
async function openSession(target: URL, username: string, password: string): Promise<Session> {
  const anonymous = { target, token: null };
  const credentials = JSON.stringify({ username, password });

  let auth = await request(anonymous, "/_auth/token?provider=credentials", {
    method: "POST",
    body: credentials,
  });
  if (auth.status !== 200) {
    const intent = await request(anonymous, "/api/users/register", {
      method: "POST",
      body: credentials,
    });
    if (intent.status >= 400) {
      throw new Error(`registration refused (${intent.status}): ${JSON.stringify(intent.body)}`);
    }
    const intentId = (intent.body as { intentId?: string } | null)?.intentId;
    if (typeof intentId !== "string") throw new Error("registration intent carried no intentId");
    const completed = await request(anonymous, "/api/users/register/complete", {
      method: "POST",
      body: JSON.stringify({ intentId }),
    });
    if (completed.status >= 400) {
      throw new Error(`registration incomplete (${completed.status})`);
    }
    auth = await request(anonymous, "/_auth/token?provider=credentials", {
      method: "POST",
      body: credentials,
    });
  }

  const token = (auth.body as { access_token?: string } | null)?.access_token;
  if (typeof token !== "string") {
    throw new Error(`authentication failed (${auth.status}) — is ${target.origin} running?`);
  }
  return { target, token };
}

/** The adventure and the map row its heightfield lands on. Reuses an existing adventure with the
 *  same title so re-running only re-stamps the terrain. */
async function ensureAdventure(
  session: Session,
  title: string,
): Promise<{ adventureId: string; mapId: string }> {
  const listed = await request(session, "/api/adventures?scope=all", { method: "GET" });
  const existing = Array.isArray(listed.body)
    ? (listed.body as { id: string; title: string }[]).find((entry) => entry.title === title)
    : undefined;

  if (existing) {
    const maps = await request(session, `/api/maps?adventure=${existing.id}`, { method: "GET" });
    const first = Array.isArray(maps.body) ? (maps.body as { id: string }[])[0] : undefined;
    if (!first) throw new Error(`adventure "${title}" exists but carries no map`);
    console.log(`Reusing adventure ${existing.id} ("${title}")`);
    return { adventureId: existing.id, mapId: first.id };
  }

  const created = await request(session, "/api/adventures", {
    method: "POST",
    body: JSON.stringify({ title, maxPlayers: 4 }),
  });
  if (created.status >= 400) {
    throw new Error(`adventure refused (${created.status}): ${JSON.stringify(created.body)}`);
  }
  const record = created.body as { id: string; defaultMap: { id: string } };
  console.log(`Created adventure ${record.id} ("${title}")`);
  return { adventureId: record.id, mapId: record.defaultMap.id };
}

/** Boots the app to reach `MapService` — the heightfield write has no HTTP surface. Port 0 rather
 *  than the 3000 default so this never collides with a running `npm run dev`. */
async function stampHeightfield(mapId: string, database: string, encoded: string): Promise<void> {
  process.env.NODE_ENV ??= "development";
  process.env.DATABASE_URL = database;
  process.env.SERVER_PORT = "0";
  const alepha = Alepha.create({ ...BODY_PARSER_OPTIONS_SEED }).with(LindocaraApi);
  await alepha.start();
  try {
    await alepha.inject(MapService).saveHeightfield(mapId, encoded);
  } finally {
    await alepha.stop();
  }
}

async function main(): Promise<void> {
  const args = argumentsOf(process.argv.slice(2));
  const target = new URL(args.get("target") ?? DEFAULTS.target);
  const title = args.get("title") ?? DEFAULTS.title;
  const database = args.get("database") ?? DEV_DATABASE;

  const session = await openSession(
    target,
    args.get("username") ?? DEFAULTS.username,
    args.get("password") ?? DEFAULTS.password,
  );
  const { adventureId, mapId } = await ensureAdventure(session, title);

  const map = buildProvingMap();
  const encoded = encodeMap(map);
  const water = map.levels.filter((level) => level === null).length;
  await stampHeightfield(mapId, database, encoded);

  console.log(
    `Stamped ${map.size}x${map.size} heightfield on map ${mapId} — ` +
      `${map.size * map.size - water} ground, ${water} water, ` +
      `${map.elements.length} elements, ${map.events.length} events.`,
  );
  console.log(`\n  Play it: ${target.origin} → New adventure → "${title}"\n`);
  console.log(`  adventure ${adventureId}\n  map       ${mapId}`);
}

await main();
