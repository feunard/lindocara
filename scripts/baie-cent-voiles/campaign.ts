/**
 * « La Baie des Cent Voiles » — le socle de la campagne.
 *
 * Ce fichier ne dessine rien et ne raconte rien : il tient les IDENTITÉS (uuids déterministes des
 * cartes et des événements), le vocabulaire d'authoring (une commande = une petite fonction lisible)
 * et le REGISTRE d'état — les switches et variables nommés que les pages conditionnelles et les
 * quêtes citent par leur ordinal `0001`.
 *
 * Tout est déterministe : les uuids viennent d'un sha256 du nom logique, jamais de `crypto.randomUUID`.
 * Reconstruire le bundle deux fois doit produire le même octet, sinon « rejouer le build » devient un
 * diff illisible et l'import en production recrée une aventure au lieu d'en reconnaître une.
 */
import { createHash } from "node:crypto";
import type { EventCommand } from "@lindocara/engine/event-commands.js";
import type { MonsterSpecies, MonsterTuning } from "@lindocara/engine/game.js";
import {
  defaultEventPage,
  functionalEvent,
  type MapEvent,
  type MapEventPage,
} from "@lindocara/engine/map-events.js";
import type { EditorAssetId } from "@lindocara/engine/tiny-swords-catalog.js";

export const MAP_IDS = {
  wrecks: stableUuid("map:greve-des-epaves"),
  port: stableUuid("map:port-fanal"),
  reefs: stableUuid("map:ilot-des-brisants"),
  marsh: stableUuid("map:marais-de-sel"),
  lighthouse: stableUuid("map:phare-de-malemer"),
  battle: stableUuid("map:les-cent-voiles"),
} as const;

export type MapKey = keyof typeof MAP_IDS;

/** Les silhouettes Tiny Swords utilisées comme portraits d'événement. Une couleur = une allégeance :
 *  bleu la baie, jaune les pêcheurs, rouge les naufragés, violet le gardien, noir les pillards. */
export const GRAPHICS = {
  ondine: "character.units-blue-units-archer.archer-idle",
  bosco: "character.units-blue-units-warrior.warrior-idle",
  mila: "character.units-yellow-units-pawn.pawn-idle",
  aldemar: "character.units-purple-units-monk.idle",
  saline: "character.units-yellow-units-monk.idle",
  merchant: "character.units-blue-units-pawn.pawn-idle-gold",
  carpenter: "character.units-blue-units-pawn.pawn-idle-hammer",
  woodcutter: "character.units-yellow-units-pawn.pawn-idle-axe",
  castaway: "character.units-red-units-pawn.pawn-idle-wood",
  fisher: "character.units-yellow-units-pawn.pawn-idle",
  guardBlue: "character.units-blue-units-lancer.lancer-idle",
  archerBlue: "character.units-blue-units-archer.archer-idle",
  varn: "character.units-black-units-lancer.lancer-idle",
  sign: "decoration.deco.17",
  chest: "resource.resources-resources.g-idle",
  crate: "resource.terrain-resources-tools.tool-02",
  boat: "decoration.terrain-decorations-rubber-duck.rubber-duck",
  flame: "resource.resources-resources.m-idle",
  valve: "decoration.deco.11",
} as const satisfies Record<string, EditorAssetId>;

/** Les événements nommés que les quêtes doivent pouvoir citer après coup (`refs["port.ondine"]`). */
export type StoryRefs = Record<string, MapEvent>;

