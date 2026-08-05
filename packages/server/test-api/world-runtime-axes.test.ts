import { starterEquipmentFor } from "@lindocara/engine/character.js";
import type { PlayerProfile } from "@lindocara/server/profile-types.js";
import {
  createGuards,
  createMonsters,
  newPlayer,
  toAttachment,
  toProfile,
} from "@lindocara/server/world/world-runtime.js";
import { describe, expect, it } from "vitest";

/**
 * The axis convention this whole increment turns on: `x` and `z` are the two GROUND axes and `y`
 * is ELEVATION, in tile units with the grid centre as the origin. The dying pixel world used
 * `x`/`y` for the ground and had no elevation at all, so a rename that forgets to add the third
 * axis — or that leaves `y` meaning ground anywhere — typechecks cleanly and puts the world on
 * its side. Nothing in a screenshot would show it; these assertions are the thing that would.
 */
function profile(id: string): PlayerProfile {
  return {
    id,
    nick: id,
    x: 0,
    y: 0,
    z: 0,
    level: 10,
    xp: 0,
    hp: 100,
    appearance: { body: "wayfarer", primaryColor: "azure" },
    class: "warrior",
    equipment: starterEquipmentFor("warrior"),
    inventory: { potions: 0, gold: 0, crystals: 0 },
    quest: { chapter: "three_offerings", status: "available", progress: 0, target: 3 },
    zoneId: "map-a",
    instanceId: "main",
    sessionEpoch: 1,
    wardRunExpiresAt: null,
    life: "alive",
    corpse: null,
  };
}

describe("runtime entities use ground x/z and elevation y", () => {
  it("gives a fresh player three axes", () => {
    const player = newPlayer(profile("hero-1"), "connection-1", "party-a:map-a");
    expect(player).toMatchObject({
      x: expect.any(Number),
      y: expect.any(Number),
      z: expect.any(Number),
    });
  });

  it("round-trips all three axes through the attachment", () => {
    const player = newPlayer(profile("hero-1"), "connection-1", "party-a:map-a");
    player.x = -3.5;
    player.y = 1;
    player.z = 7.25;
    const restored = toAttachment(player);
    expect(restored).toMatchObject({ x: -3.5, y: 1, z: 7.25 });
  });

  it("round-trips all three axes through the saved profile", () => {
    // `toAttachment` builds on `toProfile`, so a `z` added only to the attachment would still
    // drop the second ground axis on the way to the database. Both boundaries are asserted.
    const player = newPlayer(profile("hero-1"), "connection-1", "party-a:map-a");
    player.x = -3.5;
    player.y = 1;
    player.z = 7.25;
    expect(toProfile(player)).toMatchObject({ x: -3.5, y: 1, z: 7.25 });
  });

  it("gives a fresh monster three axes and remembers its spawn on the ground plane", () => {
    const monster = createMonsters([
      {
        id: "test-goblin",
        kind: "goblin",
        species: "spear_goblin",
        zone: "route",
        x: 2.5,
        z: -4,
        patrolRadius: 3,
      },
    ])[0];
    if (!monster) throw new Error("missing monster");
    expect(monster).toMatchObject({ x: 2.5, y: 0, z: -4, spawnX: 2.5, spawnZ: -4 });
    // Ground velocity follows the same plane: there is no `vy` on the ground any more.
    expect(monster).toMatchObject({ vx: 0, vz: 0 });
  });

  it("gives a fresh guard three axes and a ground-plane home", () => {
    const guard = createGuards([{ id: "guard-1", x: 1.5, z: -2.25, patrolRadius: 4 }])[0];
    if (!guard) throw new Error("missing guard");
    expect(guard).toMatchObject({ x: 1.5, y: 0, z: -2.25, homeX: 1.5, homeZ: -2.25 });
  });
});
