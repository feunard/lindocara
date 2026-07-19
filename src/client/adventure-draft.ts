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
import { type AdventureRegistry, EMPTY_REGISTRY } from "../shared/adventure-state.js";

export interface DraftMemberInfo {
  mapId: string;
  name: string;
  revision: number;
  /** Display-only solid mask, one `#`/`.` per cell — the thumbnail, never a save. */
  solid: readonly string[];
  monsterCount: number;
  entryIds: readonly string[];
  exitIds: readonly string[];
  entryLabels: Readonly<Record<string, string>>;
  exitLabels: Readonly<Record<string, string>>;
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
  /** The switch/variable registry, authored in `RegistryDialog` and persisted on the adventure
   *  PUT. Never gates graph completeness — it rides the same save but is independent of it. */
  registry: AdventureRegistry;
}

export type AdventureDraftIssue =
  | { code: "missing_start" }
  | { code: "unbound_exit"; mapId: string; exitId: string }
  | { code: "unreachable_end" }
  | { code: "unreachable_map"; mapId: string }
  | { code: "map_without_entry"; mapId: string }
  | { code: "map_without_exit"; mapId: string };

export function emptyDraft(): AdventureDraft {
  return {
    title: "",
    maxPlayers: 4,
    members: [],
    start: null,
    bindings: [],
    registry: EMPTY_REGISTRY,
  };
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

export interface RefreshedMember {
  draft: AdventureDraft;
  invalidated: string[];
}

/** Refresh one edited map without inventing replacements for deleted marker ids. */
export function refreshMember(draft: AdventureDraft, info: DraftMemberInfo): RefreshedMember {
  if (!draft.members.some((member) => member.mapId === info.mapId)) {
    const added = addMember(draft, info);
    return { draft: added ?? draft, invalidated: [] };
  }
  const members = draft.members.map((member) => (member.mapId === info.mapId ? info : member));
  const memberById = new Map(members.map((member) => [member.mapId, member]));
  const invalidated: string[] = [];
  const oldBindings = new Map<string, DraftBinding>(
    draft.bindings.map((binding) => [`${binding.mapId}:${binding.exitId}`, binding] as const),
  );
  const bindings = members.flatMap((member) =>
    member.exitIds.map((exitId) => {
      const key = `${member.mapId}:${exitId}`;
      const prior = oldBindings.get(key);
      let dest = prior?.dest ?? null;
      if (dest !== null && dest !== "end") {
        const target = memberById.get(dest.mapId);
        if (!target?.entryIds.includes(dest.entryId)) {
          invalidated.push(key);
          dest = null;
        }
      }
      return { mapId: member.mapId, exitId, dest };
    }),
  );
  for (const binding of draft.bindings) {
    if (
      binding.mapId === info.mapId &&
      !info.exitIds.includes(binding.exitId) &&
      binding.dest !== null
    ) {
      invalidated.push(`${binding.mapId}:${binding.exitId}`);
    }
  }
  const start =
    draft.start && memberById.get(draft.start.mapId)?.entryIds.includes(draft.start.entryId)
      ? draft.start
      : null;
  if (draft.start && !start) invalidated.push(`start:${draft.start.mapId}:${draft.start.entryId}`);
  return { draft: { ...draft, members, bindings, start }, invalidated };
}

function entryExists(draft: AdventureDraft, mapId: string, entryId: string): boolean {
  const member = draft.members.find((candidate) => candidate.mapId === mapId);
  return member?.entryIds.includes(entryId) ?? false;
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

export function draftValidationIssues(draft: AdventureDraft): AdventureDraftIssue[] {
  const issues: AdventureDraftIssue[] = [];
  if (!draft.start) issues.push({ code: "missing_start" });
  for (const member of draft.members) {
    if (member.entryIds.length === 0)
      issues.push({ code: "map_without_entry", mapId: member.mapId });
    if (member.exitIds.length === 0) issues.push({ code: "map_without_exit", mapId: member.mapId });
  }
  for (const binding of draft.bindings) {
    if (binding.dest === null) {
      issues.push({ code: "unbound_exit", mapId: binding.mapId, exitId: binding.exitId });
    }
  }
  if (draft.start) {
    const reachable = new Set<string>([draft.start.mapId]);
    const pending = [draft.start.mapId];
    while (pending.length > 0) {
      const source = pending.shift();
      if (!source) continue;
      for (const binding of draft.bindings) {
        if (binding.mapId !== source || binding.dest === null || binding.dest === "end") continue;
        if (!reachable.has(binding.dest.mapId)) {
          reachable.add(binding.dest.mapId);
          pending.push(binding.dest.mapId);
        }
      }
    }
    const reachesEnd = draft.bindings.some(
      (binding) => binding.dest === "end" && reachable.has(binding.mapId),
    );
    if (!reachesEnd) issues.push({ code: "unreachable_end" });
    for (const member of draft.members) {
      if (!reachable.has(member.mapId))
        issues.push({ code: "unreachable_map", mapId: member.mapId });
    }
  } else if (draft.members.length > 0) {
    issues.push({ code: "unreachable_end" });
  }
  return issues;
}

export function draftComplete(draft: AdventureDraft): boolean {
  const title = draft.title.trim();
  const blockingIssues = draftValidationIssues(draft).some(
    (issue) => issue.code !== "map_without_entry" && issue.code !== "map_without_exit",
  );
  return (
    title.length >= 1 &&
    title.length <= ADVENTURE_TITLE_MAX &&
    Number.isSafeInteger(draft.maxPlayers) &&
    draft.maxPlayers >= 1 &&
    draft.maxPlayers <= 4 &&
    draft.members.length >= 1 &&
    !blockingIssues
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
    registry: draft.registry,
  };
}

export function draftFromAdventure(
  payload: {
    title: string;
    maxPlayers: number;
    mapIds: readonly string[];
    graph: AdventureGraph;
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
    registry: payload.registry ?? EMPTY_REGISTRY,
  };
}
