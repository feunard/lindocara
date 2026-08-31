import { EVENT_PRESETS, presetEvent, presetPageContent } from "@lindocara/engine/event-presets.js";
import {
  RUNNER_HERO_SPEED,
  RUNNER_PURSUER_PROFILES,
  RUNNER_PURSUER_TUNING,
} from "@lindocara/engine/game.js";
import { isUuid } from "@lindocara/engine/identifiers.js";
import { parseMapEvents } from "@lindocara/engine/map-events.js";
import {
  LINDOCARA_CHEST_CLOSED_ASSET_ID,
  LINDOCARA_CHEST_OPEN_ASSET_ID,
  LINDOCARA_PICKUP_ASSET_IDS,
  LINDOCARA_RUNNER_ASSET_IDS,
  RETIRED_RUNNER_HOUND_ASSET_ID,
} from "@lindocara/engine/tiny-swords-catalog.js";
import { describe, expect, it } from "vitest";

const MAP_ID = "11111111-1111-4111-8111-111111111111";

describe("presetPageContent", () => {
  it("raw is the blank scripted event (the historical default)", () => {
    expect(presetPageContent("raw", MAP_ID)).toEqual({ trigger: "action", commands: [] });
  });

  it("teleporter carries a player-touch trigger and a same-map teleport command", () => {
    const { trigger, commands } = presetPageContent("teleporter", MAP_ID);
    expect(trigger).toBe("player-touch");
    expect(commands).toEqual([
      { t: "teleport", mapId: MAP_ID, col: 0, row: 0, category: "geographic" },
    ]);
  });

  it("aims a fresh teleporter at the map's own spawn, not at the (0,0) corner", () => {
    // (0, 0) is a corner, and the runtime silently refuses a teleport onto unwalkable ground — on any
    // map with a decorated border that placeholder does nothing and only warns into the server log.
    // A map's spawn is the one cell the editor guarantees stays clear.
    const { commands } = presetPageContent("teleporter", MAP_ID, { col: 7, row: 4 });
    expect(commands).toEqual([
      { t: "teleport", mapId: MAP_ID, col: 7, row: 4, category: "geographic" },
    ]);
  });

  it("sign carries an interact-triggered say; chest a changeGold", () => {
    expect(presetPageContent("sign", MAP_ID)).toEqual({
      trigger: "action",
      commands: [{ t: "say", text: "" }],
    });
    expect(presetPageContent("chest", MAP_ID).commands).toEqual([{ t: "changeGold", amount: 10 }]);
  });

  it("trap carries a touch-triggered editable damage command", () => {
    expect(presetPageContent("trap", MAP_ID)).toEqual({
      trigger: "player-touch",
      commands: [{ t: "damage", amount: 25, lethal: false }],
    });
  });

  it("push and launch traps carry movement only and never damage", () => {
    expect(presetPageContent("push-trap", MAP_ID)).toEqual({
      trigger: "player-touch",
      commands: [{ t: "trapImpulse", impulse: "push", power: 2.5 }],
    });
    expect(presetPageContent("launch-trap", MAP_ID)).toEqual({
      trigger: "player-touch",
      commands: [{ t: "trapImpulse", impulse: "launch", power: 13 }],
    });
    for (const preset of ["push-trap", "launch-trap"] as const) {
      expect(
        presetPageContent(preset, MAP_ID).commands.some((command) => command.t === "damage"),
      ).toBe(false);
    }
  });
});

