/**
 * Loading an adventure into an editor session: the shared seam the adventure picker and the settings
 * dialog both use so there is one definition of "open this adventure for editing". A session carries
 * the full draft (all owned maps as members, the graph as bindings + start) because a map belongs to
 * exactly one adventure (UX wave #5) — membership is implicit, so every owned map is a member.
 */
import { entryEvents, exitEvents, monsterEvents } from "../../../shared/map-events.js";
import { type DraftMemberInfo, draftFromAdventure } from "../../adventure-draft.js";
import { fetchAdventure, fetchMap } from "../../api.js";
import { solidMaskFromMapPayload } from "../../game/editor-state.js";
import type { AdventureEditorSession } from "../../store.js";

/** One map's draft-facing facts, read from its stored payload — the entry/exit EVENTS the graph binds
 *  by uuid (markers are dead, UX wave #12), plus a thumbnail mask and the monster-event count the
 *  settings dialog shows. An event's optional `name` doubles as its display label. */
export async function memberInfo(mapId: string): Promise<DraftMemberInfo> {
  const payload = await fetchMap(mapId);
  const entries = entryEvents(payload.events);
  const exits = exitEvents(payload.events);
  const labelsOf = (events: readonly { id: string; name: string }[]) =>
    Object.fromEntries(events.flatMap((event) => (event.name ? [[event.id, event.name]] : [])));
  return {
    mapId,
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
