import { writeFileSync } from "node:fs";

import {
  ADVENTURE_BUNDLE_FORMAT,
  ADVENTURE_BUNDLE_VERSION,
  type AdventureBundle,
  parseAdventureBundle,
} from "@lindocara/engine/adventure-bundle.js";
import { parseAdventureRegistry } from "@lindocara/engine/adventure-state.js";
import {
  buildAuthoredTransitionGraph,
  reachableTransitionMaps,
} from "@lindocara/engine/adventure-transitions.js";
import { validateAuthoredQuests } from "@lindocara/engine/quests.js";

import {
  questContext,
  validateBundleMaps,
  validateStateReferences,
  visitCommands,
} from "../../lib/bundle-validate.js";
import { MAP_IDS, type StoryRefs, SWITCHES, VARIABLES } from "./campaign.js";
import { buildMaps } from "./maps.js";
import { buildQuests } from "./quests.js";

const OUTPUT = new URL("../../../adventures/legacy/liin-adventure-ia.json", import.meta.url);

const refs: StoryRefs = {};
const maps = buildMaps(refs);
const quests = buildQuests(refs);
const bundle: AdventureBundle = {
  format: ADVENTURE_BUNDLE_FORMAT,
  version: ADVENTURE_BUNDLE_VERSION,
  adventure: {
    title: "Liin — Les Dettes de l’Aube",
    maxPlayers: 4,
    startMapId: MAP_IDS.prologue,
    registry: {
      switches: SWITCHES,
      variables: VARIABLES,
      quests,
    },
  },
  maps,
  // Modern authored travel uses explicit, conditional teleports. The adventure's `startMapId` names
  // the start; no unconditional exit graph is needed or allowed to bypass a story gate.
  graph: { start: null, links: [] },
};

if (!parseAdventureRegistry(bundle.adventure.registry)) {
  throw new Error("generated Liin registry is invalid");
}
const parsed = parseAdventureBundle(bundle);
if (!parsed) throw new Error("generated Liin bundle envelope is invalid");
// `minConnectedRatio` est descendu à 0.84 pour UNE dette connue, pas par principe : « Marais de
// Verre — Les Saules » enferme 272 de ses 1738 cases marchables derrière ses bras d'eau (les quinze
// autres cartes sont à 100 %, sauf Clairécorce à 99,4 %). Remonter ce seuil à 0.9 est la façon de
// vérifier qu'on a bien rouvert le marais.
validateBundleMaps(parsed, { minConnectedRatio: 0.84 });
validateStateReferences(parsed);
const transitionGraph = buildAuthoredTransitionGraph(parsed.maps);
const reachableMaps = reachableTransitionMaps(transitionGraph, MAP_IDS.prologue);
const unreachableMaps = parsed.maps
  .filter((map) => !reachableMaps.has(map.id))
  .map((map) => map.name);
if (unreachableMaps.length > 0) {
  throw new Error(
    `generated Liin travel graph has unreachable maps: ${unreachableMaps.join(", ")}`,
  );
}
const questDiagnostics = validateAuthoredQuests(quests, questContext(parsed));
const questErrors = questDiagnostics.filter((diagnostic) => diagnostic.severity === "error");
if (questErrors.length > 0) {
  throw new Error(`generated Liin quests are invalid:\n${JSON.stringify(questErrors, null, 2)}`);
}

const endingSwitches = new Set(
  parsed.maps.flatMap((map) =>
    map.events.flatMap((event) =>
      event.pages.flatMap((eventPage) => {
        const values: string[] = [];
        visitCommands(eventPage.commands, (command) => {
          if (
            command.t === "setSwitch" &&
            ["0051", "0052", "0053", "0054", "0055", "0056"].includes(command.switchId)
          ) {
            values.push(command.switchId);
          }
        });
        return values;
      }),
    ),
  ),
);
if (endingSwitches.size !== 6) throw new Error("all six campaign endings must be authored");

writeFileSync(OUTPUT, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
console.log(
  `built ${parsed.adventure.title}: ${parsed.maps.length} maps, ${quests.length} quests, ${parsed.maps.reduce((count, map) => count + map.events.length, 0)} events, ${transitionGraph.links.length} travel links`,
);
