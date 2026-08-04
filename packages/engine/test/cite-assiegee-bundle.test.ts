import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type AdventureBundle, parseAdventureBundle } from "../src/adventure-bundle.js";
import type { EventCommand } from "../src/event-commands.js";
import { CURATED_MONSTER_SPECIES } from "../src/game.js";

const BUNDLE_URL = new URL("../../../adventures/legacy/cite-assiegee.json", import.meta.url);
const parsedBundle = parseAdventureBundle(JSON.parse(readFileSync(BUNDLE_URL, "utf8")));
if (!parsedBundle) throw new Error("The generated Cité assiégée bundle is invalid");
const BUNDLE: AdventureBundle = parsedBundle;

function commands(): EventCommand[] {
  const result: EventCommand[] = [];
  const visit = (command: EventCommand) => {
    result.push(command);
    if (command.t === "if") {
      command.then.forEach(visit);
      command.else.forEach(visit);
    } else if (command.t === "loop") {
      command.body.forEach(visit);
    } else if (command.t === "choices") {
      command.options.forEach((option) => {
        option.body.forEach(visit);
      });
    }
  };
  for (const map of BUNDLE.maps) {
    for (const event of map.events) {
      for (const eventPage of event.pages) eventPage.commands.forEach(visit);
    }
  }
  return result;
}

describe("La Cité assiégée generated bundle", () => {
  it("contains the five dense progression maps and their authored soundscapes", () => {
    expect(BUNDLE.maps.map((map) => map.name)).toEqual([
      "La Route cachée",
      "La Ville basse",
      "Les Fondations",
      "La Ville haute",
      "La Cour centrale",
    ]);
    expect(BUNDLE.adventure.audio).toEqual({
      music: "bards-tale",
      ambience: "forest-ambience",
      combatMusic: "battle-theme",
    });
    expect(BUNDLE.maps.map((map) => map.audio?.music)).toEqual([
      "bards-tale",
      "town-theme",
      "dungeon-ambience",
      "town-theme",
      "bards-tale",
    ]);
    expect(BUNDLE.maps.every((map) => map.events.length <= 64)).toBe(true);
    expect(
      BUNDLE.maps.find((map) => map.name === "La Ville basse")?.elements.length,
    ).toBeGreaterThan(80);
    expect(
      BUNDLE.maps.find((map) => map.name === "La Ville haute")?.elements.length,
    ).toBeGreaterThan(80);
  });

  it("uses every runtime species, permanent deaths, ranks, weaknesses and real techniques", () => {
    const monsters = BUNDLE.maps.flatMap((map) =>
      map.events.filter((event) => event.kind === "monster"),
    );
    expect(monsters).toHaveLength(92);
    expect(new Set(monsters.map((event) => event.species))).toEqual(
      new Set(CURATED_MONSTER_SPECIES),
    );
    expect(monsters.every((event) => event.monsterRespawnMode === "never")).toBe(true);
    expect(new Set(monsters.map((event) => event.monsterRank))).toEqual(
      new Set(["normal", "elite", "boss"]),
    );
    expect(monsters.some((event) => event.monsterWeakness !== "none")).toBe(true);

    const bosses = monsters.filter((event) => event.monsterRank === "boss");
    expect(
      bosses.map((event) => [
        event.name,
        event.species,
        event.monsterSpecialTechnique,
        event.monsterMaxHp,
      ]),
    ).toEqual([
      ["Le Gardien des galeries", "minotaur_brute", "horn_charge", 720],
      ["Le Briseur de portes", "gate_troll", "troll_quake", 980],
    ]);
  });

  it("authors successive waves, true/secondary/false teleporters and one reachable ending", () => {
    const court = BUNDLE.maps.find((map) => map.name === "La Cour centrale");
    if (!court) throw new Error("missing court");
    const siegeMonsters = court.events.filter(
      (event) => event.kind === "monster" && event.pages[0]?.condVariableId === "0006",
    );
    expect(new Set(siegeMonsters.map((event) => event.pages[0]?.condVariableMin))).toEqual(
      new Set([0, 3, 6, 10, 13]),
    );
    expect(siegeMonsters).toHaveLength(18);
    expect(
      court.events.filter(
        (event) => event.kind === "monster" && event.pages[0]?.condVariableId === "0010",
      ),
    ).toHaveLength(3);

    const allCommands = commands();
    const teleports = allCommands.filter(
      (command): command is Extract<EventCommand, { t: "teleport" }> => command.t === "teleport",
    );
    expect(teleports.length).toBeGreaterThanOrEqual(12);
    expect(
      teleports.filter((command) => command.category === "puzzle").length,
    ).toBeGreaterThanOrEqual(2);
    expect(teleports.some((command) => command.category === "shortcut")).toBe(true);
    expect(teleports.some((command) => command.category === "recovery")).toBe(true);
    expect(allCommands.filter((command) => command.t === "endAdventure")).toHaveLength(1);
  });
});