export function stableUuid(key: string): string {
  const hex = createHash("sha256").update(`baie-des-cent-voiles:${key}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function cell(col: number, row: number): { col: number; row: number } {
  return { col, row };
}

// ---------------------------------------------------------------------------
// Le vocabulaire d'authoring : une commande = une fonction courte et lisible.
// ---------------------------------------------------------------------------

export function page(
  commands: readonly EventCommand[] = [],
  options: Partial<MapEventPage> = {},
): MapEventPage {
  return { ...defaultEventPage(), ...options, commands };
}

export function say(name: string | null, text: string): EventCommand {
  return { t: "say", name, text };
}

export function choice(
  prompt: string,
  options: readonly { label: string; body: readonly EventCommand[] }[],
): EventCommand {
  return { t: "choices", prompt, options };
}

export function switchOn(switchId: string): EventCommand {
  return { t: "setSwitch", switchId, value: true };
}

export function switchOff(switchId: string): EventCommand {
  return { t: "setSwitch", switchId, value: false };
}

export function selfSwitchOn(selfSwitch: "A" | "B" | "C" | "D"): EventCommand {
  return { t: "setSelfSwitch", selfSwitch, value: true };
}

export function addVar(variableId: string, value: number): EventCommand {
  return { t: "setVariable", variableId, op: "add", value };
}

export function setVar(variableId: string, value: number): EventCommand {
  return { t: "setVariable", variableId, op: "set", value };
}

export function ifSwitch(
  switchId: string,
  then: readonly EventCommand[],
  otherwise: readonly EventCommand[] = [],
): EventCommand {
  return { t: "if", cond: { type: "switch", switchId }, then, else: otherwise };
}

export function ifVariable(
  variableId: string,
  min: number,
  then: readonly EventCommand[],
  otherwise: readonly EventCommand[] = [],
): EventCommand {
  return { t: "if", cond: { type: "variable", variableId, min }, then, else: otherwise };
}

export function teleport(map: MapKey, col: number, row: number): EventCommand {
  return { t: "teleport", mapId: MAP_IDS[map], col, row };
}

export function gold(amount: number): EventCommand {
  return { t: "changeGold", amount };
}

export function items(itemId: string, count: number): EventCommand {
  return { t: "changeItems", itemId, count };
}

export function activity(activityId: string): EventCommand {
  return { t: "completeActivity", activityId };
}

export function enterArea(areaId: string): EventCommand {
  return { t: "enterArea", areaId };
}

export function startQuest(questId: string): EventCommand {
  return { t: "startQuest", questId };
}

export function completeQuest(questId: string): EventCommand {
  return { t: "completeQuest", questId };
}

export function openShop(): EventCommand {
  return { t: "openShop" };
}

export function endAdventure(): EventCommand {
  return { t: "endAdventure" };
}

export function wait(frames: number): EventCommand {
  return { t: "wait", frames };
}

export function comment(text: string): EventCommand {
  return { t: "comment", text };
}

// ---------------------------------------------------------------------------
// La fabrique d'événements d'une carte.
// ---------------------------------------------------------------------------

/**
 * Chaque carte ouvre une fabrique : elle numérote les ordinaux `EV001…`, mint un uuid stable à
 * partir de la clé logique, et enregistre l'événement dans `refs` pour que les quêtes puissent le
 * citer plus tard sans se repasser des objets à la main.
 */
export function createEventFactory(mapKey: MapKey, refs: StoryRefs) {
  let ordinal = 1;
  const events: MapEvent[] = [];

  const add = (key: string, event: MapEvent): MapEvent => {
    events.push(event);
    refs[`${mapKey}.${key}`] = event;
    return event;
  };

  const normal = (
    key: string,
    name: string,
    position: { col: number; row: number },
    graphicAssetId: MapEventPage["graphicAssetId"],
    pages: readonly MapEventPage[],
  ): MapEvent =>
    add(key, {
      id: stableUuid(`${mapKey}:${key}`),
      ...position,
      name,
      ordinal: ordinal++,
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
      // Une page sans graphique hérite de celui de l'événement : l'auteur écrit le portrait une fois.
      pages: pages.map((candidate) =>
        candidate.graphicAssetId === null && graphicAssetId !== null
          ? { ...candidate, graphicAssetId }
          : candidate,
      ),
    });

  const anchor = (
    key: string,
    name: string,
    position: { col: number; row: number },
    kind: "spawn" | "entry" | "exit",
  ): MapEvent =>
    add(
      key,
      functionalEvent({
        id: stableUuid(`${mapKey}:${key}`),
        ...position,
        name,
        ordinal: ordinal++,
        kind,
      }),
    );

  const monster = (
    key: string,
    name: string,
    position: { col: number; row: number },
    species: MonsterSpecies,
    tuning: Partial<MonsterTuning> = {},
    commands: readonly EventCommand[] = [],
    patrolRadius?: number,
  ): MapEvent => {
    const event = functionalEvent({
      id: stableUuid(`${mapKey}:${key}`),
      ...position,
      name,
      ordinal: ordinal++,
      kind: "monster",
      species,
      patrolRadius:
        patrolRadius ?? (tuning.rank === "boss" ? 160 : tuning.rank === "elite" ? 120 : 88),
      monsterTuning: tuning,
    });
    // Le programme d'un monstre s'exécute à sa MORT : c'est là qu'on compte une menace écartée.
    return add(key, { ...event, pages: [{ ...(event.pages[0] ?? defaultEventPage()), commands }] });
  };

  const guard = (
    key: string,
    name: string,
    position: { col: number; row: number },
    patrolRadius: number,
    conditionSwitchId: string | null = null,
  ): MapEvent => {
    const event = functionalEvent({
      id: stableUuid(`${mapKey}:${key}`),
      ...position,
      name,
      ordinal: ordinal++,
      kind: "guard",
      patrolRadius,
    });
    return add(key, {
      ...event,
      pages: [{ ...(event.pages[0] ?? defaultEventPage()), condSwitchId: conditionSwitchId }],
    });
  };

  return { events, normal, anchor, monster, guard };
}

// ---------------------------------------------------------------------------
// Le registre d'état.
// ---------------------------------------------------------------------------

/**
 * Les switches, nommés en clair pour l'auteur et cités par leur ordinal par le moteur. L'ordre de
 * ce tableau EST l'attribution des ids — insérer au milieu renumérote tout, donc on ajoute à la fin.
 */
const SWITCH_NAMES = [
  "Naufragés secourus", // 0001
  "Journal du bord retrouvé", // 0002
  "Ondine ralliée", // 0003
  "Guet du port levé", // 0004
  "Marchand installé au port", // 0005
  "Passerelle des Brisants réparée", // 0006
  "Huile du fanal récupérée", // 0007
  "Camp gobelin brisé", // 0008
  "Barque des Brisants gréée", // 0009
  "Barque du Marais gréée", // 0010
  "Vannes du marais ouvertes", // 0011
  "Trolls des vases chassés", // 0012
  "Verre de sel obtenu", // 0013
  "Canot de Mila retrouvé", // 0014
  "Miroir du phare réparé", // 0015
  "Accès au phare ouvert", // 0016
  "Aldemar démasqué", // 0017
  "Aldemar épargné", // 0018
  "Aldemar abattu", // 0019
  "Vérité de l’Éclipse connue", // 0020
  "Flotte de Varn repérée", // 0021
  "Baie évacuée", // 0022
  "Front de la plage tenu", // 0023
  "Varn vaincu", // 0024
  "Fin — Le phare rallumé", // 0025
  "Fin — Le miroir brisé", // 0026
  "Fin — Baie vidée puis rallumée", // 0027
  "Aventure terminée", // 0028
] as const;

const VARIABLE_NAMES = [
  "Alliés ralliés", // 0001
  "Naufragés sauvés", // 0002
  "Fragments du miroir", // 0003
  "Confiance d’Ondine", // 0004
  "Sel récolté", // 0005
  "Vannes ouvertes", // 0006
  "Fanaux allumés", // 0007
  "Menace gobeline", // 0008
  "Secrets d’Aldemar", // 0009
  "Voiles sauvées", // 0010
] as const;

/** Noms lisibles → ordinaux, pour que le reste du builder n'écrive jamais `"0013"` à la main. */
export const S = {
  castawaysRescued: "0001",
  logbookFound: "0002",
  ondineAllied: "0003",
  portWatch: "0004",
  merchantSettled: "0005",
  reefBridge: "0006",
  lampOil: "0007",
  goblinCamp: "0008",
  boatReefs: "0009",
  boatMarsh: "0010",
  marshValves: "0011",
  trollsCleared: "0012",
  saltGlass: "0013",
  milaBoat: "0014",
  mirrorRepaired: "0015",
  lighthouseOpen: "0016",
  aldemarUnmasked: "0017",
  aldemarSpared: "0018",
  aldemarSlain: "0019",
  eclipseTruth: "0020",
  fleetSighted: "0021",
  bayEvacuated: "0022",
  beachHeld: "0023",
  varnDefeated: "0024",
  endingRelit: "0025",
  endingShattered: "0026",
  endingEvacuated: "0027",
  finished: "0028",
} as const;

export const V = {
  allies: "0001",
  castaways: "0002",
  mirrorShards: "0003",
  ondineTrust: "0004",
  salt: "0005",
  valves: "0006",
  beacons: "0007",
  goblinThreat: "0008",
  aldemarSecrets: "0009",
  sailsSaved: "0010",
} as const;

/** Les quêtes citent le même espace d'ordinaux à 4 chiffres que les switches et les variables. */
export const Q = {
  castaways: "0001",
  oil: "0002",
  bridge: "0003",
  camp: "0004",
  valves: "0005",
  glass: "0006",
  lighthouse: "0007",
} as const;

function registryEntries(names: readonly string[]) {
  return names.map((name, index) => ({ id: String(index + 1).padStart(4, "0"), name }));
}

export const SWITCHES = registryEntries(SWITCH_NAMES);
export const VARIABLES = registryEntries(VARIABLE_NAMES);
