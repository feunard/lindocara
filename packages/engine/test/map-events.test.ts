/**
 * `parseMapEvents` off the wire, and `validateEventName` on its own: totality (every malformed
 * field lands on null, never a throw), bounds, duplicate cells and the two mutation-proof
 * branches called out in the plan (duplicate-cell rejection, bounds rejection).
 */

import {
  defaultMonsterTuning,
  MONSTER_RESPAWN_DELAY_LIMITS,
  MONSTER_RESPAWN_MS,
  MONSTER_TUNING_LIMITS,
} from "@lindocara/engine/game.js";
import { DEFAULT_HARVEST_COLLISIONS, type HarvestProfile } from "@lindocara/engine/harvest.js";
import {
  EVENT_GRAPHIC_TINT_DEFAULT,
  EVENT_NAME_MAX,
  functionalEvent,
  harvestableEvents,
  isActiveWorldEventKind,
  isInteractiveWorldEventKind,
  MAX_EVENTS_PER_MAP,
  MAX_PAGES_PER_EVENT,
  MAX_RUNTIME_EVENTS_PER_MAP,
  type MapEvent,
  type MapEventPage,
  parseMapEvents,
  seaGuardianEvents,
  validateEventName,
} from "@lindocara/engine/map-events.js";
import { TILE_SIZE } from "@lindocara/engine/tilemap.js";
import {
  DEFAULT_GUARD_APPEARANCE_ASSET_ID,
  type EditorAssetId,
} from "@lindocara/engine/tiny-swords-catalog.js";
import { describe, expect, it } from "vitest";

const COLS = 16;
const ROWS = 17;

const GOOD_ASSET_ID = "building.buildings-black-buildings.archery";
const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";
const TREE_ASSET_ID = "resource.terrain-resources-wood-trees.tree1";
const OTHER_TREE_ASSET_ID = "resource.terrain-resources-wood-trees.tree2";
const STUMP_ASSET_ID = "resource.terrain-resources-wood-trees.stump-1";

const HARVEST_PROFILE: HarvestProfile = {
  resource: "wood",
  tool: "axe",
  yieldAmount: 8,
  goldValue: 0,
  hitsRequired: 3,
  range: 96,
  harvestDurationMs: 900,
  exhaustedAssetId: STUMP_ASSET_ID,
  exhaustionBehavior: "replace",
  respawn: "permanent",
  respawnDelayMs: 0,
  fadeDurationMs: 350,
  collision: DEFAULT_HARVEST_COLLISIONS.wood,
};

