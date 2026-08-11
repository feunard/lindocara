/**
 * The showcase adventure: `build-showcase-map.ts`'s terrain, on a real map row, playable in the
 * real game client.
 *
 * The twin of `seed-proving-adventure.ts` and deliberately not a refactor of it: these are short
 * dev scripts whose whole value is being readable on their own, and the duplication is the same
 * choice that file already documents. Everything shared — the target gating, the credentials, the
 * HTTP client — lives in `lib/adventure-api.ts` and is imported, not copied.
 *
 * IDEMPOTENT. Re-running reuses the adventure with the same title and re-stamps its default map,
 * which is what you want while iterating on the terrain: regenerate, reload, look. Every re-stamp
 * bumps the map's revision, which is what makes a live session pick the new terrain up.
 *
 * Run (from the repo root, with `npm run dev` already up):
 *   npm run adventure:showcase
 *
 * Against a deployed instance (gated exactly like every other seeding CLI):
 *   SEED_PASSWORD=... npm run adventure:showcase -- \
 *     --target=https://lindocara.bay.alepha.dev --allow-remote=true --allow-production=true
 *
 * Flags:
 *   --target=<url>          the running app; defaults to http://localhost:5273
 *   --title=<text>          adventure title; defaults to "Tiny Swords Tilemap Showcase"
 *   --username=<name>       account to author under; defaults to `showcase-pilot`
 *   --allow-remote=true     required for any non-localhost target
 *   --allow-production=true required on top of that for the production host
 */

import { encodeMap } from "@lindocara/engine/hd2d/map-data.js";
import { buildShowcaseMap, showcaseAscii } from "./build-showcase-map.js";
import {
  type ApiClient,
  argumentsOf,
  ApiClient as Client,
  DEFAULT_LOCAL_TARGET,
  resolveCredentials,
  resolveTarget,
} from "./lib/adventure-api.js";

const DEFAULTS = {
  title: "Tiny Swords Tilemap Showcase",
  username: "showcase-pilot",
  // Alepha's own registration rules reject a password with no uppercase. Local only:
  // `resolveCredentials` refuses to fall back to it against production.
  password: "Showcase-Pilot-2026",
} as const;

/** The adventure and the map row its heightfield lands on. `"mine"`, not the collaborative
 *  listing: the heightfield write is owner fenced, so an adventure this session does not own is not
 *  a candidate for reuse — adopting one would find a map and then be refused 404 on it. */
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

/** 404 here means the session's account does not own that map — the route's owner fence answers a
 *  foreigner exactly as it answers a missing row. */
async function stampHeightfield(client: ApiClient, mapId: string, encoded: string): Promise<void> {
  const result = await client.request(`/api/maps/${mapId}/heightfield`, {
    method: "PUT",
    body: JSON.stringify({ heightfield: encoded }),
  });
  if (!result.response.ok) throw client.failure("heightfield write", result);
}

async function main(): Promise<void> {
  const args = argumentsOf(process.argv.slice(2));
  // Pre-seed rather than re-implement: `resolveTarget` owns the --allow-remote/--allow-production
  // gating, and this only supplies the default it falls back to when no --target is given.
  if (!args.has("target")) args.set("target", DEFAULT_LOCAL_TARGET);
  const target = resolveTarget(args);
  const title = args.get("title") ?? DEFAULTS.title;

  const client = new Client({
    target,
    ...resolveCredentials(args, target, DEFAULTS.username, DEFAULTS.password),
  });
  await client.ensureSession();
  const { adventureId, mapId } = await ensureAdventure(client, title);

  const map = buildShowcaseMap();
  const encoded = encodeMap(map);
  const water = map.levels.filter((level) => level === null).length;
  await stampHeightfield(client, mapId, encoded);

  console.log(showcaseAscii(map));
  console.log(
    `\nStamped ${map.size}x${map.size} heightfield on map ${mapId} — ` +
      `${map.size * map.size - water} ground, ${water} water, ${(map.ramps ?? []).length} ramps.`,
  );
  console.log(`\n  Play it: ${target.origin} → New adventure → "${title}"\n`);
  console.log(`  adventure ${adventureId}\n  map       ${mapId}`);
}

await main();
