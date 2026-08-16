/**
 * Construit « La Baie des Cent Voiles » en un bundle JSON portable, et refuse de l'écrire s'il n'est
 * pas jouable.
 *
 *   yarn adventure:build:baie              # écrit adventures/baie-cent-voiles.json
 *   yarn adventure:build:baie --preview # + un aperçu ASCII de chaque carte
 *
 * Rien ici ne touche au réseau : la publication est le travail de `scripts/adventure-io.ts`. Ce
 * script ne fait qu'une chose — transformer le contenu écrit à la main en bundle validé, avec les
 * mêmes parseurs que le serveur plus les contrôles de jouabilité que le serveur, lui, ne fait pas.
 */
import { writeFileSync } from "node:fs";
import {
  ADVENTURE_BUNDLE_FORMAT,
  ADVENTURE_BUNDLE_VERSION,
  type AdventureBundle,
  parseAdventureBundle,
} from "@lindocara/engine/adventure-bundle.js";
import { parseAdventureRegistry } from "@lindocara/engine/adventure-state.js";
import { parseMapData } from "@lindocara/engine/map-data.js";
import { validateAuthoredQuests } from "@lindocara/engine/quests.js";
import {
  questContext,
  validateBundleMaps,
  validateStateReferences,
  visitCommands,
} from "../../lib/bundle-validate.js";
import { MAP_IDS, S, type StoryRefs, SWITCHES, VARIABLES } from "./campaign.js";
import { buildMaps } from "./maps.js";
import { buildQuests } from "./quests.js";
import { previewScene } from "./scenery.js";

const OUTPUT = new URL("../../../adventures/legacy/baie-cent-voiles.json", import.meta.url);

const refs: StoryRefs = {};
const maps = buildMaps(refs);
const quests = buildQuests(refs);

const bundle: AdventureBundle = {
  format: ADVENTURE_BUNDLE_FORMAT,
  version: ADVENTURE_BUNDLE_VERSION,
  adventure: {
    title: "La Baie des Cent Voiles",
    maxPlayers: 4,
    startMapId: MAP_IDS.wrecks,
    registry: { switches: SWITCHES, variables: VARIABLES, quests },
  },
  maps,
  // No exit graph: every crossing is an authored boat whose conditional page decides whether it
  // sails. The party's starting map is named explicitly above, not derived from an event.
  graph: { start: null, links: [] },
};

if (!parseAdventureRegistry(bundle.adventure.registry)) {
  throw new Error("le registre de la Baie est invalide");
}
const parsed = parseAdventureBundle(bundle);
if (!parsed) throw new Error("l’enveloppe du bundle de la Baie est invalide");

// Un archipel est légitimement fait de mer : le plancher de densité descend, mais la CONNEXITÉ,
// elle, est exigée au maximum — aucune île, terrasse ni cour ne doit rester sans accès.
validateBundleMaps(parsed, {
  minTraversableRatio: 0.28,
  minConnectedRatio: 1,
  // Quelques recoins d'une case derrière un tronc de bosquet : du bruit, pas une île enfermée.
  maxCutOffCells: 4,
});
validateStateReferences(parsed);

const diagnostics = validateAuthoredQuests(quests, questContext(parsed));
const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "error");
if (errors.length > 0) {
  throw new Error(`quêtes invalides :\n${JSON.stringify(errors, null, 2)}`);
}
const warnings = diagnostics.filter((diagnostic) => diagnostic.severity === "warning");
for (const warning of warnings) console.warn(`avertissement quête : ${JSON.stringify(warning)}`);

// Les trois fins doivent exister quelque part, sinon la campagne n'a pas de sortie.
const endings = new Set<string>();
for (const map of parsed.maps) {
  for (const event of map.events) {
    for (const eventPage of event.pages) {
      visitCommands(eventPage.commands, (command) => {
        if (
          command.t === "setSwitch" &&
          [S.endingRelit, S.endingShattered, S.endingEvacuated].includes(
            command.switchId as (typeof S)["endingRelit"],
          )
        ) {
          endings.add(command.switchId);
        }
      });
    }
  }
}
if (endings.size !== 3)
  throw new Error(`les trois fins doivent être authorées (trouvé ${endings.size})`);

if (process.argv.includes("--preview")) {
  for (const map of parsed.maps) {
    const data = parseMapData(map);
    if (!data) continue;
    console.log(`\n### ${map.name} — ${map.cols}x${map.rows}, ${map.events.length} événements`);
    console.log(previewScene(data.layers, data.cols, data.rows, [...data.elements]));
  }
}

writeFileSync(OUTPUT, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
console.log(
  `construit « ${parsed.adventure.title} » : ${parsed.maps.length} cartes, ${quests.length} quêtes, ` +
    `${parsed.maps.reduce((count, map) => count + map.events.length, 0)} événements, ` +
    `${parsed.maps.reduce((count, map) => count + map.elements.length, 0)} décors`,
);