function page(overrides: Partial<MapEventPage> = {}): MapEventPage {
  return {
    condSwitchId: null,
    condVariableId: null,
    condVariableMin: null,
    condSelfSwitch: null,
    graphicAssetId: null,
    graphicTint: EVENT_GRAPHIC_TINT_DEFAULT,
    moveType: "fixed",
    moveRoute: [],
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

function fullPage(): MapEventPage {
  return page({
    condSwitchId: "0001",
    condVariableId: "0002",
    condVariableMin: 5,
    condSelfSwitch: "A",
    graphicAssetId: GOOD_ASSET_ID,
    moveType: "random",
    moveSpeed: 5,
    moveFreq: 4,
    optMoveAnim: true,
    optStopAnim: true,
    optDirFix: true,
    optThrough: true,
    optOnTop: true,
    trigger: "parallel",
  });
}

function event(overrides: Partial<MapEvent> = {}): MapEvent {
  return {
    id: ID_A,
    col: 1,
    row: 1,
    name: "Guard",
    ordinal: 0,
    kind: "normal",
    species: null,
    patrolRadius: null,
    monsterRank: null,
    monsterMaxHp: null,
    monsterDamage: null,
    monsterSpeed: null,
    monsterXp: null,
    monsterWeakness: null,
    monsterWeaknessPercent: null,
    monsterSpecialTechnique: null,
    pages: [page()],
    ...overrides,
  };
}

describe("validateEventName", () => {
  it("trims and accepts a name within bounds", () => {
    expect(validateEventName("  Guard  ")).toBe("Guard");
  });

  it("accepts an empty name — the ordinal chip is the real label", () => {
    expect(validateEventName("")).toBe("");
    expect(validateEventName("   ")).toBe("");
  });

  it("rejects a non-string or an overlong name", () => {
    expect(validateEventName(42)).toBeNull();
    expect(validateEventName(null)).toBeNull();
    expect(validateEventName("x".repeat(EVENT_NAME_MAX + 1))).toBeNull();
  });

  it("accepts exactly the maximum length", () => {
    expect(validateEventName("x".repeat(EVENT_NAME_MAX))).toBe("x".repeat(EVENT_NAME_MAX));
  });
});

describe("parseMapEvents: good payloads round-trip unchanged", () => {
  it("round-trips a minimal event", () => {
    const events = [event()];
    expect(parseMapEvents(events, COLS, ROWS)).toEqual(events);
  });

  it("round-trips a tinted NPC activity routine", () => {
    const route = [
      { offsetCol: 2, offsetRow: 0, waitMs: 1_500 },
      { offsetCol: 0, offsetRow: -2, waitMs: 0 },
    ];
    const npc = event({
      kind: "npc",
      species: null,
      patrolRadius: 256,
      pages: [
        page({
          graphicTint: 0x7c3aed,
          moveType: "custom",
          moveRoute: route,
        }),
      ],
    });
    expect(parseMapEvents([npc], COLS, ROWS)?.[0]?.pages[0]).toMatchObject({
      graphicTint: 0x7c3aed,
      moveRoute: route,
    });
  });

  it("rejects malformed colours and out-of-bounds routine steps", () => {
    expect(
      parseMapEvents([event({ pages: [page({ graphicTint: 0x1000000 })] })], COLS, ROWS),
    ).toBeNull();
    expect(
      parseMapEvents(
        [
          event({
            pages: [
              page({
                moveRoute: [{ offsetCol: 33, offsetRow: 0, waitMs: 0 }],
              }),
            ],
          }),
        ],
        COLS,
        ROWS,
      ),
    ).toBeNull();
  });

  it("round-trips an event with every field populated, across two pages", () => {
    const events = [event({ id: ID_B, pages: [page(), fullPage()] })];
    expect(parseMapEvents(events, COLS, ROWS)).toEqual(events);
  });

  it("defaults nothing: an absent/empty array round-trips as empty", () => {
    expect(parseMapEvents([], COLS, ROWS)).toEqual([]);
  });

  it("accepts up to MAX_EVENTS_PER_MAP events", () => {
    const events = Array.from({ length: MAX_EVENTS_PER_MAP }, (_, i) =>
      event({
        id: `${String(i).padStart(8, "0")}-1111-4111-8111-111111111111`,
        col: i % COLS,
        row: Math.floor(i / COLS),
        ordinal: i,
        kind: "entry",
      }),
    );
    expect(parseMapEvents(events, COLS, ROWS)).toEqual(events);
  });

  it("bounds runtime entities separately from inert anchors", () => {
    const runtimeEvents = Array.from({ length: MAX_RUNTIME_EVENTS_PER_MAP }, (_, i) =>
      event({
        id: `${String(i).padStart(8, "0")}-1111-4111-8111-111111111111`,
        col: i % COLS,
        row: Math.floor(i / COLS),
        ordinal: i,
      }),
    );
    expect(parseMapEvents(runtimeEvents, COLS, ROWS)).toEqual(runtimeEvents);
    expect(
      parseMapEvents(
        [
          ...runtimeEvents,
          event({
            id: "99999999-1111-4111-8111-111111111111",
            col: 0,
            row: Math.ceil(MAX_RUNTIME_EVENTS_PER_MAP / COLS),
            ordinal: MAX_RUNTIME_EVENTS_PER_MAP,
          }),
        ],
        COLS,
        ROWS,
      ),
    ).toBeNull();
  });

  it("accepts up to MAX_PAGES_PER_EVENT pages", () => {
    const events = [event({ pages: Array.from({ length: MAX_PAGES_PER_EVENT }, () => page()) })];
    expect(parseMapEvents(events, COLS, ROWS)?.[0]?.pages).toHaveLength(MAX_PAGES_PER_EVENT);
  });
});

describe("parseMapEvents: sea guardian special monster", () => {
  const guardian = functionalEvent({
    id: ID_A,
    col: 3,
    row: 4,
    ordinal: 1,
    kind: "sea-guardian",
    name: "Sea guardian",
  });

  it("round-trips every dedicated anchor and exposes them through the typed selector", () => {
    const second = functionalEvent({
      id: ID_B,
      col: 4,
      row: 4,
      ordinal: 2,
      kind: "sea-guardian",
    });
    const parsed = parseMapEvents([guardian, second], COLS, ROWS);
    expect(parsed).toEqual([guardian, second]);
    expect(seaGuardianEvents(parsed ?? [])).toEqual([guardian, second]);
    expect(isActiveWorldEventKind("sea-guardian")).toBe(false);
    expect(isInteractiveWorldEventKind("sea-guardian")).toBe(false);
  });

  it("rejects generic event-page configuration", () => {
    expect(
      parseMapEvents(
        [
          {
            ...guardian,
            pages: [{ ...guardian.pages[0], graphicAssetId: GOOD_ASSET_ID }],
          },
        ],
        COLS,
        ROWS,
      ),
    ).toBeNull();
  });
});

describe("parseMapEvents: totality — every malformed field lands on null, never a throw", () => {
  const cases: Record<string, unknown> = {
    "non-array root": { not: "an array" },
    "non-object entry": [42],
    "null entry": [null],
    "malformed uuid": [event({ id: "not-a-uuid" })],
    "uuid with an invalid variant nibble": [event({ id: "11111111-1111-4111-7111-111111111111" })],
    "duplicate id across two events": [
      event({ id: ID_A, col: 1, row: 1 }),
      event({ id: ID_A, col: 2, row: 2 }),
    ],
    "out-of-bounds col": [event({ col: COLS })],
    "out-of-bounds row": [event({ row: ROWS })],
    "negative col": [event({ col: -1 })],
    "non-integer col": [event({ col: 1.5 })],
    "duplicate cell across two events": [
      event({ id: ID_A, col: 3, row: 3 }),
      event({ id: ID_B, col: 3, row: 3 }),
    ],
    "over-long name": [event({ name: "x".repeat(EVENT_NAME_MAX + 1) })],
    "non-string name": [event({ name: 42 as unknown as string })],
    "non-integer ordinal": [event({ ordinal: 1.5 })],
    "negative ordinal": [event({ ordinal: -1 })],
    "zero pages": [event({ pages: [] })],
    "nine pages": [event({ pages: Array.from({ length: MAX_PAGES_PER_EVENT + 1 }, () => page()) })],
    "non-array pages": [event({ pages: "nope" as unknown as MapEventPage[] })],
    "malformed page entry": [event({ pages: [null as unknown as MapEventPage] })],
    "bad trigger": [event({ pages: [page({ trigger: "on-touch" as never })] })],
    "bad move type": [event({ pages: [page({ moveType: "teleport" as never })] })],
    "move speed below range": [event({ pages: [page({ moveSpeed: -1 })] })],
    "move speed above range": [event({ pages: [page({ moveSpeed: 6 })] })],
    "move freq above range": [event({ pages: [page({ moveFreq: 5 })] })],
    "non-integer move speed": [event({ pages: [page({ moveSpeed: 2.5 })] })],
    "unknown asset id": [event({ pages: [page({ graphicAssetId: "nope.nope" as never })] })],
    "bad self-switch": [event({ pages: [page({ condSelfSwitch: "E" as never })] })],
    "malformed switch id": [event({ pages: [page({ condSwitchId: "12" })] })],
    "malformed variable id": [event({ pages: [page({ condVariableId: "abcd" })] })],
    "variable id without threshold": [
      event({ pages: [page({ condVariableId: "0001", condVariableMin: null })] }),
    ],
    "variable threshold without id": [
      event({ pages: [page({ condVariableId: null, condVariableMin: 3 })] }),
    ],
    "negative variable threshold": [
      event({ pages: [page({ condVariableId: "0001", condVariableMin: -1 })] }),
    ],
    "non-boolean option": [event({ pages: [page({ optMoveAnim: "yes" as unknown as boolean })] })],
    "too many events": Array.from({ length: MAX_EVENTS_PER_MAP + 1 }, (_, i) =>
      event({
        id: `${String(i).padStart(8, "0")}-1111-4111-8111-111111111111`,
        col: i % COLS,
        row: Math.floor(i / COLS),
        ordinal: i,
        kind: "entry",
      }),
    ),
  };

  for (const [name, value] of Object.entries(cases)) {
    it(`rejects: ${name}`, () => {
      expect(parseMapEvents(value, COLS, ROWS)).toBeNull();
    });
  }
});

describe("parseMapEvents: commands thread through pages", () => {
  const program = [
    { t: "say", text: "Bonjour", name: null },
    {
      t: "if",
      cond: { type: "switch", switchId: "0001" },
      then: [{ t: "changeGold", amount: 5 }],
      else: [],
    },
  ];

  it("round-trips a normal event page carrying a command program", () => {
    const events = [event({ pages: [page({ commands: program as MapEventPage["commands"] })] })];
    const parsed = parseMapEvents(events, COLS, ROWS);
    expect(parsed).not.toBeNull();
    expect(parsed?.[0]?.pages[0]?.commands).toEqual(program);
  });

  it("defaults a page with no commands field to an empty program", () => {
    // A page from a pre-tranche-5 client omits `commands` entirely; it means the empty program.
    const { commands: _drop, ...pageWithout } = page();
    const events = [event({ pages: [pageWithout as MapEventPage] })];
    const parsed = parseMapEvents(events, COLS, ROWS);
    expect(parsed?.[0]?.pages[0]?.commands).toEqual([]);
  });

  it("rejects a page whose commands program is malformed", () => {
    const events = [
      event({
        pages: [page({ commands: [{ t: "nope" }] as unknown as MapEventPage["commands"] })],
      }),
    ];
    expect(parseMapEvents(events, COLS, ROWS)).toBeNull();
  });

  it("rejects a non-normal (entry) event carrying a non-empty program", () => {
    // Anchors are not scripts: a functional event smuggling commands over the wire is refused,
    // exactly as it is refused extra pages.
    const entry = event({
      kind: "entry",
      pages: [page({ commands: program as MapEventPage["commands"] })],
    });
    expect(parseMapEvents([entry], COLS, ROWS)).toBeNull();
  });

  it("accepts a non-normal (entry) event with an empty program", () => {
    // Mutation-proof sanity: the rejection above is specifically the non-empty program, not the
    // kind — the same entry event with `commands: []` parses fine.
    const entry = event({ kind: "entry", pages: [page({ commands: [] })] });
    expect(parseMapEvents([entry], COLS, ROWS)).not.toBeNull();
  });

  it("accepts a monster on-defeat program", () => {
    const monster = event({
      kind: "monster",
      species: "spear_goblin",
      patrolRadius: 96,
      pages: [
        page({
          commands: [{ t: "advanceQuest", questId: "0001", objectiveId: "0001", amount: 1 }],
        }),
      ],
    });
    const defaults = defaultMonsterTuning("spear_goblin");
    expect(parseMapEvents([monster], COLS, ROWS)?.[0]).toMatchObject({
      monsterRank: defaults.rank,
      monsterMaxHp: defaults.maxHp,
      monsterDamage: defaults.damage,
      monsterSpeed: defaults.speed,
      monsterXp: defaults.xp,
      monsterWeakness: defaults.weakness,
      monsterWeaknessPercent: defaults.weaknessPercent,
      monsterSpecialTechnique: defaults.specialTechnique,
    });
  });

  it("accepts conditional monster pages", () => {
    const conditional = event({
      kind: "monster",
      species: "skull_warden",
      patrolRadius: 120,
      pages: [
        page({
          condSwitchId: "0075",
          commands: [{ t: "setSwitch", switchId: "0006", value: true }],
        }),
        page({
          condSwitchId: "0076",
          commands: [{ t: "setSwitch", switchId: "0007", value: true }],
        }),
      ],
    });

    expect(parseMapEvents([conditional], COLS, ROWS)?.[0]?.pages).toHaveLength(2);
  });

  it("accepts a free NPC with characteristics and an autonomous routine", () => {
    const npc = event({
      kind: "npc",
      species: null,
      patrolRadius: 128,
      monsterMaxHp: 250,
      monsterDamage: 18,
      pages: [
        page({
          graphicAssetId: GOOD_ASSET_ID,
          moveType: "custom",
          moveSpeed: 3,
          moveFreq: 2,
          commands: [{ t: "say", text: "Belle journée.", name: "Mara" }],
        }),
      ],
    });

    expect(parseMapEvents([npc], COLS, ROWS)?.[0]).toMatchObject({
      kind: "npc",
      species: null,
      patrolRadius: 128,
      monsterMaxHp: 250,
      monsterDamage: 18,
      pages: [{ moveType: "custom" }],
    });
  });
});

describe("parseMapEvents: authored monster tuning", () => {
  it("hydrates a legacy monster with species defaults", () => {
    const legacy = event({
      kind: "monster",
      species: "spear_goblin",
      patrolRadius: 64,
    });
    const parsed = parseMapEvents([legacy], COLS, ROWS)?.[0];
    expect(parsed).toMatchObject({
      monsterRank: "normal",
      monsterMaxHp: defaultMonsterTuning("spear_goblin").maxHp,
      monsterDamage: defaultMonsterTuning("spear_goblin").damage,
      monsterWeakness: "none",
      monsterWeaknessPercent: defaultMonsterTuning("spear_goblin").weaknessPercent,
      monsterSpecialTechnique: "none",
    });
    expect(parsed?.monsterRespawnMode).toBeUndefined();
    expect(parsed?.monsterRespawnDelayMs).toBe(MONSTER_RESPAWN_MS);
    expect(parsed?.monsterAttackProfile).toBeUndefined();
  });

  it("normalizes explicit legacy pixel speeds without dividing tile values or defaults twice", () => {
    const base = { kind: "monster" as const, species: "spear_goblin" as const, patrolRadius: 64 };
    const legacy = parseMapEvents([event({ ...base, monsterSpeed: 105 })], COLS, ROWS)?.[0];
    const modern = parseMapEvents([event({ ...base, monsterSpeed: 2.25 })], COLS, ROWS)?.[0];
    const defaulted = parseMapEvents([event(base)], COLS, ROWS)?.[0];

    expect(legacy?.monsterSpeed).toBe(105 / TILE_SIZE);
    expect(modern?.monsterSpeed).toBe(2.25);
    expect(defaulted?.monsterSpeed).toBe(defaultMonsterTuning("spear_goblin").speed);
  });

  it("accepts an explicit attack profile and rejects invalid or non-monster values", () => {
    const archer = event({
      kind: "monster",
      species: "spear_goblin",
      patrolRadius: 64,
      monsterAttackProfile: "arrow",
    });
    expect(parseMapEvents([archer], COLS, ROWS)?.[0]?.monsterAttackProfile).toBe("arrow");
    expect(
      parseMapEvents([{ ...archer, monsterAttackProfile: "laser" as "arrow" }], COLS, ROWS),
    ).toBeNull();
    expect(parseMapEvents([event({ monsterAttackProfile: "arrow" })], COLS, ROWS)).toBeNull();
  });

  it("accepts permanent death only on monster events", () => {
    const permanent = event({
      kind: "monster",
      species: "spear_goblin",
      patrolRadius: 64,
      monsterRespawnMode: "never",
    });
    expect(parseMapEvents([permanent], COLS, ROWS)?.[0]?.monsterRespawnMode).toBe("never");
    expect(parseMapEvents([event({ monsterRespawnMode: "never" })], COLS, ROWS)).toBeNull();
    expect(
      parseMapEvents([event({ monsterRespawnDelayMs: MONSTER_RESPAWN_MS })], COLS, ROWS),
    ).toBeNull();
    expect(
      parseMapEvents(
        [
          event({
            kind: "monster",
            species: "spear_goblin",
            patrolRadius: 64,
            monsterRespawnMode: "invalid" as "never",
          }),
        ],
        COLS,
        ROWS,
      ),
    ).toBeNull();
    expect(
      parseMapEvents(
        [
          event({
            kind: "monster",
            species: "spear_goblin",
            patrolRadius: 64,
            monsterRespawnDelayMs: MONSTER_RESPAWN_DELAY_LIMITS.min - 1,
          }),
        ],
        COLS,
        ROWS,
      ),
    ).toBeNull();
  });

  it("round-trips a fully authored boss", () => {
    const boss = event({
      kind: "monster",
      species: "skull_warden",
      patrolRadius: 1,
      monsterRank: "boss",
      monsterMaxHp: 4_000,
      monsterDamage: 85,
      monsterSpeed: 72 / TILE_SIZE,
      monsterXp: 10_000,
      monsterWeakness: "priest",
      monsterWeaknessPercent: 175,
      monsterSpecialTechnique: "grave_siphon",
      monsterRespawnDelayMs: 90_000,
    });
    expect(parseMapEvents([boss], COLS, ROWS)).toEqual([boss]);
  });

  it("accepts zero-valued tuning and rejects a negative patrol radius", () => {
    const stationary = event({
      kind: "monster",
      species: "spear_goblin",
      patrolRadius: 0,
      monsterMaxHp: 0,
      monsterDamage: 0,
      monsterSpeed: 0,
      monsterXp: 0,
      monsterWeaknessPercent: 0,
    });
    expect(parseMapEvents([stationary], COLS, ROWS)).toEqual([
      expect.objectContaining({
        patrolRadius: 0,
        monsterMaxHp: 0,
        monsterDamage: 0,
        monsterSpeed: 0,
        monsterXp: 0,
        monsterWeaknessPercent: 0,
      }),
    ]);
    expect(
      parseMapEvents(
        [event({ kind: "monster", species: "spear_goblin", patrolRadius: -1 })],
        COLS,
        ROWS,
      ),
    ).toBeNull();
  });

  it("rejects a technique authored for another monster asset", () => {
    const boss = event({
      kind: "monster",
      species: "skull_warden",
      patrolRadius: 96,
      monsterRank: "boss",
      monsterSpecialTechnique: "horn_charge",
    });
    expect(parseMapEvents([boss], COLS, ROWS)).toBeNull();
  });

  it("rejects out-of-range tuning and tuning on a non-monster", () => {
    expect(
      parseMapEvents(
        [
          event({
            kind: "monster",
            species: "skull_warden",
            patrolRadius: 96,
            monsterMaxHp: MONSTER_TUNING_LIMITS.maxHp.max + 1,
          }),
        ],
        COLS,
        ROWS,
      ),
    ).toBeNull();
    expect(parseMapEvents([event({ monsterDamage: 50 })], COLS, ROWS)).toBeNull();
  });
});

describe("parseMapEvents: authored guards", () => {
  const guardPage = (overrides: Partial<MapEventPage> = {}): MapEventPage =>
    page({ moveSpeed: 4, moveFreq: 3, optMoveAnim: true, ...overrides });

  it("accepts conditional pages and a bounded patrol leash", () => {
    const guard = event({
      kind: "guard",
      name: "Renforts des Bois",
      patrolRadius: 160,
      pages: [
        guardPage({
          condSwitchId: "0041",
          graphicAssetId: DEFAULT_GUARD_APPEARANCE_ASSET_ID,
        }),
        guardPage({ condSwitchId: "0042", condVariableId: "0007", condVariableMin: 3 }),
      ],
    });

    expect(parseMapEvents([guard], COLS, ROWS)).toEqual([guard]);
  });

  it("accepts dialogue while rejecting a missing leash or monster tuning", () => {
    expect(parseMapEvents([event({ kind: "guard" })], COLS, ROWS)).toBeNull();
    expect(
      parseMapEvents(
        [event({ kind: "guard", patrolRadius: 96, species: "spear_goblin" })],
        COLS,
        ROWS,
      ),
    ).toBeNull();
    const talkingGuard = event({
      kind: "guard",
      patrolRadius: 96,
      pages: [
        guardPage({
          commands: [{ t: "say", name: "Garde", text: "En position." }],
        }),
      ],
    });
    expect(parseMapEvents([talkingGuard], COLS, ROWS)).toEqual([talkingGuard]);
    const ignoredPageFields: Partial<MapEventPage>[] = [
      { condSelfSwitch: "A" },
      { graphicAssetId: GOOD_ASSET_ID },
      { moveType: "random" },
      { moveSpeed: 3 },
      { moveFreq: 2 },
      { optMoveAnim: false },
      { optStopAnim: true },
      { optDirFix: true },
      { optThrough: true },
      { optOnTop: true },
      { trigger: "player-touch" },
    ];
    for (const ignoredPageField of ignoredPageFields) {
      expect(
        parseMapEvents(
          [
            event({
              kind: "guard",
              patrolRadius: 96,
              pages: [guardPage(ignoredPageField)],
            }),
          ],
          COLS,
          ROWS,
        ),
      ).toBeNull();
    }
  });
});

describe("mutation proofs", () => {
  it("the duplicate-cell case actually depends on the duplicate-cell check", () => {
    // Sanity: two events on different cells with otherwise-identical shape parse fine, so the
    // rejection above is specifically about the shared cell, not some other field.
    const distinct = [event({ id: ID_A, col: 3, row: 3 }), event({ id: ID_B, col: 4, row: 4 })];
    expect(parseMapEvents(distinct, COLS, ROWS)).toEqual(distinct);
  });

  it("the bounds case actually depends on the bounds check", () => {
    // Sanity: the same event just inside the map parses fine, so the rejection above is
    // specifically about being out of bounds, not some other field.
    const inBounds = [event({ col: COLS - 1, row: ROWS - 1 })];
    expect(parseMapEvents(inBounds, COLS, ROWS)).toEqual(inBounds);
  });
});

describe("harvestable map events", () => {
  function harvestable(graphicAssetId: EditorAssetId = TREE_ASSET_ID): MapEvent {
    return event({
      kind: "harvestable",
      name: "Oak",
      harvestProfile: HARVEST_PROFILE,
      pages: [page({ graphicAssetId })],
    });
  }

  it("round-trips an explicit profile while legacy events remain unchanged", () => {
    expect(parseMapEvents([harvestable()], COLS, ROWS)).toEqual([harvestable()]);
    expect(parseMapEvents([event()], COLS, ROWS)?.[0]).not.toHaveProperty("harvestProfile");
  });

  it("never changes resource semantics when only the graphic asset changes", () => {
    const first = parseMapEvents([harvestable(TREE_ASSET_ID)], COLS, ROWS)?.[0];
    const second = parseMapEvents([harvestable(OTHER_TREE_ASSET_ID)], COLS, ROWS)?.[0];

    expect(first?.pages[0]?.graphicAssetId).not.toBe(second?.pages[0]?.graphicAssetId);
    expect(first?.harvestProfile).toEqual(HARVEST_PROFILE);
    expect(second?.harvestProfile).toEqual(HARVEST_PROFILE);
    expect(second?.harvestProfile).toMatchObject({ resource: "wood", tool: "axe" });
  });

  it.each([
    {
      label: "small",
      goldValue: 25,
      hitsRequired: 2,
      oldDuration: 1_000,
      fadeDurationMs: 500,
      wrongAsset: "resource.terrain-resources-gold-gold-stones.gold-stone-6" as const,
      correctedAsset: "resource.terrain-resources-gold-gold-resource.gold-resource" as const,
    },
    {
      label: "large",
      goldValue: 100,
      hitsRequired: 5,
      oldDuration: 1_200,
      fadeDurationMs: 650,
      wrongAsset: "resource.terrain-resources-gold-gold-resource.gold-resource" as const,
      correctedAsset: "resource.terrain-resources-gold-gold-stones.gold-stone-6" as const,
    },
    {
      label: "small with a custom value",
      goldValue: 777,
      hitsRequired: 7,
      oldDuration: 1_000,
      fadeDurationMs: 500,
      wrongAsset: "resource.terrain-resources-gold-gold-stones.gold-stone-6" as const,
      correctedAsset: "resource.terrain-resources-gold-gold-resource.gold-resource" as const,
    },
  ])(
    "normalizes the legacy $label gold preset timing and swapped appearance on read",
    ({ goldValue, hitsRequired, oldDuration, fadeDurationMs, wrongAsset, correctedAsset }) => {
      const legacyGold: HarvestProfile = {
        resource: "gold",
        tool: "pickaxe",
        yieldAmount: 0,
        goldValue,
        hitsRequired,
        range: 88,
        harvestDurationMs: oldDuration,
        exhaustedAssetId: null,
        exhaustionBehavior: "fade",
        respawn: "permanent",
        respawnDelayMs: 0,
        fadeDurationMs,
      };
      const resource = event({
        kind: "harvestable",
        name: "Legacy gold",
        harvestProfile: legacyGold,
        pages: [page({ graphicAssetId: wrongAsset })],
      });
      const parsed = parseMapEvents([resource], COLS, ROWS)?.[0];

      expect(parsed?.harvestProfile).toMatchObject({
        goldValue,
        hitsRequired,
        harvestDurationMs: 0,
        collision: {
          intact: DEFAULT_HARVEST_COLLISIONS.gold.intact,
          depleted: null,
        },
      });
      expect(parsed?.pages[0]?.graphicAssetId).toBe(correctedAsset);

      const alreadyCorrect = parseMapEvents(
        [
          {
            ...resource,
            pages: [page({ graphicAssetId: correctedAsset })],
          },
        ],
        COLS,
        ROWS,
      )?.[0];
      expect(alreadyCorrect?.pages[0]?.graphicAssetId).toBe(correctedAsset);
    },
  );

  it("preserves a custom legacy gold appearance outside the exact swapped pair", () => {
    const legacyGold: HarvestProfile = {
      resource: "gold",
      tool: "pickaxe",
      yieldAmount: 0,
      goldValue: 25,
      hitsRequired: 2,
      range: 88,
      harvestDurationMs: 1_000,
      exhaustedAssetId: null,
      exhaustionBehavior: "fade",
      respawn: "permanent",
      respawnDelayMs: 0,
      fadeDurationMs: 500,
    };
    const customAsset = "resource.terrain-resources-wood-trees.tree4";
    const parsed = parseMapEvents(
      [
        event({
          kind: "harvestable",
          name: "Custom gold",
          harvestProfile: legacyGold,
          pages: [page({ graphicAssetId: customAsset })],
        }),
      ],
      COLS,
      ROWS,
    )?.[0];

    expect(parsed?.pages[0]?.graphicAssetId).toBe(customAsset);
  });

  it("requires a valid profile only on harvestable events", () => {
    expect(parseMapEvents([event({ kind: "harvestable" })], COLS, ROWS)).toBeNull();
    const wrongTool = {
      ...harvestable(),
      harvestProfile: { ...HARVEST_PROFILE, tool: "knife" },
    };
    expect(parseMapEvents([wrongTool], COLS, ROWS)).toBeNull();
    expect(parseMapEvents([event({ harvestProfile: HARVEST_PROFILE })], COLS, ROWS)).toBeNull();
  });

  it("accepts a valid profile whose explicit footprint crosses the map boundary", () => {
    const crossing = {
      ...harvestable(),
      col: 0,
      harvestProfile: {
        ...HARVEST_PROFILE,
        collision: {
          ...DEFAULT_HARVEST_COLLISIONS.wood,
          intact: { offsetX: -40, offsetY: -30, width: 64, height: 30 },
        },
      },
    };
    expect(parseMapEvents([crossing], COLS, ROWS)).not.toBeNull();
    expect(parseMapEvents([{ ...crossing, col: 1 }], COLS, ROWS)).not.toBeNull();
  });

  it("rejects movement options that the stationary resource runtime would ignore", () => {
    expect(
      parseMapEvents(
        [harvestable()].map((resource) => ({
          ...resource,
          pages: [page({ graphicAssetId: TREE_ASSET_ID, moveType: "random" })],
        })),
        COLS,
        ROWS,
      ),
    ).toBeNull();
    expect(
      parseMapEvents(
        [harvestable()].map((resource) => ({
          ...resource,
          pages: [
            page({
              graphicAssetId: TREE_ASSET_ID,
              moveType: "fixed",
              moveRoute: [{ offsetCol: 1, offsetRow: 0, waitMs: 0 }],
            }),
          ],
        })),
        COLS,
        ROWS,
      ),
    ).toBeNull();
    expect(
      parseMapEvents(
        [harvestable()].map((resource) => ({
          ...resource,
          pages: [page({ graphicAssetId: TREE_ASSET_ID, optThrough: true })],
        })),
        COLS,
        ROWS,
      ),
    ).toBeNull();
  });

  it("supports the functional-event helper and narrows configured resources", () => {
    const resource = functionalEvent({
      id: ID_B,
      col: 2,
      row: 3,
      ordinal: 4,
      name: "Tree",
      kind: "harvestable",
      harvestProfile: HARVEST_PROFILE,
      graphicAssetId: TREE_ASSET_ID,
    });

    expect(resource).toMatchObject({ kind: "harvestable", harvestProfile: HARVEST_PROFILE });
    expect(harvestableEvents([event(), resource])).toEqual([resource]);
    expect(isActiveWorldEventKind("harvestable")).toBe(true);
    expect(isInteractiveWorldEventKind("harvestable")).toBe(false);
  });

  it("rejects every active resource page without an intact appearance", () => {
    const invisible = harvestable();
    expect(
      parseMapEvents([{ ...invisible, pages: [page({ graphicAssetId: null })] }], COLS, ROWS),
    ).toBeNull();
    expect(parseMapEvents([event()], COLS, ROWS)).not.toBeNull();
  });
});
