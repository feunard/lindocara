/**
 * The pure algorithm behind migration 0021 (UX wave #5: a map belongs to exactly ONE adventure).
 *
 * D1 migrations are SQL-only, so `migrations/0021_foamy_raza.sql` is the code that actually runs;
 * this module is the same algorithm expressed as a pure, deterministic function so the attribution /
 * duplication / orphan-drop rules can be unit-tested without a database. The SQL mirrors it. Where
 * the two can diverge — an adventure that duplicated two or more maps — this planner is the complete
 * reference and the SQL carries a documented POC gap (production has no such data).
 *
 * The rules, from a world where `adventure_map` still holds every (adventure, map) reference:
 * - a map referenced by exactly one adventure is attributed to it;
 * - a map referenced by several is attributed to the primary (lowest adventure id) and DUPLICATED
 *   once per extra adventure — a new map, copies of its elements and events (children travel), and
 *   that adventure's graph rewritten so its old map id points at the copy;
 * - a map referenced by no adventure is dropped.
 */

export interface OwnershipElementRow {
  mapId: string;
  col: number;
  row: number;
  kind: string;
  variant: number;
}

export interface OwnershipEventRow {
  id: string;
  mapId: string;
  col: number;
  row: number;
  name: string;
  ordinal: number;
  /** How many pages hang off this event — carried so a copy that drops them is a visible bug. */
  pageCount: number;
}

export interface OwnershipPlanInput {
  mapIds: readonly string[];
  memberships: readonly { adventureId: string; mapId: string; position: number }[];
  /** adventureId -> its stored graph JSON string. */
  adventureGraphs: ReadonlyMap<string, string>;
  elements: readonly OwnershipElementRow[];
  events: readonly OwnershipEventRow[];
}

export interface DuplicatedMap {
  sourceMapId: string;
  newMapId: string;
  adventureId: string;
  position: number;
  /** Copied onto `newMapId`. */
  elements: readonly OwnershipElementRow[];
  /** Copied onto `newMapId` with a freshly minted id per event; pages travel by count. */
  events: readonly OwnershipEventRow[];
}

export interface OwnershipPlan {
  /** Surviving original rows and the single adventure each is attributed to. */
  attributions: readonly { mapId: string; adventureId: string }[];
  duplicates: readonly DuplicatedMap[];
  /** adventureId -> rewritten graph JSON, for adventures that got a duplicated map. */
  graphRewrites: readonly { adventureId: string; graph: string }[];
  droppedMapIds: readonly string[];
}

/** Every occurrence of `from` replaced with `to` — the same whole-string swap the SQL `REPLACE`
 *  performs over a graph, safe because map ids are unique fixed-length strings. */
function replaceAll(source: string, from: string, to: string): string {
  return source.split(from).join(to);
}

/**
 * Compute the migration plan. `mintId` supplies fresh ids for duplicated maps and their copied
 * events, injected so tests are deterministic; production passes `crypto.randomUUID`.
 */
export function planOwnershipMigration(
  input: OwnershipPlanInput,
  mintId: () => string,
): OwnershipPlan {
  const refsByMap = new Map<string, { adventureId: string; position: number }[]>();
  for (const membership of input.memberships) {
    const list = refsByMap.get(membership.mapId) ?? [];
    list.push({ adventureId: membership.adventureId, position: membership.position });
    refsByMap.set(membership.mapId, list);
  }

  const elementsByMap = new Map<string, OwnershipElementRow[]>();
  for (const element of input.elements) {
    const list = elementsByMap.get(element.mapId) ?? [];
    list.push(element);
    elementsByMap.set(element.mapId, list);
  }
  const eventsByMap = new Map<string, OwnershipEventRow[]>();
  for (const event of input.events) {
    const list = eventsByMap.get(event.mapId) ?? [];
    list.push(event);
    eventsByMap.set(event.mapId, list);
  }

  const attributions: { mapId: string; adventureId: string }[] = [];
  const duplicates: DuplicatedMap[] = [];
  const droppedMapIds: string[] = [];
  // adventureId -> current graph, mutated as each of its duplicated maps is rewritten in turn.
  const rewrittenGraphs = new Map<string, string>();

  for (const mapId of input.mapIds) {
    const refs = refsByMap.get(mapId) ?? [];
    if (refs.length === 0) {
      droppedMapIds.push(mapId);
      continue;
    }
    // The primary is the lowest adventure id, matching the SQL's `min(adventure_id)`.
    const sorted = [...refs].sort((a, b) => (a.adventureId < b.adventureId ? -1 : 1));
    const [primary, ...extras] = sorted;
    if (!primary) continue;
    attributions.push({ mapId, adventureId: primary.adventureId });

    for (const extra of extras) {
      const newMapId = mintId();
      duplicates.push({
        sourceMapId: mapId,
        newMapId,
        adventureId: extra.adventureId,
        position: extra.position,
        elements: (elementsByMap.get(mapId) ?? []).map((element) => ({
          ...element,
          mapId: newMapId,
        })),
        events: (eventsByMap.get(mapId) ?? []).map((event) => ({
          ...event,
          id: mintId(),
          mapId: newMapId,
        })),
      });
      const current =
        rewrittenGraphs.get(extra.adventureId) ??
        input.adventureGraphs.get(extra.adventureId) ??
        "";
      rewrittenGraphs.set(extra.adventureId, replaceAll(current, mapId, newMapId));
    }
  }

  const graphRewrites = [...rewrittenGraphs.entries()].map(([adventureId, graph]) => ({
    adventureId,
    graph,
  }));

  return { attributions, duplicates, graphRewrites, droppedMapIds };
}
