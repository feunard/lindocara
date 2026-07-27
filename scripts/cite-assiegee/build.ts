/**
 * Build and validate "La Cité assiégée".
 *
 * Usage:
 *   npm run adventure:build:city
 *
 * Rendering is deliberately separate (`npm run adventure:render -- adventures/cite-assiegee.json`)
 * so CI can validate the deterministic source bundle without requiring image output.
 */
import { writeFileSync } from "node:fs";
import {
  ADVENTURE_BUNDLE_FORMAT,
  ADVENTURE_BUNDLE_VERSION,
  type AdventureBundle,
  parseAdventureBundle,
} from "@lindocara/engine/adventure-bundle.js";
import { parseAdventureRegistry } from "@lindocara/engine/adventure-state.js";
import { CURATED_MONSTER_SPECIES } from "@lindocara/engine/game.js";
import {
  validateBundleMaps,
  validateStateReferences,
  visitCommands,
} from "../lib/bundle-validate.js";
import { type StoryRefs, SWITCHES, VARIABLES } from "./campaign.js";
import { buildMaps } from "./maps.js";

const OUTPUT = new URL("../../adventures/cite-assiegee.json", import.meta.url);
const refs: StoryRefs = {};
const maps = buildMaps(refs);

const bundle: AdventureBundle = {
  format: ADVENTURE_BUNDLE_FORMAT,
  version: ADVENTURE_BUNDLE_VERSION,
  adventure: {
    title: "La Cité assiégée",
    maxPlayers: 4,
    audio: {
      music: "bards-tale",
      ambience: "forest-ambience",
      combatMusic: "battle-theme",
    },
    registry: { switches: SWITCHES, variables: VARIABLES, quests: [] },
  },
  maps,
  graph: { start: null, links: [] },
};

if (!parseAdventureRegistry(bundle.adventure.registry)) {
  throw new Error("le registre de La Cité assiégée est invalide");
}
const parsed = parseAdventureBundle(bundle);
if (!parsed) throw new Error("l’enveloppe de La Cité assiégée est invalide");

validateBundleMaps(parsed, {
  minTraversableRatio: 0.3,
  minConnectedRatio: 0.99,
  maxCutOffCells: 12,
});
validateStateReferences(parsed);

const monsters = parsed.maps.flatMap((map) =>
  map.events.filter((event) => event.kind === "monster"),
);
const usedSpecies = new Set(monsters.flatMap((event) => (event.species ? [event.species] : [])));
const missingSpecies = CURATED_MONSTER_SPECIES.filter((species) => !usedSpecies.has(species));
if (missingSpecies.length > 0) {
  throw new Error(`espèces runtime inutilisées : ${missingSpecies.join(", ")}`);
}
const timed = monsters.filter((event) => event.monsterRespawnMode !== "never");
if (timed.length > 0) {
  throw new Error(`les rencontres de campagne doivent être définitives : ${timed[0]?.name}`);
}
const bosses = monsters.filter((event) => event.monsterRank === "boss");
if (
  bosses.length !== 2 ||
  bosses[0]?.species !== "minotaur_brute" ||
  bosses[1]?.species !== "gate_troll"
) {
  throw new Error("les deux boss attendus (minotaure puis troll de porte) sont absents");
}

let teleportCount = 0;
let falseTeleportCount = 0;
let endingCount = 0;
for (const map of parsed.maps) {
  if (map.events.length > 64) throw new Error(`${map.name}: plus de 64 événements`);
  for (const event of map.events) {
    for (const eventPage of event.pages) {
      visitCommands(eventPage.commands, (command) => {
        if (command.t === "teleport") {
          teleportCount += 1;
          if (command.category === "puzzle") falseTeleportCount += 1;
        }
        if (command.t === "endAdventure") endingCount += 1;
      });
    }
  }
}
if (teleportCount < 12 || falseTeleportCount < 2) {
  throw new Error(
    `réseau de portes insuffisant : ${teleportCount} téléportations, ${falseTeleportCount} trompeuses`,
  );
}
if (endingCount !== 1) throw new Error(`une conclusion attendue, trouvé ${endingCount}`);

writeFileSync(OUTPUT, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
console.log(
  `construit « ${parsed.adventure.title} » : ${parsed.maps.length} cartes, ` +
    `${monsters.length} monstres définitifs, ` +
    `${parsed.maps.reduce((total, map) => total + map.events.length, 0)} événements, ` +
    `${parsed.maps.reduce((total, map) => total + map.elements.length, 0)} décors`,
);
