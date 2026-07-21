/**
 * A client-side adventure under construction, as pure rules — the AdventureEditor screen's
 * counterpart to editor-state.ts. Since the graph teardown, a draft carries only the adventure's
 * shell (title, max players, its switch/variable registry) and the list of its member maps; it no
 * longer models a graph (start, exit bindings, validation). The server remains the storage authority
 * for the stored graph, which the runtime still reads for compat routing — the editor simply never
 * authors it. Convention follows applyTool: a returned null means "refused", an unchanged input is
 * never mutated.
 */
import {
  ADVENTURE_TITLE_MAX,
  type AdventureInput,
  MAX_ADVENTURE_MAPS,
} from "../shared/adventure.js";
import { type AdventureRegistry, EMPTY_REGISTRY } from "../shared/adventure-state.js";

export interface DraftMemberInfo {
  mapId: string;
  name: string;
  revision: number;
  /** Display-only solid mask, one `#`/`.` per cell — the thumbnail, never a save. */
  solid: readonly string[];
  monsterCount: number;
  /** The map's entry/exit-EVENT uuids — descriptive facts read from its stored events. No longer wired
   *  into a graph (authoring is gone); kept so the panel/thumbnail can describe a map's anchors. */
  entryIds: readonly string[];
  exitIds: readonly string[];
  entryLabels: Readonly<Record<string, string>>;
  exitLabels: Readonly<Record<string, string>>;
}

export interface AdventureDraft {
  title: string;
  maxPlayers: number;
  members: DraftMemberInfo[];
  /** The switch/variable registry, authored in `RegistryDialog` and persisted on the adventure PUT. */
  registry: AdventureRegistry;
}

export function emptyDraft(): AdventureDraft {
  return {
    title: "",
    maxPlayers: 4,
    members: [],
    registry: EMPTY_REGISTRY,
  };
}

export function addMember(draft: AdventureDraft, info: DraftMemberInfo): AdventureDraft | null {
  if (draft.members.length >= MAX_ADVENTURE_MAPS) return null;
  if (draft.members.some((member) => member.mapId === info.mapId)) return null;
  return { ...draft, members: [...draft.members, info] };
}

export function removeMember(draft: AdventureDraft, mapId: string): AdventureDraft {
  return { ...draft, members: draft.members.filter((member) => member.mapId !== mapId) };
}

export function moveMember(
  draft: AdventureDraft,
  mapId: string,
  direction: -1 | 1,
): AdventureDraft {
  const index = draft.members.findIndex((member) => member.mapId === mapId);
  const destination = index + direction;
  if (index < 0 || destination < 0 || destination >= draft.members.length) return draft;
  const members = [...draft.members];
  const member = members[index];
  const displaced = members[destination];
  if (!member || !displaced) return draft;
  members[index] = displaced;
  members[destination] = member;
  return { ...draft, members };
}

/** Refresh one edited map's facts in the draft — add it if new, otherwise replace its entry. Purely
 *  the member list now; there is no graph binding to reconcile. */
export function refreshMember(draft: AdventureDraft, info: DraftMemberInfo): AdventureDraft {
  if (!draft.members.some((member) => member.mapId === info.mapId)) {
    return addMember(draft, info) ?? draft;
  }
  return {
    ...draft,
    members: draft.members.map((member) => (member.mapId === info.mapId ? info : member)),
  };
}

/**
 * Whether the draft can be SAVED — title and player count only. This has always been the sole save
 * gate; with the graph gone, there is nothing else to check.
 */
export function draftSaveable(draft: AdventureDraft): boolean {
  const title = draft.title.trim();
  return (
    title.length >= 1 &&
    title.length <= ADVENTURE_TITLE_MAX &&
    Number.isSafeInteger(draft.maxPlayers) &&
    draft.maxPlayers >= 1 &&
    draft.maxPlayers <= 4
  );
}

export function toAdventureInput(draft: AdventureDraft): AdventureInput | null {
  if (!draftSaveable(draft)) return null;
  // No `graph`: the editor never authors one, so the PUT omits it and the server preserves the stored
  // graph. The registry rides along independently.
  return {
    title: draft.title.trim(),
    maxPlayers: draft.maxPlayers,
    registry: draft.registry,
  };
}

export function draftFromAdventure(
  payload: {
    title: string;
    maxPlayers: number;
    mapIds: readonly string[];
    /** Optional so a caller round-tripping through `AdventureInput` (registry optional) still fits;
     *  a payload without one rebuilds an empty registry. */
    registry?: AdventureRegistry;
  },
  infos: ReadonlyMap<string, DraftMemberInfo>,
): AdventureDraft {
  const members = payload.mapIds.flatMap((mapId) => {
    const info = infos.get(mapId);
    return info ? [info] : [];
  });
  return {
    title: payload.title,
    maxPlayers: payload.maxPlayers,
    members,
    registry: payload.registry ?? EMPTY_REGISTRY,
  };
}
