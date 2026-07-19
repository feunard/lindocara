/**
 * Loading an adventure into an editor session: the shared seam the adventure picker and the settings
 * dialog both use so there is one definition of "open this adventure for editing". A session carries
 * the full draft (all owned maps as members, the graph as bindings + start) because a map belongs to
 * exactly one adventure (UX wave #5) — membership is implicit, so every owned map is a member.
 */
import { type DraftMemberInfo, draftFromAdventure } from "../../adventure-draft.js";
import { fetchAdventure, fetchMap } from "../../api.js";
import { solidMaskFromMapPayload } from "../../game/editor-state.js";
import type { AdventureEditorSession } from "../../store.js";

/** One map's draft-facing facts, read from its stored payload — the markers the graph binds against
 *  plus a thumbnail mask and the monster count the settings dialog shows. */
export async function memberInfo(mapId: string): Promise<DraftMemberInfo> {
  const payload = await fetchMap(mapId);
  return {
    mapId,
    name: payload.name,
    revision: payload.revision,
    solid: solidMaskFromMapPayload(payload),
    monsterCount: payload.markers.monsterSpawns.length,
    entryIds: payload.markers.entries.map((marker) => marker.id),
    exitIds: payload.markers.exits.map((marker) => marker.id),
    entryLabels: Object.fromEntries(
      payload.markers.entries.flatMap((marker) =>
        marker.label ? [[marker.id, marker.label] as const] : [],
      ),
    ),
    exitLabels: Object.fromEntries(
      payload.markers.exits.flatMap((marker) =>
        marker.label ? [[marker.id, marker.label] as const] : [],
      ),
    ),
  };
}

/** Fetch an adventure and build the full editor session (draft + saved snapshot) for it. */
export async function loadAdventureSession(id: string): Promise<AdventureEditorSession> {
  const payload = await fetchAdventure(id);
  const infos = new Map<string, DraftMemberInfo>();
  for (const mapId of payload.mapIds) infos.set(mapId, await memberInfo(mapId));
  const draft = draftFromAdventure(payload, infos);
  return {
    adventureId: id,
    draftId: crypto.randomUUID(),
    draft,
    invalidatedLinks: [],
    savedDraft: JSON.stringify(draft),
  };
}
