/**
 * The runtime seam of adventure state (tranche 4, Task 3): the `GameSession` coordinator loads a
 * party's switches/variables/self-switches, holds the single copy, and pushes a read-only snapshot
 * to every `World` room; each room selects the active page of its authored events against that
 * snapshot on install and on hero join — never per tick — and saves on party-empty with the
 * orphan-self-switch prune.
 *
 * Everything here drives the REAL Durable Objects through the harness, exactly like the hero-world
 * suite: heroes are admitted through `/api/ws`, and state is observed through `roomDiagnostics()`
 * and asserted in D1. The only non-client poke is `applyStateChangeForTest`, the coordinator's test
 * seam standing in for tranche 5's interpreter.
 */
import { env, runDurableObjectAlarm } from "cloudflare:test";
import {
  type AdventureRegistry,
  createAuthoredQuestDefinition,
  createManualQuestObjective,
  type PartyAdventureState,
} from "@lindocara/engine/adventure-state.js";
import { ATTACK_COOLDOWN_MS } from "@lindocara/engine/game.js";
import type { MapEvent, MapEventPage } from "@lindocara/engine/map-events.js";
import type { QuestBusinessEvent } from "@lindocara/engine/quest-runtime.js";
import { afterEach, describe, expect, it } from "vitest";
import {
  Client,
  drainHeroRooms,
  type TestMapBody,
  type TestParty,
  testHero,
  testMapInput,
  testParty,
  tileCentre,
  until,
} from "./world-harness.js";

/** Page 1 shows when nothing holds; page 2 is gated on switch 0001 and shows a different graphic,
 *  so which page is active is legible from the appearance alone. */
const PAGE1_GRAPHIC = "building.buildings-black-buildings.archery";
const PAGE2_GRAPHIC = "resource.terrain-resources-wood-trees.tree3";
const EVENT_COL = 5;
const EVENT_ROW = 5;

function page(overrides: Partial<MapEventPage> = {}): MapEventPage {
  return {
    condSwitchId: null,
    condVariableId: null,
    condVariableMin: null,
    condSelfSwitch: null,
    graphicAssetId: null,
    moveType: "fixed",
    moveSpeed: 3,
    moveFreq: 2,
    optMoveAnim: false,
    optStopAnim: false,
    optDirFix: false,
    optThrough: false,
    optOnTop: false,
    trigger: "action",
    commands: [],
    ...overrides,
  };
}

/** One event, two pages: the higher page (index 1) wins once switch 0001 holds. */
function twoPageEvent(id: string): MapEvent {
  return {
    id,
    col: EVENT_COL,
    row: EVENT_ROW,
    name: "Gate",
    ordinal: 0,
    kind: "normal",
    species: null,
    patrolRadius: null,
    pages: [
      page({ graphicAssetId: PAGE1_GRAPHIC }),
      page({ graphicAssetId: PAGE2_GRAPHIC, condSwitchId: "0001" }),
    ],
  };
}

/** A single-page event gated on switch 0002: present while 0002 holds, dormant (and removed off the
 *  wire) the moment it stops. Its one page is a "page-1 event" — the stale-removal mutation proof. */
function vanishEvent(id: string): MapEvent {
  return {
    id,
    col: EVENT_COL + 1,
    row: EVENT_ROW,
    name: "Vanish",
    ordinal: 1,
    kind: "normal",
    species: null,
    patrolRadius: null,
    pages: [page({ graphicAssetId: PAGE1_GRAPHIC, condSwitchId: "0002" })],
  };
}

interface StateFixture {
  party: TestParty;
  mapA: string;
  mapB: string;
  roomKeyA: string;
  roomKeyB: string;
  eventIdA: string;
  eventIdB: string;
}

/** A two-map adventure, each map carrying its own two-page event, and one party over it. */
async function seedFixture(label: string): Promise<StateFixture> {
  const eventIdA = crypto.randomUUID();
  const eventIdB = crypto.randomUUID();
  const maps: TestMapBody[] = [
    testMapInput(`${label} ground A`, { events: [twoPageEvent(eventIdA)] }),
    testMapInput(`${label} ground B`, { events: [twoPageEvent(eventIdB)] }),
  ];
  const party = await testParty(label, { maps });
  const [mapA, mapB] = party.mapIds;
  if (!mapA || !mapB) throw new Error("expected two seeded maps");
  return {
    party,
    mapA,
    mapB,
    roomKeyA: `${party.partyId}:${mapA}`,
    roomKeyB: `${party.partyId}:${mapB}`,
    eventIdA,
    eventIdB,
  };
}

async function seedPersistedState(partyId: string, state: PartyAdventureState): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO party_adventure_state (party_id, switches, variables, self_switches) VALUES (?, ?, ?, ?)",
  )
    .bind(
      partyId,
      JSON.stringify(state.switches),
      JSON.stringify(state.variables),
      JSON.stringify(state.selfSwitches),
    )
    .run();
}

async function readPersistedState(partyId: string): Promise<PartyAdventureState | null> {
  const row = await env.DB.prepare(
    "SELECT switches, variables, self_switches FROM party_adventure_state WHERE party_id = ?",
  )
    .bind(partyId)
    .first<{ switches: string; variables: string; self_switches: string }>();
  if (!row) return null;
  return {
    switches: JSON.parse(row.switches),
    variables: JSON.parse(row.variables),
    selfSwitches: JSON.parse(row.self_switches),
  };
}

