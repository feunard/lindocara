/**
 * One playable heightfield adventure, from nothing, in one command — against a local dev server or
 * against a deployed instance.
 *
 * This is the testing counterpart to `scripts/legacy/` — every adventure parked in there is a tile
 * map, and since S3's first increment a tile map draws NOTHING (the renderer builds its scene from
 * a heightfield). So there was no adventure left that a person could join and actually look at.
 * This script makes one.
 *
 * It walks ONE surface now: HTTP, end to end. The account, the adventure and the terrain all go
 * through the running app — the terrain through `PUT /api/maps/:id/heightfield`, which is owner
 * fenced, so the account that authored the adventure is the account that may stamp its map. The
 * earlier version had to boot a second copy of the app and open the SQLite file itself, because no
 * controller could write a heightfield; that made the whole script local-only, since a deployed
 * instance keeps its database inside the Bay process where no other process can reach it.
 *
 * IDEMPOTENT. Re-running reuses the adventure with the same title and re-stamps its default map,
 * which is what you want while iterating on the terrain: regenerate, reload, look. Every re-stamp
 * bumps the map's revision, which is what makes a live session pick the new terrain up.
 *
 * A DEV SCRIPT. It lives in the repo's root `scripts/` so `tsconfig.tooling.json` typechecks it,
 * and nothing a package ships may import it.
 *
 * Run (from the repo root, with `yarn dev` already up):
 *   yarn adventure:proving
 *   yarn adventure:proving --title="Another Island"
 *
 * Against a deployed instance (gated exactly like every other seeding CLI — see
 * `scripts/lib/adventure-api.ts`):
 *   SEED_PASSWORD=... yarn adventure:proving \
 *     --target=https://lc.alepha.dev --allow-remote=true --allow-production=true
 *
 * Flags:
 *   --target=<url>          the running app; defaults to http://localhost:5273
 *   --title=<text>          adventure title; defaults to "HD-2D Proving Ground"
 *   --username=<name>       account to author under; defaults to `proving-pilot`
 *   --allow-remote=true     required for any non-localhost target
 *   --allow-production=true required on top of that for the production host
 *
 * The password is never a flag and never a file: `SEED_PASSWORD` or the local dev fallback, and
 * against production `SEED_PASSWORD` is mandatory.
 */

import { encodeMap } from "@lindocara/engine/hd2d/map-data.js";

import { buildProvingMap } from "./build-proving-map.js";
import { ApiClient, argumentsOf, resolveCredentials, resolveTarget } from "./lib/adventure-api.js";

const DEFAULTS = {
  /** The app's dedicated dev port, same as `DEFAULT_LOCAL_TARGET` — see `apps/main/vite.config.ts`. */
  target: "http://localhost:5273",
  title: "HD-2D Proving Ground",
  username: "proving-pilot",
  // Alepha's own registration rules reject a password with no uppercase, which is exactly the
  // kind of thing that turns a five-second seed into a ten-minute detour. Kept compliant here.
  // Local only: `resolveCredentials` refuses to fall back to it against production.
  password: "Proving-Pilot-2026",
} as const;

/**
 * The adventure and the map row its heightfield lands on. Reuses an existing adventure with the
 * same title so re-running only re-stamps the terrain.
 *
 * `"mine"`, not the collaborative listing: the heightfield write is owner fenced, so an adventure
 * this session does not own is not a candidate for reuse — adopting one would find a map and then
 * be refused 404 on it, which is exactly what the shared dev database (whose "HD-2D Proving Ground"
 * belongs to an older account) does when this asks for `"all"`.
 */
async function ensureAdventure(
  client: ApiClient,
  title: string,
): Promise<{ adventureId: string; mapId: string }> {
  const existing = await client.findAdventureByTitle(title, "mine");
  if (existing) {
    const maps = await client.request(`/api/maps?adventure=${existing}`, { method: "GET" });
    if (!maps.response.ok || !Array.isArray(maps.body)) throw client.failure("map list", maps);
    const first = (maps.body as { id: string }[])[0];
    if (!first) throw new Error(`adventure "${title}" exists but carries no map`);
    console.log(`Reusing adventure ${existing} ("${title}")`);
    return { adventureId: existing, mapId: first.id };
  }

  const created = await client.request("/api/adventures", {
    method: "POST",
    body: JSON.stringify({ title, maxPlayers: 4 }),
  });
  if (!created.response.ok) throw client.failure("adventure create", created);
  const record = created.body as { id: string; defaultMap: { id: string } };
  console.log(`Created adventure ${record.id} ("${title}")`);
  return { adventureId: record.id, mapId: record.defaultMap.id };
}

/** The heightfield write. 404 here means the session's account does not own that map — the route's
 *  owner fence answers a foreigner exactly as it answers a missing row. */
async function stampHeightfield(client: ApiClient, mapId: string, encoded: string): Promise<void> {
  const result = await client.request(`/api/maps/${mapId}/heightfield`, {
    method: "PUT",
    body: JSON.stringify({ heightfield: encoded }),
  });
  if (!result.response.ok) throw client.failure("heightfield write", result);
}

async function main(): Promise<void> {
  const args = argumentsOf(process.argv.slice(2));
  if (args.has("database")) {
    throw new Error(
      "--database is gone: the heightfield now travels over HTTP to --target, so this script " +
        "never opens a database file. Use scripts/build-proving-map.ts for a direct local write.",
    );
  }
  // Pre-seed rather than re-implement: `resolveTarget` owns the --allow-remote/--allow-production
  // gating, and this only supplies the default it falls back to when no --target is given.
  if (!args.has("target")) args.set("target", DEFAULTS.target);
  const target = resolveTarget(args);
  const title = args.get("title") ?? DEFAULTS.title;

  const client = new ApiClient({
    target,
    ...resolveCredentials(args, target, DEFAULTS.username, DEFAULTS.password),
  });
  await client.ensureSession();
  const { adventureId, mapId } = await ensureAdventure(client, title);

  const map = buildProvingMap();
  const encoded = encodeMap(map);
  const water = map.levels.filter((level) => level === null).length;
  await stampHeightfield(client, mapId, encoded);

  console.log(
    `Stamped ${map.size}x${map.size} heightfield on map ${mapId} — ` +
      `${map.size * map.size - water} ground, ${water} water, ` +
      `${map.elements.length} elements, ${map.events.length} events.`,
  );
  console.log(`\n  Play it: ${target.origin} → New adventure → "${title}"\n`);
  console.log(`  adventure ${adventureId}\n  map       ${mapId}`);
}

await main();
