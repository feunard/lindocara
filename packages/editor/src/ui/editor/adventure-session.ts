/**
 * Loading an adventure into an editor session: the shared seam the adventure picker and the settings
 * dialog both use so there is one definition of "open this adventure for editing". A session carries
 * the full draft (all owned maps as members) because a map belongs to exactly one adventure (UX wave
 * #5) — membership is implicit, so every owned map is a member. The graph is no longer authored, so
 * the draft models only the shell + members.
 */

import { type DraftMemberInfo, draftFromAdventure } from "@lindocara/client/adventure-draft.js";
import type { MapPayload } from "@lindocara/client/api.js";
import { createAdventureApi, fetchAdventure, fetchMap } from "@lindocara/client/api.js";
import { t } from "@lindocara/client/i18n.js";
import type { AdventureEditorSession } from "@lindocara/client/store.js";
import { entryEvents, exitEvents, monsterEvents } from "@lindocara/engine/map-events.js";
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
 * Mint a fresh, unsaved adventure and return the editor session for it — the one definition of
 * "new scratch adventure", used by the entry bootstrap and by File → New adventure so the two
 * cannot drift.
 *
 * `POST /api/adventures` is atomic: it creates the adventure AND its first map, and answers with
 * both, so this is a single round trip. `titleUntouched` is what makes it read as unsaved — the
 * first ⌘S opens `FirstSaveDialog` for the real name instead of saving under the default one.
 */
export async function ensureScratchAdventure(): Promise<AdventureEditorSession> {
  const created = await createAdventureApi({
    title: t("adventure.default_title"),
    maxPlayers: 4,
  });
  const infos = new Map<string, DraftMemberInfo>([
    [created.defaultMap.id, memberInfoFromPayload(created.defaultMap)],
  ]);
  const draft = draftFromAdventure(created, infos);
  return {
    adventureId: created.id,
    initialMapId: created.defaultMap.id,
    draftId: crypto.randomUUID(),
    draft,
    invalidatedLinks: [],
    savedDraft: JSON.stringify(draft),
    titleUntouched: true,
  };
}

/** Fetch an adventure and build the full editor session (draft + saved snapshot) for it. */
export async function loadAdventureSession(
  id: string,
  initialMapId?: string,
): Promise<AdventureEditorSession> {
  const payload = await fetchAdventure(id);
  const loadedInfos = await Promise.all(payload.mapIds.map((mapId) => memberInfo(mapId)));
  const infos = new Map<string, DraftMemberInfo>(loadedInfos.map((info) => [info.mapId, info]));
  const draft = draftFromAdventure(payload, infos);
  return {
    adventureId: id,
    ...(initialMapId === undefined ? {} : { initialMapId }),
    draftId: crypto.randomUUID(),
    draft,
    invalidatedLinks: [],
    savedDraft: JSON.stringify(draft),
  };
}
