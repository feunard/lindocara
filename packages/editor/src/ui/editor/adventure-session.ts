/**
 * Loading an adventure into an editor session: the shared seam the adventure picker and the settings
 * dialog both use so there is one definition of "open this adventure for editing". A session carries
 * the full draft (all owned maps as members) because a map belongs to exactly one adventure (UX wave
 * #5) — membership is implicit, so every owned map is a member. The graph is no longer authored, so
 * the draft models only the shell + members.
 */

import { type DraftMemberInfo, draftFromAdventure } from "@lindocara/client/adventure-draft.js";
import type { MapPayload } from "@lindocara/client/api.js";
import { fetchAdventure, fetchMap } from "@lindocara/client/api.js";
import { t } from "@lindocara/client/i18n.js";
import type { AdventureEditorSession } from "@lindocara/client/store.js";
import { EMPTY_MAP_AUDIO } from "@lindocara/engine/audio-catalog.js";
import { EMPTY_MARKERS } from "@lindocara/engine/map-data.js";
import { entryEvents, exitEvents, monsterEvents } from "@lindocara/engine/map-events.js";
import { defaultMapHeroSettings } from "@lindocara/engine/map-hero-settings.js";
import { DEFAULT_MAP_FIXED_LIGHTING } from "@lindocara/engine/map-lighting.js";
import { DEFAULT_FIRST_MAP_NAME, defaultMapInput } from "@lindocara/engine/map-template.js";
import { encodeTileLayer } from "@lindocara/engine/tile-layer-codec.js";
import { solidMaskFromMapPayload } from "../../game/editor-state.js";

/** One map's draft-facing facts read from a payload already in hand — the same shape `memberInfo`
 *  produces, minus its fetch. A freshly created adventure hands us its default map inline, so
 *  re-requesting it would be a round trip for data we are already holding. */
function memberInfoFromPayload(payload: MapPayload): DraftMemberInfo {
  const entries = entryEvents(payload.events);
  const exits = exitEvents(payload.events);
  const labelsOf = (events: readonly { id: string; name: string }[]) =>
    Object.fromEntries(events.flatMap((event) => (event.name ? [[event.id, event.name]] : [])));
  return {
    mapId: payload.id,
    name: payload.name,
    revision: payload.revision,
    solid: solidMaskFromMapPayload(payload),
    monsterCount: monsterEvents(payload.events).length,
    entryIds: entries.map((event) => event.id),
    exitIds: exits.map((event) => event.id),
    entryLabels: labelsOf(entries),
    exitLabels: labelsOf(exits),
  };
}

/** One map's draft-facing facts, read from its stored payload — its entry/exit EVENT uuids (markers
 *  are dead, UX wave #12; these are descriptive now, not graph-wired), plus a thumbnail mask and the
 *  monster-event count. An event's optional `name` doubles as its display label. */
export async function memberInfo(mapId: string): Promise<DraftMemberInfo> {
  return memberInfoFromPayload(await fetchMap(mapId));
}

/**
 * The blank map a sandbox opens on, as a `MapPayload` the stage can mount directly.
 *
 * Minted from the engine's `defaultMapInput` — the SAME template `MapService.createMap` uses — so
 * an unsaved sandbox is born on exactly the terrain the server would have produced for it. Its id
 * is a local uuid and its `revision` is 0: nothing with this id exists server-side, and the first
 * save mints the real row (and a real id) rather than updating anything.
 */
function sandboxMapPayload(): MapPayload {
  const input = defaultMapInput(DEFAULT_FIRST_MAP_NAME);
  return {
    id: crypto.randomUUID(),
    name: input.name,
    revision: 0,
    tilesetId: input.tilesetId,
    cols: input.cols,
    rows: input.rows,
    layers: input.layers.map(encodeTileLayer),
    elements: [...input.elements],
    spawn: input.spawn,
    markers: input.markers ?? EMPTY_MARKERS,
    audio: input.audio ?? EMPTY_MAP_AUDIO,
    heroSettings: input.heroSettings ?? defaultMapHeroSettings(),
    dayNightCycle: input.dayNightCycle ?? true,
    fixedLighting: input.fixedLighting ?? DEFAULT_MAP_FIXED_LIGHTING,
    events: input.events ?? [],
    // Deliberately null: terrain is compiled by the server on save. The editor stage and the
    // playable preview both compile their own from the authoring document (`compileAuthoredMap`),
    // so an unsaved map needs no stored heightfield to be fully editable and previewable.
    heightfield: null,
  };
}

/**
 * Open a local sandbox: a complete editor session that has written NOTHING — the one definition of
 * "new adventure", used by the entry bootstrap and by File → New adventure so the two cannot drift.
 *
 * Entering the editor used to `POST /api/adventures`, which left one untitled row behind per visit
 * (nothing ever cleaned them up). A sandbox instead lives entirely in memory until the author's
 * first save, which creates the adventure and this map in one request. `adventureId: null` is what
 * every server-backed action tests to know it must ask for that save first; `savedDraft: null` says
 * plainly that no saved state exists to compare against yet.
 */
export function createSandboxSession(): AdventureEditorSession {
  const map = sandboxMapPayload();
  const infos = new Map<string, DraftMemberInfo>([[map.id, memberInfoFromPayload(map)]]);
  const draft = draftFromAdventure(
    { title: t("adventure.default_title"), maxPlayers: 4, mapIds: [map.id] },
    infos,
  );
  return {
    adventureId: null,
    draftId: crypto.randomUUID(),
    draft,
    invalidatedLinks: [],
    savedDraft: null,
    titleUntouched: true,
    sandboxMap: map,
  };
}

/** Fetch an adventure and build the full editor session (draft + saved snapshot) for it. */
export async function loadAdventureSession(id: string): Promise<AdventureEditorSession> {
  const payload = await fetchAdventure(id);
  const loadedInfos = await Promise.all(payload.mapIds.map((mapId) => memberInfo(mapId)));
  const infos = new Map<string, DraftMemberInfo>(loadedInfos.map((info) => [info.mapId, info]));
  const draft = draftFromAdventure(payload, infos);
  return {
    adventureId: id,
    draftId: crypto.randomUUID(),
    draft,
    invalidatedLinks: [],
    savedDraft: JSON.stringify(draft),
  };
}