describe("presetEvent", () => {
  it("gives runner pigs distinct profiles whose ceilings remain below the hero", () => {
    const profiles = Object.values(RUNNER_PURSUER_PROFILES);
    expect(new Set(profiles.map((profile) => JSON.stringify(profile))).size).toBe(3);
    expect(profiles.every((profile) => profile.maxSpeed < RUNNER_HERO_SPEED)).toBe(true);
    expect(RUNNER_PURSUER_TUNING).toBe(RUNNER_PURSUER_PROFILES.pursuer);
  });

  it("builds a normal, single-page, uuid-identified event out of the preset", () => {
    const event = presetEvent({
      id: crypto.randomUUID(),
      col: 2,
      row: 3,
      ordinal: 1,
      preset: "teleporter",
      selfMapId: MAP_ID,
    });
    expect(event.kind).toBe("normal");
    expect(isUuid(event.id)).toBe(true);
    expect(event.pages).toHaveLength(1);
    expect(event.pages[0]?.commands).toEqual([
      { t: "teleport", mapId: MAP_ID, col: 0, row: 0, category: "geographic" },
    ]);
  });

  it("carries the placement's name so the event list can tell the presets apart", () => {
    // Without this every preset lists as the generic kind fallback ("Custom event"), and an author
    // cannot see which of five identical rows is the teleporter. The name is authored data in the
    // author's own language, so the editor supplies it already localized.
    const named = presetEvent({
      id: crypto.randomUUID(),
      col: 2,
      row: 3,
      ordinal: 1,
      preset: "chest",
      selfMapId: MAP_ID,
      name: "Téléporteur",
    });
    expect(named.name).toBe("Téléporteur");
    expect(named.pages).toMatchObject([
      {
        graphicAssetId: LINDOCARA_CHEST_CLOSED_ASSET_ID,
        commands: [
          { t: "changeGold", amount: 10 },
          { t: "setSelfSwitch", selfSwitch: "A", value: true },
        ],
      },
      {
        graphicAssetId: LINDOCARA_CHEST_OPEN_ASSET_ID,
        condSelfSwitch: "A",
      },
    ]);
    expect(parseMapEvents([named], 20, 15)).not.toBeNull();
    // Omitted stays the historical unnamed event, so `raw` placements are unaffected.
    const anonymous = presetEvent({
      id: crypto.randomUUID(),
      col: 2,
      row: 3,
      ordinal: 1,
      preset: "raw",
      selfMapId: MAP_ID,
    });
    expect(anonymous.name).toBe("");
  });

  it("creates ready-to-edit runner trap and pursuer events", () => {
    const trap = presetEvent({
      id: crypto.randomUUID(),
      col: 2,
      row: 3,
      ordinal: 1,
      preset: "trap",
      selfMapId: MAP_ID,
    });
    expect(trap).toMatchObject({
      kind: "normal",
      showMarker: false,
      pages: [
        {
          trigger: "player-touch",
          graphicAssetId: LINDOCARA_RUNNER_ASSET_IDS.spikeTrap,
          commands: [{ t: "damage", amount: 25, lethal: false }],
        },
      ],
    });

    for (const [preset, graphicAssetId, impulse, power] of [
      ["push-trap", LINDOCARA_RUNNER_ASSET_IDS.pushTrap, "push", 2.5],
      ["launch-trap", LINDOCARA_RUNNER_ASSET_IDS.launchTrap, "launch", 13],
    ] as const) {
      const movementTrap = presetEvent({
        id: crypto.randomUUID(),
        col: 3,
        row: 3,
        ordinal: 2,
        preset,
        selfMapId: MAP_ID,
      });
      expect(movementTrap).toMatchObject({
        showMarker: false,
        pages: [
          {
            trigger: "player-touch",
            graphicAssetId,
            commands: [{ t: "trapImpulse", impulse, power }],
          },
        ],
      });
      expect(parseMapEvents([movementTrap], 20, 15)).not.toBeNull();
    }

    const pursuer = presetEvent({
      id: crypto.randomUUID(),
      col: 4,
      row: 3,
      ordinal: 2,
      preset: "pursuer",
      selfMapId: MAP_ID,
    });
    expect(pursuer).toMatchObject({
      kind: "monster",
      species: "war_pig",
      showMarker: false,
      monsterAttackProfile: "melee",
      monsterPursuitMode: "relentless",
      monsterSpeed: RUNNER_PURSUER_TUNING.speed,
      monsterAcceleration: RUNNER_PURSUER_TUNING.acceleration,
      monsterMaxSpeed: RUNNER_PURSUER_TUNING.maxSpeed,
      monsterOneHitKill: true,
      pages: [{ graphicAssetId: null }],
    });
  });

  it("creates floating reusable movement pickups with dedicated art", () => {
    const pickup = presetEvent({
      id: crypto.randomUUID(),
      col: 5,
      row: 3,
      ordinal: 3,
      preset: "pickup-double-jump",
      selfMapId: MAP_ID,
    });

    expect(pickup).toMatchObject({
      kind: "normal",
      showMarker: false,
      pages: [
        {
          trigger: "player-touch",
          graphicAssetId: LINDOCARA_PICKUP_ASSET_IDS.double_jump,
          graphicElevation: 0.55,
          optFloat: true,
          commands: [{ t: "movementEffect", effect: "double_jump", durationMs: 9_000, power: 1 }],
        },
      ],
    });
    expect(parseMapEvents([pickup], 20, 15)).not.toBeNull();
  });

  it("migrates the retired runner hound appearance to the species-owned pig model", () => {
    const pursuer = presetEvent({
      id: crypto.randomUUID(),
      col: 4,
      row: 3,
      ordinal: 2,
      preset: "pursuer",
      selfMapId: MAP_ID,
    });
    const parsed = parseMapEvents(
      [
        {
          ...pursuer,
          pages: [{ ...pursuer.pages[0], graphicAssetId: RETIRED_RUNNER_HOUND_ASSET_ID }],
        },
      ],
      20,
      15,
    );

    expect(parsed?.[0]?.pages[0]?.graphicAssetId).toBeNull();
  });

  it("every preset produces an event the wire parser accepts (a real scripted event)", () => {
    for (const preset of EVENT_PRESETS) {
      const event = presetEvent({
        id: crypto.randomUUID(),
        col: 1,
        row: 1,
        ordinal: 1,
        preset,
        selfMapId: MAP_ID,
      });
      // The server re-parses events off the wire; a preset must never mint one it would reject.
      expect(parseMapEvents([event], 20, 15)).not.toBeNull();
    }
  });
});
