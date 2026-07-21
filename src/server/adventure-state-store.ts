/**
 * `party_adventure_state`, the D1 boundary for a party's switches, variables, self-switches and
 * authored quest progress
 * (`docs/superpowers/specs/2026-07-19-adventure-state-design.md`, Decision 2). This tranche only
 * installs the state: `GameSession` loads it once on first room admission and holds a read-only
 * snapshot for its rooms. The interpreter mutates the held copy through the coordinator; writes
 * here remain whole-state upserts on the save debounce and on party-empty.
 *
 * `loadPartyAdventureState` never throws: a missing row (no party has ever touched state) and a
 * corrupt row (should not happen, since the only writer is `savePartyAdventureState` below, but a
 * hand-edited or foreign row is not impossible) both degrade to `EMPTY_ADVENTURE_STATE`, logging a
 * structured warning on the corrupt path — the same posture `maps.ts`'s `decodeLayers` uses for a
 * corrupt tile-layer column. A hero's connection must never fail because a party's save data got
 * damaged; it should just start from a state with nothing flipped.
 */

import {
  EMPTY_ADVENTURE_STATE,
  type PartyAdventureState,
  parsePartyAdventureState,
} from "@lindocara/engine/adventure-state.js";
import { eq } from "drizzle-orm";
import { type Db, map, mapEvent, party, partyAdventureState } from "./db/index.js";

/**
 * Every event id across every map an adventure owns, for the party addressed by `partyId`. The
 * coordinator supplies this to `savePartyAdventureState` so orphan self-switches (whose owning
 * event was deleted from the adventure) get pruned. Reads happen only at save time — party-empty or
 * the debounce — never per tick. A party with no adventure row (should not happen) yields an empty
 * set, which prunes every self-switch: the fail-closed direction, consistent with an unknown
 * condition id reading as false.
 */
export async function loadAdventureEventIds(db: Db, partyId: string): Promise<ReadonlySet<string>> {
  const partyRow = await db
    .select({ adventureId: party.adventureId })
    .from(party)
    .where(eq(party.id, partyId))
    .get();
  if (!partyRow) return new Set();
  const rows = await db
    .select({ id: mapEvent.id })
    .from(mapEvent)
    .innerJoin(map, eq(map.id, mapEvent.mapId))
    .where(eq(map.adventureId, partyRow.adventureId));
  return new Set(rows.map((entry) => entry.id));
}

function warnCorruptPartyState(partyId: string, reason: string): void {
  console.warn(JSON.stringify({ event: "party_adventure_state_corrupt", partyId, reason }));
}

export async function loadPartyAdventureState(
  db: Db,
  partyId: string,
): Promise<PartyAdventureState> {
  const rows = await db
    .select()
    .from(partyAdventureState)
    .where(eq(partyAdventureState.partyId, partyId))
    .limit(1);
  const row = rows[0];
  if (!row) return EMPTY_ADVENTURE_STATE;

  let raw: unknown;
  try {
    raw = {
      switches: JSON.parse(row.switches),
      variables: JSON.parse(row.variables),
      selfSwitches: JSON.parse(row.selfSwitches),
      quests: JSON.parse(row.quests),
    };
  } catch {
    warnCorruptPartyState(partyId, "invalid_json");
    return EMPTY_ADVENTURE_STATE;
  }

  const state = parsePartyAdventureState(raw);
  if (!state) {
    warnCorruptPartyState(partyId, "malformed_state");
    return EMPTY_ADVENTURE_STATE;
  }
  return state;
}

/** `eventId:letter` split on the last colon — the same shape `adventure-state.ts`'s
 *  `isSelfSwitchKey` checks, kept local here since only the id half (not the letter) matters for
 *  pruning. */
function selfSwitchEventId(key: string): string {
  return key.slice(0, key.lastIndexOf(":"));
}

/**
 * Drops self-switch entries whose event no longer exists on any of the adventure's maps. This is
 * the "the event that owned this flag got deleted" cleanup, not a size limit — `parsePartyAdventureState`'s
 * `MAX_SELF_SWITCH_ENTRIES` is the hard ceiling that applies regardless of pruning. `liveEventIds`
 * is optional and caller-supplied on purpose: this tranche has no owner for "every event id across
 * an adventure's maps" yet (that means loading every member map's events, which only the room
 * coordinator can cheaply do) — Task 3's `GameSession` is that seam. Without it, save is a
 * pass-through upsert.
 */
function pruneOrphanSelfSwitches(
  state: PartyAdventureState,
  liveEventIds: ReadonlySet<string>,
): PartyAdventureState {
  const selfSwitches: Record<string, boolean> = {};
  for (const [key, flag] of Object.entries(state.selfSwitches)) {
    if (liveEventIds.has(selfSwitchEventId(key))) selfSwitches[key] = flag;
  }
  return { ...state, selfSwitches };
}

export async function savePartyAdventureState(
  db: Db,
  partyId: string,
  state: PartyAdventureState,
  liveEventIds?: ReadonlySet<string>,
): Promise<void> {
  const pruned = liveEventIds ? pruneOrphanSelfSwitches(state, liveEventIds) : state;
  const values = {
    partyId,
    switches: JSON.stringify(pruned.switches),
    variables: JSON.stringify(pruned.variables),
    selfSwitches: JSON.stringify(pruned.selfSwitches),
    quests: JSON.stringify(pruned.quests ?? {}),
    updatedAt: new Date(),
  };
  await db
    .insert(partyAdventureState)
    .values(values)
    .onConflictDoUpdate({
      target: partyAdventureState.partyId,
      set: {
        switches: values.switches,
        variables: values.variables,
        selfSwitches: values.selfSwitches,
        quests: values.quests,
        updatedAt: values.updatedAt,
      },
    });
}