async function seedAdventureRegistry(
  adventureId: string,
  registry: AdventureRegistry,
): Promise<void> {
  await env.DB.prepare("UPDATE adventure SET registry = ? WHERE id = ?")
    .bind(JSON.stringify(registry), adventureId)
    .run();
}

afterEach(async () => {
  await drainHeroRooms();
  await env.DB.exec("DELETE FROM party_adventure_state");
  await env.DB.exec("DELETE FROM hero");
  await env.DB.exec("DELETE FROM party_member");
  await env.DB.exec("DELETE FROM party");
  await env.DB.exec("DELETE FROM adventure");
  await env.DB.exec("DELETE FROM map_event_page");
  await env.DB.exec("DELETE FROM map_event");
  await env.DB.exec("DELETE FROM map_element");
  await env.DB.exec("DELETE FROM map");
  await env.DB.exec("DELETE FROM account");
}, 20_000);

describe("adventure state runtime", { timeout: 20_000 }, () => {
  it("runs a monster defeat hook and pushes the authored quest tracker to the hero", async () => {
    const monsterEventId = crypto.randomUUID();
    const monster: MapEvent = {
      id: monsterEventId,
      col: 10,
      row: 8,
      name: "Quest wolf",
      ordinal: 3,
      kind: "monster",
      species: "torch_goblin",
      patrolRadius: 32,
      pages: [
        page({
          commands: [{ t: "advanceQuest", questId: "0001", objectiveId: "0001", amount: 1 }],
        }),
      ],
    };
    const party = await testParty("monster-quest", {
      maps: [
        testMapInput("Quest hunt", {
          cols: 24,
          rows: 15,
          spawn: { col: 2, row: 2 },
          exit: { col: 22, row: 13 },
          events: [monster],
        }),
      ],
    });
    await seedAdventureRegistry(party.adventureId, {
      switches: [],
      variables: [],
      quests: [
        {
          ...createAuthoredQuestDefinition("0001", "Clear the old road"),
          description: "Defeat the prowling beast.",
          objectives: [createManualQuestObjective("0001", "Defeat the beast")],
        },
      ],
    });

    const hero = await testHero("Hunter", {
      party,
      account: party.host,
      class: "warrior",
      level: 10,
      position: tileCentre(10, 8),
    });
    const client = await Client.joinHero(hero);
    await until("quest hunter welcomed", () => client.welcome);

    const coordinator = env.GAME_SESSION.getByName(party.partyId);
    await coordinator.applyStateChanges(party.partyId, [{ type: "startQuest", questId: "0001" }]);
    await until("authored quest started", () =>
      client.received.find(
        (message) => message.t === "state" && message.self.authoredQuests?.[0]?.status === "active",
      ),
    );

    let lastAttackAt = 0;
    await until("quest monster defeated", () => {
      if (Date.now() - lastAttackAt >= ATTACK_COOLDOWN_MS) {
        lastAttackAt = Date.now();
        client.action("attack");
      }
      return client.received.find(
        (message) => message.t === "event" && message.code === "monster.defeated",
      );
    });

    const progressed = await until("monster objective advanced", () =>
      client.received.find(
        (message) =>
          message.t === "state" && message.self.authoredQuests?.[0]?.objectives[0]?.progress === 1,
      ),
    );
    expect(progressed).toMatchObject({
      t: "state",
      self: {
        authoredQuests: [
          {
            id: "0001",
            title: "Clear the old road",
            status: "ready",
            objectives: [{ id: "0001", progress: 1, target: 1 }],
          },
        ],
      },
    });

    // A shaped but unregistered id cannot inflate or corrupt the party's durable quest state.
    await coordinator.applyStateChanges(party.partyId, [{ type: "startQuest", questId: "9999" }]);
    const held = await coordinator.getAdventureState(party.partyId);
    expect(held.state.quests?.["9999"]).toBeUndefined();

    client.close();
    await drainHeroRooms();
    // Wait for the coordinator's normal party-empty persistence boundary before fixture teardown;
    // otherwise its debounced alarm can race the next test's D1 cleanup.
    await coordinator.roomEmptied(party.partyId, hero.roomKey);
  });

  it("advances a structured kill objective from combat without an advanceQuest command", async () => {
    const monsterEventId = crypto.randomUUID();
    const monster: MapEvent = {
      id: monsterEventId,
      col: 10,
      row: 8,
      name: "Spear goblin",
      ordinal: 0,
      kind: "monster",
      species: "spear_goblin",
      patrolRadius: 32,
      pages: [page({ commands: [] })],
    };
    const party = await testParty("automatic-monster-quest", {
      maps: [
        testMapInput("Automatic hunt", {
          cols: 24,
          rows: 15,
          spawn: { col: 2, row: 2 },
          exit: { col: 22, row: 13 },
          events: [monster],
        }),
      ],
    });
    await seedAdventureRegistry(party.adventureId, {
      switches: [],
      variables: [],
      quests: [
        {
          ...createAuthoredQuestDefinition("0001", "Chasser les gobelins à lance"),
          objectives: [
            {
              id: "0001",
              type: "kill",
              label: "",
              target: 1,
              optional: false,
              hidden: false,
              stage: 0,
              species: "spear_goblin",
              mapScope: { kind: "any" },
              credit: "contributors",
            },
          ],
        },
      ],
    });
    const hero = await testHero("AutoHunter", {
      party,
      account: party.host,
      class: "warrior",
      level: 10,
      position: tileCentre(10, 8),
    });
    const client = await Client.joinHero(hero);
    await until("automatic hunter welcomed", () => client.welcome);
    const coordinator = env.GAME_SESSION.getByName(party.partyId);
    await coordinator.applyStateChanges(party.partyId, [{ type: "startQuest", questId: "0001" }]);

    let lastAttackAt = 0;
    await until("structured target defeated", () => {
      if (Date.now() - lastAttackAt >= ATTACK_COOLDOWN_MS) {
        lastAttackAt = Date.now();
        client.action("attack");
      }
      return client.received.find(
        (message) => message.t === "event" && message.code === "monster.defeated",
      );
    });

    const progressed = await until("structured kill credited", () =>
      client.received.find(
        (message) =>
          message.t === "state" && message.self.authoredQuests?.[0]?.objectives[0]?.progress === 1,
      ),
    );
    expect(progressed).toMatchObject({
      t: "state",
      self: {
        authoredQuests: [
          {
            id: "0001",
            status: "ready",
            objectives: [{ id: "0001", progress: 1, target: 1 }],
          },
        ],
      },
    });
    const held = await coordinator.getAdventureState(party.partyId);
    expect(held.state.quests?.["0001"]?.processedEventKeys).toHaveLength(1);
  });

  it("accepts at a bound giver and turns in one atomic reward exactly once", async () => {
    const npcId = crypto.randomUUID();
    const npc: MapEvent = {
      id: npcId,
      col: 5,
      row: 5,
      name: "Warden Mira",
      ordinal: 0,
      kind: "normal",
      species: null,
      patrolRadius: null,
      pages: [
        page({
          graphicAssetId: "character.units-blue-units-pawn.pawn-idle",
          commands: [],
        }),
      ],
    };
    const party = await testParty("bound-quest-lifecycle", {
      maps: [testMapInput("Bound quest", { events: [npc] })],
    });
    await seedAdventureRegistry(party.adventureId, {
      switches: [{ id: "0001", name: "Mira helped" }],
      variables: [],
      quests: [
        {
          ...createAuthoredQuestDefinition("0001", "Mira's request"),
          giver: { mapId: party.startMapId, eventId: npcId },
          turnInTarget: { mapId: party.startMapId, eventId: npcId },
          objectives: [
            {
              id: "0001",
              type: "deliver",
              label: "Bring one healing potion",
              target: 1,
              optional: false,
              hidden: false,
              stage: 0,
              itemId: "health_potion",
              consume: true,
            },
          ],
          dialogues: {
            offer: "Can you secure the road?",
            accepted: "Return when it is safe.",
            refused: "Another time, then.",
            reminder: "The road is still unsafe.",
            ready: "You have done it.",
            turnIn: "The village is in your debt.",
            completed: "We remember your help.",
            unavailable: "",
          },
          rewards: {
            experience: 60,
            gold: 7,
            items: [{ itemId: "mana_potion", quantity: 2 }],
            choices: [
              {
                id: "0001",
                label: "Healing potion",
                experience: 0,
                gold: 0,
                items: [{ itemId: "health_potion", quantity: 1 }],
              },
            ],
            nextQuestId: null,
            stateChanges: [{ type: "switch", switchId: "0001", value: true }],
            customCommands: [],
          },
        },
      ],
    });
    const hero = await testHero("QuestTurnIn", {
      party,
      account: party.host,
      position: tileCentre(5, 5),
    });
    const client = await Client.joinHero(hero);
    const welcome = await until("bound quest welcome", () => client.welcome);
    expect(welcome?.self.authoredQuestMarkers).toEqual([{ eventId: npcId, kind: "available" }]);

    client.action("interact");
    const offer = await until("quest offer opened", () =>
      client.received.find(
        (message) => message.t === "quest.open" && message.entries[0]?.phase === "offer",
      ),
    );
    if (offer?.t !== "quest.open") throw new Error("missing quest offer");
    client.sendRaw(
      JSON.stringify({
        t: "quest.action",
        conversationId: offer.conversationId,
        questId: "0001",
        action: "accept",
      }),
    );
    await until("quest accepted", () =>
      client.received.find(
        (message) => message.t === "quest.result" && message.outcome === "accepted",
      ),
    );
    const coordinator = env.GAME_SESSION.getByName(party.partyId);
    await until("quest ready marker", () =>
      client.received.find(
        (message) =>
          message.t === "state" && message.self.authoredQuestMarkers?.[0]?.kind === "ready",
      ),
    );

    client.sendRaw(JSON.stringify({ t: "quest.abandon", questId: "0001" }));
    await until("quest abandoned from journal", () =>
      [...client.received]
        .reverse()
        .find(
          (message) =>
            message.t === "state" && message.self.authoredQuests?.[0]?.status === "abandoned",
        ),
    );
    expect((await coordinator.getAdventureState(party.partyId)).state).toMatchObject({
      quests: { "0001": { status: "abandoned", rewardClaimed: false } },
    });
    client.sendRaw(JSON.stringify({ t: "quest.abandon", questId: "0001" }));
    await until("repeated abandonment rejected", () =>
      client.received.find(
        (message) => message.t === "event" && message.code === "authored_quest.action_failed",
      ),
    );

    client.action("interact");
    const repeatedOffer = await until("abandoned quest offered again", () =>
      [...client.received]
        .reverse()
        .find(
          (message) =>
            message.t === "quest.open" &&
            message.conversationId !== offer.conversationId &&
            message.entries[0]?.phase === "offer" &&
            message.entries[0]?.canAccept,
        ),
    );
    if (repeatedOffer?.t !== "quest.open") throw new Error("missing repeated quest offer");
    client.sendRaw(
      JSON.stringify({
        t: "quest.action",
        conversationId: repeatedOffer.conversationId,
        questId: "0001",
        action: "accept",
      }),
    );
    await until("quest accepted after abandonment", () =>
      client.received.filter(
        (message) => message.t === "quest.result" && message.outcome === "accepted",
      ).length >= 2
        ? true
        : undefined,
    );
    await until("reaccepted quest ready", () =>
      [...client.received]
        .reverse()
        .find(
          (message) =>
            message.t === "state" &&
            message.self.authoredQuests?.[0]?.status === "ready" &&
            message.self.authoredQuestMarkers?.[0]?.kind === "ready",
        ),
    );

    client.action("interact");
    const turnIn = await until("quest turn-in opened", () =>
      [...client.received]
        .reverse()
        .find(
          (message) =>
            message.t === "quest.open" &&
            message.entries[0]?.phase === "ready" &&
            message.entries[0]?.canTurnIn,
        ),
    );
    if (turnIn?.t !== "quest.open") throw new Error("missing quest turn-in");
    const turnInIntent = {
      t: "quest.action",
      conversationId: turnIn.conversationId,
      questId: "0001",
      action: "turn-in",
      rewardChoiceId: "0001",
    };
    client.sendRaw(JSON.stringify(turnInIntent));
    await until("quest reward completed", () =>
      client.received.find(
        (message) => message.t === "quest.result" && message.outcome === "completed",
      ),
    );
    await until("quest reward notification", () =>
      client.received.find(
        (message) =>
          message.t === "event" &&
          message.code === "authored_quest.reward" &&
          message.params?.experience === 60,
      ),
    );
    client.sendRaw(JSON.stringify(turnInIntent));

    const claim = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM authored_quest_reward_claim WHERE quest_id = '0001'",
    ).first<{ count: number }>();
    expect(claim?.count).toBe(1);
    expect(
      client.received.filter(
        (message) => message.t === "event" && message.code === "authored_quest.reward",
      ),
    ).toHaveLength(1);
    const rewarded = await env.DB.prepare("SELECT xp, gold FROM hero WHERE id = ?")
      .bind(hero.heroId)
      .first<{ xp: number; gold: number }>();
    expect(rewarded).toEqual({ xp: 60, gold: 7 });
    const items = await env.DB.prepare(
      "SELECT item_definition_id, quantity FROM hero_item WHERE hero_id = ? AND item_definition_id IN ('health_potion', 'mana_potion') ORDER BY item_definition_id",
    )
      .bind(hero.heroId)
      .all<{ item_definition_id: string; quantity: number }>();
    expect(items.results).toEqual([
      { item_definition_id: "health_potion", quantity: 2 },
      { item_definition_id: "mana_potion", quantity: 2 },
    ]);
    const held = await coordinator.getAdventureState(party.partyId);
    expect(held.state).toMatchObject({
      switches: { "0001": true },
      quests: { "0001": { status: "completed", rewardClaimed: true, completionCount: 1 } },
    });

    client.close();
    const reconnected = await Client.joinHero(hero);
    const restored = await until("completed quest restored", () =>
      reconnected.welcome?.self.authoredQuests?.[0]?.status === "completed"
        ? reconnected.welcome
        : undefined,
    );
    expect(restored?.self.inventory).toMatchObject({ gold: 7, potions: 2 });
  });

  it("claims an automatic interaction reward once without an advanceQuest command", async () => {
    const npcId = crypto.randomUUID();
    const npc: MapEvent = {
      id: npcId,
      col: 5,
      row: 5,
      name: "Scout",
      ordinal: 0,
      kind: "normal",
      species: null,
      patrolRadius: null,
      pages: [
        page({
          graphicAssetId: "character.units-blue-units-pawn.pawn-idle",
          commands: [],
        }),
      ],
    };
    const party = await testParty("automatic-quest-reward", {
      maps: [testMapInput("Automatic reward", { events: [npc] })],
    });
    await seedAdventureRegistry(party.adventureId, {
      switches: [],
      variables: [],
      quests: [
        {
          ...createAuthoredQuestDefinition("0001", "Meet the scout"),
          giver: { mapId: party.startMapId, eventId: npcId },
          completion: "automatic",
          objectives: [
            {
              id: "0001",
              type: "interact",
              label: "Talk to the scout",
              target: 1,
              optional: false,
              hidden: false,
              stage: 0,
              interaction: "talk",
              targetRef: { mapId: party.startMapId, eventId: npcId },
            },
          ],
          rewards: {
            experience: 25,
            gold: 11,
            items: [{ itemId: "mana_potion", quantity: 1 }],
            choices: [],
            nextQuestId: null,
            stateChanges: [],
            customCommands: [],
          },
        },
      ],
    });
    const hero = await testHero("AutomaticReward", {
      party,
      account: party.host,
      position: tileCentre(5, 5),
    });
    const client = await Client.joinHero(hero);
    await until("automatic quest welcome", () => client.welcome);

    client.action("interact");
    const offer = await until("automatic quest offer", () =>
      client.received.find(
        (message) => message.t === "quest.open" && message.entries[0]?.canAccept,
      ),
    );
    if (offer?.t !== "quest.open") throw new Error("missing automatic quest offer");
    client.sendRaw(
      JSON.stringify({
        t: "quest.action",
        conversationId: offer.conversationId,
        questId: "0001",
        action: "accept",
      }),
    );
    await until("automatic quest accepted", () =>
      client.received.find(
        (message) => message.t === "quest.result" && message.outcome === "accepted",
      ),
    );

    client.action("interact");
    await until("automatic quest reward applied", () =>
      client.received.find(
        (message) => message.t === "state" && message.self.inventory.gold === 11,
      ),
    );
    client.action("interact");

    const claim = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM authored_quest_reward_claim WHERE recipient_hero_id = ? AND quest_id = '0001'",
    )
      .bind(hero.heroId)
      .first<{ count: number }>();
    expect(claim?.count).toBe(1);
    const rewarded = await env.DB.prepare("SELECT xp, gold FROM hero WHERE id = ?")
      .bind(hero.heroId)
      .first<{ xp: number; gold: number }>();
    expect(rewarded).toEqual({ xp: 25, gold: 11 });
    const mana = await env.DB.prepare(
      "SELECT quantity FROM hero_item WHERE hero_id = ? AND item_definition_id = 'mana_potion'",
    )
      .bind(hero.heroId)
      .first<{ quantity: number }>();
    expect(mana?.quantity).toBe(1);
  });

  it("serializes ten shared kill events, deduplicates retries and stops after victory", async () => {
    const party = await testParty("ten-kills", {
      maps: [testMapInput("Ten kills")],
    });
    await seedAdventureRegistry(party.adventureId, {
      switches: [],
      variables: [],
      quests: [
        {
          ...createAuthoredQuestDefinition("0001", "Dix gobelins à lance"),
          acceptance: "automatic",
          objectives: [
            {
              id: "0001",
              type: "kill",
              label: "",
              target: 10,
              optional: false,
              hidden: false,
              stage: 0,
              species: "spear_goblin",
              mapScope: { kind: "any" },
              credit: "nearby-party",
            },
          ],
        },
      ],
    });
    const hero = await testHero("Counter", { party, account: party.host, level: 8 });
    const client = await Client.joinHero(hero);
    await until("counter welcomed", () => client.welcome);
    const epochRow = await env.DB.prepare("SELECT session_epoch FROM hero WHERE id = ?")
      .bind(hero.heroId)
      .first<{ session_epoch: number }>();
    if (!epochRow) throw new Error("missing connected hero epoch");
    const actor = { heroId: hero.heroId, sessionEpoch: epochRow.session_epoch, level: 8 };
    const coordinator = env.GAME_SESSION.getByName(party.partyId);
    const event = (id: string): QuestBusinessEvent => ({
      id,
      type: "monsterKilled",
      mapId: party.startMapId,
      monsterId: crypto.randomUUID(),
      species: "spear_goblin",
      killer: actor,
      contributors: [actor],
      nearbyParty: [actor],
    });
    const first = event("stable-first-kill");
    await Promise.all([
      coordinator.recordQuestEvent(party.partyId, first),
      coordinator.recordQuestEvent(party.partyId, first),
      ...Array.from({ length: 9 }, (_, index) =>
        coordinator.recordQuestEvent(party.partyId, event(`kill-${index + 2}`)),
      ),
    ]);
    let held = await coordinator.getAdventureState(party.partyId);
    expect(held.state.quests?.["0001"]).toMatchObject({
      status: "ready",
      objectives: { "0001": 10 },
    });

    await coordinator.markPartyCompleted(party.partyId);
    await coordinator.recordQuestEvent(party.partyId, event("after-victory"));
    held = await coordinator.getAdventureState(party.partyId);
    expect(held.state.quests?.["0001"]?.objectives["0001"]).toBe(10);
  });

  it("persists contributor credit separately for two personal quests and fences a stale hero", async () => {
    const party = await testParty("personal-credit", {
      maps: [testMapInput("Personal credit")],
    });
    await seedAdventureRegistry(party.adventureId, {
      switches: [],
      variables: [],
      quests: [
        {
          ...createAuthoredQuestDefinition("0001", "Participation personnelle"),
          scope: "personal",
          acceptance: "automatic",
          objectives: [
            {
              id: "0001",
              type: "kill",
              label: "",
              target: 2,
              optional: false,
              hidden: false,
              stage: 0,
              species: "spear_goblin",
              mapScope: { kind: "any" },
              credit: "contributors",
            },
          ],
        },
      ],
    });
    const heroA = await testHero("PersonalA", { party, account: party.host, level: 8 });
    const heroB = await testHero("PersonalB", { party, level: 8 });
    const clientA = await Client.joinHero(heroA);
    const clientB = await Client.joinHero(heroB);
    await until("personal heroes welcomed", () => clientA.welcome && clientB.welcome);
    const rows = await env.DB.prepare(
      "SELECT id, session_epoch FROM hero WHERE id IN (?, ?) ORDER BY id",
    )
      .bind(heroA.heroId, heroB.heroId)
      .all<{ id: string; session_epoch: number }>();
    const actorFor = (heroId: string) => {
      const row = rows.results.find((candidate) => candidate.id === heroId);
      if (!row) throw new Error("missing personal hero epoch");
      return { heroId, sessionEpoch: row.session_epoch, level: 8 };
    };
    const actorA = actorFor(heroA.heroId);
    const actorB = actorFor(heroB.heroId);
    const event: QuestBusinessEvent = {
      id: "shared-personal-kill",
      type: "monsterKilled",
      mapId: party.startMapId,
      monsterId: crypto.randomUUID(),
      species: "spear_goblin",
      killer: actorA,
      contributors: [actorA, actorB],
      nearbyParty: [actorA, actorB],
    };
    const coordinator = env.GAME_SESSION.getByName(party.partyId);
    await coordinator.recordQuestEvent(party.partyId, event);
    await until("both personal trackers updated", () => {
      const progress = (client: Client) =>
        [...client.received].reverse().find((message) => message.t === "state")?.self
          .authoredQuests?.[0]?.objectives[0]?.progress;
      return progress(clientA) === 1 && progress(clientB) === 1;
    });

    // A transport retry carries the same server event id and changes neither persisted row.
    await coordinator.recordQuestEvent(party.partyId, event);
    const persisted = await env.DB.prepare(
      "SELECT hero_id, data FROM hero_quest WHERE quest_id = '0001' ORDER BY hero_id",
    ).all<{ hero_id: string; data: string }>();
    expect(persisted.results).toHaveLength(2);
    for (const row of persisted.results) {
      const data = JSON.parse(row.data) as { authoredProgress: { objectives: { "0001": number } } };
      expect(data.authoredProgress.objectives["0001"]).toBe(1);
    }

    clientB.close();
    const reconnectedB = await Client.joinHero(heroB);
    const welcomeAfterReconnect = await until("personal progress restored on reconnect", () =>
      reconnectedB.welcome?.self.authoredQuests?.[0]?.objectives[0]?.progress === 1
        ? reconnectedB.welcome
        : undefined,
    );
    expect(welcomeAfterReconnect?.self.authoredQuests?.[0]).toMatchObject({
      id: "0001",
      objectives: [{ id: "0001", progress: 1, target: 2 }],
    });

    // Simulate a takeover. The old actor epoch cannot write the second kill.
    await env.DB.prepare("UPDATE hero SET session_epoch = session_epoch + 1 WHERE id = ?")
      .bind(heroA.heroId)
      .run();
    await coordinator.recordQuestEvent(party.partyId, {
      ...event,
      id: "stale-personal-kill",
      contributors: [actorA],
      nearbyParty: [actorA],
    });
    const stale = await env.DB.prepare(
      "SELECT data FROM hero_quest WHERE hero_id = ? AND quest_id = '0001'",
    )
      .bind(heroA.heroId)
      .first<{ data: string }>();
    if (!stale) throw new Error("missing stale personal quest row");
    const staleData = JSON.parse(stale.data) as {
      authoredProgress: { objectives: { "0001": number } };
    };
    expect(staleData.authoredProgress.objectives["0001"]).toBe(1);
  });

  it("tracks map entry, NPC conversation and item acquisition without quest commands", async () => {
    const npcId = crypto.randomUUID();
    const npc: MapEvent = {
      id: npcId,
      col: 5,
      row: 5,
      name: "Guide",
      ordinal: 0,
      kind: "normal",
      species: null,
      patrolRadius: null,
      pages: [
        page({
          graphicAssetId: "character.units-blue-units-pawn.pawn-idle",
          commands: [
            { t: "changeItems", itemId: "mana_potion", count: 2 },
            { t: "say", text: "Bienvenue.", name: "Guide" },
          ],
        }),
      ],
    };
    const party = await testParty("arrival-and-talk", {
      maps: [testMapInput("Arrival and talk", { events: [npc] })],
    });
    await seedAdventureRegistry(party.adventureId, {
      switches: [],
      variables: [],
      quests: [
        {
          ...createAuthoredQuestDefinition("0001", "Trouver le guide"),
          acceptance: "automatic",
          objectives: [
            {
              id: "0001",
              type: "reach",
              label: "",
              target: 1,
              optional: false,
              hidden: false,
              stage: 0,
              destination: { kind: "map", mapId: party.startMapId },
            },
            {
              id: "0002",
              type: "interact",
              label: "",
              target: 1,
              optional: false,
              hidden: false,
              stage: 0,
              targetRef: { mapId: party.startMapId, eventId: npcId },
              interaction: "talk",
            },
            {
              id: "0003",
              type: "collect",
              label: "",
              target: 2,
              optional: false,
              hidden: false,
              stage: 0,
              itemId: "mana_potion",
              counting: "acquired",
            },
          ],
        },
      ],
    });
    const hero = await testHero("Visitor", {
      party,
      account: party.host,
      position: tileCentre(5, 5),
    });
    const client = await Client.joinHero(hero);
    await until("map entry tracked", () =>
      client.received.find(
        (message) =>
          message.t === "state" && message.self.authoredQuests?.[0]?.objectives[0]?.progress === 1,
      ),
    );
    client.action("interact");
    const ready = await until("NPC conversation and acquisition tracked", () =>
      client.received.find(
        (message) =>
          message.t === "state" &&
          message.self.authoredQuests?.[0]?.objectives[1]?.progress === 1 &&
          message.self.authoredQuests[0].objectives[2]?.progress === 2,
      ),
    );
    expect(ready).toMatchObject({
      t: "state",
      self: {
        authoredQuests: [
          {
            status: "ready",
            objectives: [
              { id: "0001", progress: 1 },
              { id: "0002", progress: 1 },
              { id: "0003", progress: 2 },
            ],
          },
        ],
      },
    });
  });

  it("loads the party snapshot once and pushes the same state to both map rooms", async () => {
    const fixture = await seedFixture("snapshot");
    const persisted: PartyAdventureState = {
      switches: { "0003": true },
      variables: { "0002": 7 },
      selfSwitches: {},
    };
    await seedPersistedState(fixture.party.partyId, persisted);

    const heroA = await testHero("SnapA", { party: fixture.party, account: fixture.party.host });
    const heroB = await testHero("SnapB", { party: fixture.party, mapId: fixture.mapB });
    const clientA = await Client.joinHero(heroA);
    const clientB = await Client.joinHero(heroB);
    await until("both rooms welcomed", () => clientA.welcome && clientB.welcome);

    const diagA = await env.WORLD.getByName(fixture.roomKeyA).roomDiagnostics();
    const diagB = await env.WORLD.getByName(fixture.roomKeyB).roomDiagnostics();
    expect(diagA.adventureState).toEqual(persisted);
    expect(diagB.adventureState).toEqual(persisted);
  });

  it("shows page 1 in the active list at join when the gating switch is unset", async () => {
    const fixture = await seedFixture("join");
    const hero = await testHero("JoinHero", { party: fixture.party, account: fixture.party.host });
    const client = await Client.joinHero(hero);
    await until("welcomed", () => client.welcome);

    const diag = await env.WORLD.getByName(fixture.roomKeyA).roomDiagnostics();
    expect(diag.activeEvents).toEqual([
      {
        id: fixture.eventIdA,
        col: EVENT_COL,
        row: EVENT_ROW,
        graphicAssetId: PAGE1_GRAPHIC,
        onTop: false,
      },
    ]);
  });

  it("re-evaluates pages in BOTH rooms when the coordinator flips a switch", async () => {
    const fixture = await seedFixture("flip");
    const heroA = await testHero("FlipA", { party: fixture.party, account: fixture.party.host });
    const heroB = await testHero("FlipB", { party: fixture.party, mapId: fixture.mapB });
    const clientA = await Client.joinHero(heroA);
    const clientB = await Client.joinHero(heroB);
    await until("both rooms welcomed", () => clientA.welcome && clientB.welcome);

    const before = await env.WORLD.getByName(fixture.roomKeyB).roomDiagnostics();
    expect(before.activeEvents[0]?.graphicAssetId).toBe(PAGE1_GRAPHIC);

    await env.GAME_SESSION.getByName(fixture.party.partyId).applyStateChangeForTest(
      fixture.party.partyId,
      { switchId: "0001", value: true },
    );

    const diagA = await env.WORLD.getByName(fixture.roomKeyA).roomDiagnostics();
    const diagB = await env.WORLD.getByName(fixture.roomKeyB).roomDiagnostics();
    expect(diagA.activeEvents[0]).toMatchObject({
      id: fixture.eventIdA,
      graphicAssetId: PAGE2_GRAPHIC,
    });
    expect(diagB.activeEvents[0]).toMatchObject({
      id: fixture.eventIdB,
      graphicAssetId: PAGE2_GRAPHIC,
    });
  });

  it("puts page 1 on the welcome wire, then upserts page 2 and removes a dormant event on flips", async () => {
    const gateId = crypto.randomUUID();
    const vanishId = crypto.randomUUID();
    const maps: TestMapBody[] = [
      testMapInput("wire ground", { events: [twoPageEvent(gateId), vanishEvent(vanishId)] }),
    ];
    const party = await testParty("wire", { maps });
    // 0002 on so the vanish event starts present; 0001 off so the gate starts on page 1.
    await seedPersistedState(party.partyId, {
      switches: { "0002": true },
      variables: {},
      selfSwitches: {},
    });

    const hero = await testHero("Wire", { party, account: party.host });
    const client = await Client.joinHero(hero);
    await until("welcomed", () => client.welcome);

    // The welcome carries the active page's appearance for every holding event.
    const welcomeEvents = client.welcome?.world.events ?? [];
    expect(welcomeEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: gateId, graphicAssetId: PAGE1_GRAPHIC, onTop: false }),
        expect.objectContaining({ id: vanishId, graphicAssetId: PAGE1_GRAPHIC }),
      ]),
    );

    // Flip 0001: the gate's active page becomes page 2, carried as a delta upsert.
    await env.GAME_SESSION.getByName(party.partyId).applyStateChangeForTest(party.partyId, {
      switchId: "0001",
      value: true,
    });
    await until(
      "gate shows page 2",
      () => client.events.find((event) => event.id === gateId)?.graphicAssetId === PAGE2_GRAPHIC,
    );
    const sawUpsert = client.received.some(
      (message) =>
        message.t === "world.delta" &&
        message.events.upsert.some(
          (event) => event.id === gateId && event.graphicAssetId === PAGE2_GRAPHIC,
        ),
    );
    expect(sawUpsert).toBe(true);

    // Flip 0002 off: the single-page vanish event goes dormant and must be REMOVED from the wire.
    // If the diff never emitted removals, the stale page-1 event would linger here.
    await env.GAME_SESSION.getByName(party.partyId).applyStateChangeForTest(party.partyId, {
      switchId: "0002",
      value: false,
    });
    await until("vanish removed", () => client.events.every((event) => event.id !== vanishId));
    expect(client.events.map((event) => event.id)).toEqual([gateId]);
  });

  it("serves the coordinator's held state to a restoring room — load-on-demand and ahead of D1", async () => {
    // A ticking World cannot be evicted (`evictDurableObject` hangs on its `setInterval`), so the
    // hibernation-restore obligation is proved as two halves: (A) the coordinator serves persisted
    // state on demand even when it is itself cold, and (B) the copy it serves is the held one, which
    // can be newer than D1's debounced row — exactly what a restoring World must pull instead of D1.

    // Half A: a fresh coordinator (no room ever admitted) loads the persisted row on first ask.
    const loadFixture = await seedFixture("hib-load");
    await seedPersistedState(loadFixture.party.partyId, {
      switches: { "0001": true },
      variables: {},
      selfSwitches: {},
    });
    const loaded = await env.GAME_SESSION.getByName(loadFixture.party.partyId).getAdventureState(
      loadFixture.party.partyId,
    );
    expect(loaded.state.switches).toEqual({ "0001": true });

    // Half B: after a seam flip the held state is ahead of D1 (the write is debounced 5s). A
    // restoring room pulling `getAdventureState` sees the flip; D1 does not yet.
    const heldFixture = await seedFixture("hib-held");
    const hero = await testHero("Hib", {
      party: heldFixture.party,
      account: heldFixture.party.host,
    });
    const client = await Client.joinHero(hero);
    await until("welcomed", () => client.welcome);

    await env.GAME_SESSION.getByName(heldFixture.party.partyId).applyStateChangeForTest(
      heldFixture.party.partyId,
      { switchId: "0001", value: true },
    );
    const held = await env.GAME_SESSION.getByName(heldFixture.party.partyId).getAdventureState(
      heldFixture.party.partyId,
    );
    expect(held.state.switches["0001"]).toBe(true);
    expect(await readPersistedState(heldFixture.party.partyId)).toBeNull();
  });

  it("re-evaluates against the EMPTY snapshot when the hibernation restore pull fails", async () => {
    // A ticking World cannot be evicted, so the constructor's failed-pull catch is exercised through
    // its extracted recovery seam. With 0001 held true the gate shows page 2 at join; a failed
    // restore falls the room back to EMPTY state, and the ALWAYS-ON page 1 must survive rather than
    // the room waking with no events. Mutation proof: drop `#evaluateActiveEvents()` from the
    // recovery and the room keeps page 2 here, failing the page-1 assertion.
    const fixture = await seedFixture("restore-fail");
    await seedPersistedState(fixture.party.partyId, {
      switches: { "0001": true },
      variables: {},
      selfSwitches: {},
    });
    const hero = await testHero("Restore", { party: fixture.party, account: fixture.party.host });
    const client = await Client.joinHero(hero);
    await until("welcomed", () => client.welcome);

    const room = env.WORLD.getByName(fixture.roomKeyA);
    const before = await room.roomDiagnostics();
    expect(before.activeEvents[0]?.graphicAssetId).toBe(PAGE2_GRAPHIC);

    await room.recoverEventsAfterFailedStateRestoreForTest();

    const after = await room.roomDiagnostics();
    expect(after.activeEvents).toEqual([
      {
        id: fixture.eventIdA,
        col: EVENT_COL,
        row: EVENT_ROW,
        graphicAssetId: PAGE1_GRAPHIC,
        onTop: false,
      },
    ]);
  });

  it("keeps a mutation that lands during a flush from being clobbered by the dirty clear", async () => {
    // A flush captures the version it is about to write and only clears `#dirty` when that version is
    // still current. A mutation landing during the awaited D1 write bumps the version, so the flush
    // leaves `#dirty` set and re-arms — a later flush lands the newer value. Mutation proof: clear
    // `#dirty` unconditionally and the newer 0002 never reaches D1 (the second flush no-ops).
    const fixture = await seedFixture("flush-race");
    const hero = await testHero("Racer", { party: fixture.party, account: fixture.party.host });
    const client = await Client.joinHero(hero);
    await until("welcomed", () => client.welcome);

    const coordinator = env.GAME_SESSION.getByName(fixture.party.partyId);
    // First mutation: version 1, dirty, alarm armed (debounced — not in D1 yet).
    await coordinator.applyStateChangeForTest(fixture.party.partyId, {
      switchId: "0001",
      value: true,
    });

    // Race a second mutation (0002) into the flush window. The flush writes the v1 state to D1, sees
    // the version has since moved, and stays dirty rather than clobbering the 0002 flag.
    await coordinator.raceFlushWithMutationForTest(fixture.party.partyId, "0002");

    const afterRace = await readPersistedState(fixture.party.partyId);
    expect(afterRace?.switches).toEqual({ "0001": true }); // the flush wrote only the v1 state

    // The re-armed alarm flushes again; the newer 0002 must now land.
    const ran = await runDurableObjectAlarm(coordinator);
    expect(ran).toBe(true);
    const afterAlarm = await readPersistedState(fixture.party.partyId);
    expect(afterAlarm?.switches["0002"]).toBe(true);
    expect(afterAlarm?.switches["0001"]).toBe(true);
  });

  it("saves on party-empty and prunes an orphan self-switch", async () => {
    const fixture = await seedFixture("save");
    const orphanKey = `${crypto.randomUUID()}:A`;
    await seedPersistedState(fixture.party.partyId, {
      switches: {},
      variables: {},
      selfSwitches: { [orphanKey]: true },
    });

    const hero = await testHero("SaveHero", { party: fixture.party, account: fixture.party.host });
    const client = await Client.joinHero(hero);
    await until("welcomed", () => client.welcome);

    await env.GAME_SESSION.getByName(fixture.party.partyId).applyStateChangeForTest(
      fixture.party.partyId,
      { switchId: "0001", value: true },
    );

    client.close();
    await drainHeroRooms();

    // The coordinator's party-empty flush runs after the room reports empty, so poll D1 for it.
    let saved: PartyAdventureState | null = null;
    for (let attempt = 0; attempt < 100; attempt++) {
      const current = await readPersistedState(fixture.party.partyId);
      if (current && current.switches["0001"] === true) {
        saved = current;
        break;
      }
      await scheduler.wait(50);
    }
    if (!saved) throw new Error("timed out waiting for the party-empty save");
    expect(saved.switches).toEqual({ "0001": true });
    expect(saved.selfSwitches).toEqual({});
  });
});
