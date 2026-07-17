/**
 * A client-side adventure under construction, as pure rules — the AdventureEditor screen's
 * counterpart to editor-state.ts. A draft may be incomplete (unbound exits, no start); the server
 * only ever sees a complete AdventureInput, and remains the validation authority. Convention
 * follows applyTool: a returned null means "refused", an unchanged input is never mutated.
 */
import {
  ADVENTURE_TITLE_MAX,
  type AdventureGraph,
  type AdventureInput,
  type ExitDestination,
  MAX_ADVENTURE_MAPS,
} from "../shared/adventure.js";

export interface DraftMemberInfo {
  mapId: string;
  name: string;
  entryIds: readonly string[];
  exitIds: readonly string[];
}

export interface DraftBinding {
  mapId: string;
  exitId: string;
  dest: ExitDestination | null;
}

export interface AdventureDraft {
  title: string;
  maxPlayers: number;
  members: DraftMemberInfo[];
  start: { mapId: string; entryId: string } | null;
  bindings: DraftBinding[];
}

export function emptyDraft(): AdventureDraft {
  return { title: "", maxPlayers: 4, members: [], start: null, bindings: [] };
}

export function addMember(draft: AdventureDraft, info: DraftMemberInfo): AdventureDraft | null {
  if (draft.members.length >= MAX_ADVENTURE_MAPS) return null;
  if (draft.members.some((member) => member.mapId === info.mapId)) return null;
  const added: DraftBinding[] = info.exitIds.map((exitId) => ({
    mapId: info.mapId,
    exitId,
    dest: null,
  }));
  return { ...draft, members: [...draft.members, info], bindings: [...draft.bindings, ...added] };
}

export function removeMember(draft: AdventureDraft, mapId: string): AdventureDraft {
  const members = draft.members.filter((member) => member.mapId !== mapId);
  const bindings = draft.bindings
    .filter((binding) => binding.mapId !== mapId)
    .map((binding) =>
      binding.dest !== null && binding.dest !== "end" && binding.dest.mapId === mapId
        ? { ...binding, dest: null }
        : binding,
    );
  const start = draft.start?.mapId === mapId ? null : draft.start;
  return { ...draft, members, bindings, start };
}

function entryExists(draft: AdventureDraft, mapId: string, entryId: string): boolean {
  const member = draft.members.find((candidate) => candidate.mapId === mapId);
  return member !== undefined && member.entryIds.includes(entryId);
}

export function setStart(
  draft: AdventureDraft,
  mapId: string,
  entryId: string,
): AdventureDraft | null {
  if (!entryExists(draft, mapId, entryId)) return null;
  return { ...draft, start: { mapId, entryId } };
}

export function bindExit(
  draft: AdventureDraft,
  mapId: string,
  exitId: string,
  dest: ExitDestination | null,
): AdventureDraft | null {
  if (!draft.bindings.some((binding) => binding.mapId === mapId && binding.exitId === exitId))
    return null;
  if (dest !== null && dest !== "end" && !entryExists(draft, dest.mapId, dest.entryId)) return null;
  const bindings = draft.bindings.map((binding) =>
    binding.mapId === mapId && binding.exitId === exitId ? { ...binding, dest } : binding,
  );
  return { ...draft, bindings };
}

export function draftComplete(draft: AdventureDraft): boolean {
  const title = draft.title.trim();
  return (
    title.length >= 1 &&
    title.length <= ADVENTURE_TITLE_MAX &&
    Number.isSafeInteger(draft.maxPlayers) &&
    draft.maxPlayers >= 1 &&
    draft.maxPlayers <= 4 &&
    draft.members.length >= 1 &&
    draft.start !== null &&
    draft.bindings.every((binding) => binding.dest !== null) &&
    draft.bindings.some((binding) => binding.dest === "end")
  );
}

export function toAdventureInput(draft: AdventureDraft): AdventureInput | null {
  if (!draftComplete(draft) || draft.start === null) return null;
  const links = draft.bindings.flatMap((binding) =>
    binding.dest === null
      ? []
      : [{ mapId: binding.mapId, exitId: binding.exitId, dest: binding.dest }],
  );
  return {
    title: draft.title.trim(),
    maxPlayers: draft.maxPlayers,
    mapIds: draft.members.map((member) => member.mapId),
    graph: { start: draft.start, links },
  };
}

export function draftFromAdventure(
  payload: { title: string; maxPlayers: number; mapIds: readonly string[]; graph: AdventureGraph },
  infos: ReadonlyMap<string, DraftMemberInfo>,
): AdventureDraft {
  const members = payload.mapIds.flatMap((mapId) => {
    const info = infos.get(mapId);
    return info ? [info] : [];
  });
  const links = new Map(
    payload.graph.links.map((link) => [`${link.mapId} ${link.exitId}`, link.dest] as const),
  );
  const bindings = members.flatMap((member) =>
    member.exitIds.map((exitId) => ({
      mapId: member.mapId,
      exitId,
      dest: links.get(`${member.mapId} ${exitId}`) ?? null,
    })),
  );
  return {
    title: payload.title,
    maxPlayers: payload.maxPlayers,
    members,
    start: payload.graph.start,
    bindings,
  };
}
