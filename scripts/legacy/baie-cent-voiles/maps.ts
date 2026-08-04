/**
 * Les six cartes de « La Baie des Cent Voiles ».
 *
 * Construction en DEUX passes, et c'est structurel, pas cosmétique : une barque de la Grève doit
 * connaître la cellule d'accostage de Port-Fanal, qui doit connaître celle de la Grève. La passe
 * « terrain » dessine les six îles et fige les quais ; la passe « contenu » pose les événements en
 * lisant tous les quais à la fois. Sans ce découpage, la circularité forcerait à écrire des
 * coordonnées à la main — et une coordonnée écrite à la main sur du terrain généré est un pari.
 *
 * Chaque coordonnée passe par le `snapper` : ce qu'on écrit est un SOUHAIT, snappé sur la case
 * légale la plus proche (ni mer, ni bord de falaise, ni case déjà prise). Redessiner une côte ne
 * casse donc jamais un placement, elle le déplace.
 */
import type { AdventureBundleMap } from "@lindocara/engine/adventure-bundle.js";
import type { MonsterSpecies, MonsterTuning } from "@lindocara/engine/game.js";
import type { MapEvent, MapEventPage } from "@lindocara/engine/map-events.js";
import { TINY_SWORDS_TILESET_ID } from "@lindocara/engine/tilesets/tiny-swords.js";
import type { EditorAssetId } from "@lindocara/engine/tiny-swords-catalog.js";
import { rngFor } from "../../lib/island-terrain.js";
import {
  activity,
  addVar,
  choice,
  completeQuest,
  createEventFactory,
  endAdventure,
  enterArea,
  GRAPHICS,
  gold,
  ifSwitch,
  ifVariable,
  items,
  MAP_IDS,
  type MapKey,
  openShop,
  page,
  Q,
  S,
  type StoryRefs,
  say,
  selfSwitchOn,
  startQuest,
  switchOn,
  teleport,
  V,
} from "./campaign.js";
import { PROPS, Scene, snapperFor, stumpsAndProps } from "./scenery.js";

type Factory = ReturnType<typeof createEventFactory>;
type Snapper = ReturnType<typeof snapperFor>;

const BUILD = {
  house1: "building.buildings-blue-buildings.house1",
  house2: "building.buildings-blue-buildings.house2",
  house3: "building.buildings-blue-buildings.house3",
  castle: "building.buildings-blue-buildings.castle",
  barracks: "building.buildings-blue-buildings.barracks",
  monastery: "building.buildings-blue-buildings.monastery",
  tower: "building.factions-knights-buildings-tower.tower-blue",
  towerYellow: "building.buildings-yellow-buildings.tower",
  houseYellow: "building.buildings-yellow-buildings.house1",
  houseYellow2: "building.buildings-yellow-buildings.house2",
  ruinHouse: "building.factions-knights-buildings-house.house-destroyed",
  ruinTower: "building.factions-knights-buildings-tower.tower-destroyed",
  ruinCastle: "building.factions-knights-buildings-castle.castle-destroyed",
  goblinHouse: "building.factions-goblins-buildings-wood-house.goblin-house",
  goblinRuin: "building.factions-goblins-buildings-wood-house.goblin-house-destroyed",
  goblinTower: "building.factions-goblins-buildings-wood-tower.wood-tower-destroyed",
  blackTower: "building.buildings-black-buildings.tower",
  blackBarracks: "building.buildings-black-buildings.barracks",
  blackHouse: "building.buildings-black-buildings.house1",
} as const satisfies Record<string, EditorAssetId>;

const WOOD = "resource.resources-resources.w-idle" as EditorAssetId;
const GOLDPILE = "resource.resources-resources.g-idle" as EditorAssetId;
const MEAT = "resource.resources-resources.m-idle" as EditorAssetId;
const TOOLS: readonly EditorAssetId[] = [
  "resource.terrain-resources-tools.tool-01",
  "resource.terrain-resources-tools.tool-02",
  "resource.terrain-resources-tools.tool-03",
  "resource.terrain-resources-tools.tool-04",
] as EditorAssetId[];
const GOLD_STONES: readonly EditorAssetId[] = [
  "resource.terrain-resources-gold-gold-stones.gold-stone-1",
  "resource.terrain-resources-gold-gold-stones.gold-stone-3",
  "resource.terrain-resources-gold-gold-stones.gold-stone-5",
] as EditorAssetId[];
const DUCK = "decoration.terrain-decorations-rubber-duck.rubber-duck" as EditorAssetId;

// ---------------------------------------------------------------------------
// Passe 1 — le terrain. Chaque carte fige sa forme, son quai et ses lieux-clés.
// ---------------------------------------------------------------------------

type Cell = { col: number; row: number };
type Spots = Record<string, Cell>;

/**
 * Générique sur ses repères : `Ground<{ bosco: Cell; … }>` garde les NOMS exacts que la carte a
 * posés, donc `s.bosco` est une case et non « peut-être une case ». Un `Record<string, Cell>` forcerait
 * un `?.` sur chaque repère — et masquerait la seule faute qui compte ici, la coquille dans un nom.
 */
interface Ground<S extends Spots = Spots> {
  key: MapKey;
  name: string;
  cols: number;
  rows: number;
  scene: Scene;
  snap: Snapper;
  /** La case où l'on débarque. Aucun événement à déclenchement au contact ne s'en approche. */
  dock: Cell;
  /** Les repères que la passe contenu va habiller, snappés une fois pour toutes. */
  spots: S;
}

function ground<S extends Spots>(
  key: MapKey,
  name: string,
  cols: number,
  rows: number,
  shape: (scene: Scene) => void,
  places: (snap: Snapper) => { dock: Cell; spots: S },
): Ground<S> {
  const scene = new Scene(cols, rows, rngFor(`baie:${key}`));
  shape(scene);
  const snap = snapperFor(scene);
  const { dock, spots } = places(snap);
  scene.reserve([dock, ...Object.values(spots)], 1);
  return { key, name, cols, rows, scene, snap, dock, spots };
}

function buildGrounds() {
  // ① La Grève des Épaves — une île longue ouverte au sud-ouest, un îlot au nord-est relié par une
  //    passerelle : la première chose que le joueur apprend, c'est qu'on traverse l'eau à pied.
  const wrecks = ground(
    "wrecks",
    "La Grève des Épaves",
    44,
    30,
    (s) => {
      s.addIsland({ col: 19, row: 16, radiusX: 16, radiusY: 11, wobble: 0.32 });
      s.addIsland({ col: 37, row: 8, radiusX: 6, radiusY: 5, wobble: 0.34 });
      s.addLagoon({ col: 25, row: 18, radiusX: 4, radiusY: 3, wobble: 0.4 });
      // Le détroit qui détache l'îlot du nord-est, et la planche qui le rattache : la toute
      // première leçon de la baie est qu'ici, on traverse l'eau à pied quand on a un pont.
      s.addChannel(30, 0, 32, 10);
      s.settleCoast(2);
      s.paint();
      s.addBridgeSpan({ col: 29, row: 8 }, { col: 34, row: 8 });
    },
    (snap) => ({
      dock: snap.at(8, 21),
      spots: {
        bosco: snap.at(12, 19),
        castaway1: snap.at(16, 23),
        castaway2: snap.at(22, 12),
        castaway3: snap.at(29, 20),
        logbook: snap.at(20, 16),
        chest: snap.at(31, 12),
        raider1: snap.at(25, 22),
        raider2: snap.at(28, 15),
        raider3: snap.at(33, 18),
        boatPort: snap.at(11, 24),
        sign: snap.at(10, 18),
        wreckLine: snap.at(15, 27),
      },
    }),
  );

  // ② Port-Fanal — une grande île creusée d'une rade au sud ; le village borde la rade, le guet
  //    tient la terrasse au nord-est.
  const port = ground(
    "port",
    "Port-Fanal",
    52,
    36,
    (s) => {
      s.addIsland({ col: 26, row: 19, radiusX: 22, radiusY: 15, wobble: 0.24 });
      s.addLagoon({ col: 27, row: 31, radiusX: 9, radiusY: 7, wobble: 0.35 });
      s.settleCoast(2);
      s.paint();
      s.addPlateau({ col: 40, row: 10, radiusX: 6, radiusY: 5, wobble: 0.2 }, 1);
      s.addStairsToPlateau(0);
    },
    (snap) => ({
      dock: snap.at(11, 24),
      spots: {
        ondine: snap.at(19, 23),
        merchant: snap.at(23, 20),
        carpenter: snap.at(16, 20),
        mila: snap.at(26, 24),
        fisher: snap.at(14, 27),
        bell: snap.at(21, 17),
        watch1: snap.at(38, 11),
        watch2: snap.at(41, 13),
        guard1: snap.at(17, 25),
        guard2: snap.at(24, 22),
        boatWrecks: snap.at(9, 22),
        boatReefs: snap.at(30, 27),
        boatMarsh: snap.at(33, 24),
        boatLighthouse: snap.at(36, 20),
        plaza: snap.at(20, 20),
        sign: snap.at(13, 23),
        chapel: snap.at(28, 15),
      },
    }),
  );

  // ③ L'Îlot des Brisants — deux lobes séparés par un chenal ; la passerelle brisée est le verrou.
  //    Le camp gobelin occupe la terrasse du lobe est.
  const reefs = ground(
    "reefs",
    "L’Îlot des Brisants",
    46,
    34,
    (s) => {
      s.addIsland({ col: 12, row: 17, radiusX: 11, radiusY: 12, wobble: 0.3 });
      s.addIsland({ col: 33, row: 16, radiusX: 11, radiusY: 12, wobble: 0.3 });
      s.addChannel(21, 0, 23, 33);
      s.settleCoast(1);
      s.paint();
      s.addPlateau({ col: 34, row: 14, radiusX: 7, radiusY: 6, wobble: 0.22 }, 1);
      s.addStairsToPlateau(0);
      s.addBridgeSpan({ col: 19, row: 18 }, { col: 25, row: 18 });
    },
    (snap) => ({
      dock: snap.at(8, 22),
      spots: {
        footbridge: snap.at(18, 18),
        scout: snap.at(13, 14),
        oil: snap.at(37, 12),
        camp1: snap.at(31, 15),
        camp2: snap.at(35, 17),
        camp3: snap.at(38, 14),
        shaman: snap.at(34, 12),
        watcher: snap.at(27, 21),
        beachRaider: snap.at(12, 25),
        boatPort: snap.at(6, 20),
        campSign: snap.at(28, 24),
      },
    }),
  );

  // ④ Le Marais de Sel — une île basse trouée de salines. Aucun relief : ici le danger est plat,
  //    et c'est l'eau découpée qui dessine le labyrinthe.
  const marsh = ground(
    "marsh",
    "Le Marais de Sel",
    48,
    32,
    (s) => {
      s.addIsland({ col: 24, row: 16, radiusX: 21, radiusY: 13, wobble: 0.28 });
      s.addLagoon({ col: 14, row: 11, radiusX: 5, radiusY: 3, wobble: 0.4 });
      s.addLagoon({ col: 31, row: 10, radiusX: 6, radiusY: 3, wobble: 0.4 });
      s.addLagoon({ col: 20, row: 23, radiusX: 6, radiusY: 3, wobble: 0.4 });
      s.addLagoon({ col: 35, row: 21, radiusX: 4, radiusY: 4, wobble: 0.4 });
      s.settleCoast(1);
      s.paint();
      s.addBridgeSpan({ col: 12, row: 17 }, { col: 18, row: 17 });
    },
    (snap) => ({
      dock: snap.at(6, 16),
      spots: {
        saline: snap.at(11, 15),
        valve1: snap.at(17, 9),
        valve2: snap.at(27, 17),
        valve3: snap.at(38, 13),
        glass: snap.at(24, 13),
        troll1: snap.at(21, 19),
        troll2: snap.at(30, 22),
        troll3: snap.at(36, 17),
        gateTroll: snap.at(33, 8),
        boatPort: snap.at(8, 19),
        pan1: snap.at(15, 20),
        pan2: snap.at(29, 12),
        sign: snap.at(9, 13),
      },
    }),
  );

  // ⑤ Le Phare de Malemer — un rocher à deux étages. On monte, et à chaque palier la mer est plus
  //    basse : c'est la seule carte qui utilise les deux niveaux d'élévation.
  const lighthouse = ground(
    "lighthouse",
    "Le Phare de Malemer",
    40,
    34,
    (s) => {
      s.addIsland({ col: 20, row: 18, radiusX: 16, radiusY: 13, wobble: 0.26 });
      s.settleCoast(2);
      s.paint();
      s.addPlateau({ col: 21, row: 16, radiusX: 10, radiusY: 8, wobble: 0.18 }, 1);
      s.addStairsToPlateau(0);
      s.addPlateau({ col: 22, row: 15, radiusX: 5, radiusY: 4, wobble: 0.16 }, 2);
      s.addStairsToPlateau(1);
    },
    (snap) => ({
      dock: snap.at(8, 26),
      spots: {
        gate: snap.at(13, 24),
        bone1: snap.at(16, 26),
        bone2: snap.at(24, 27),
        bone3: snap.at(10, 20),
        crusader: snap.at(19, 24),
        warden: snap.at(21, 20),
        aldemar: snap.at(22, 15),
        mirror: snap.at(24, 15),
        lens: snap.at(19, 15),
        boatPort: snap.at(7, 28),
        sign: snap.at(11, 27),
      },
    }),
  );

  // ⑥ Les Cent Voiles — une plage en croissant face au large. La bataille se donne sur le sable,
  //    dos aux dunes : rien à contourner, tout à tenir.
  const battle = ground(
    "battle",
    "Les Cent Voiles",
    52,
    30,
    (s) => {
      s.addIsland({ col: 26, row: 12, radiusX: 24, radiusY: 10, wobble: 0.22 });
      s.addBank(6, 14, 45, 19);
      s.addLagoon({ col: 12, row: 6, radiusX: 5, radiusY: 3, wobble: 0.4 });
      s.addLagoon({ col: 40, row: 5, radiusX: 5, radiusY: 3, wobble: 0.4 });
      s.settleCoast(1);
      s.paint();
    },
    (snap) => ({
      dock: snap.at(8, 17),
      spots: {
        rally: snap.at(13, 16),
        line1: snap.at(19, 14),
        line2: snap.at(19, 19),
        ally1: snap.at(16, 15),
        ally2: snap.at(16, 18),
        ally3: snap.at(15, 12),
        ally4: snap.at(15, 21),
        raider1: snap.at(28, 12),
        raider2: snap.at(29, 18),
        raider3: snap.at(33, 15),
        raider4: snap.at(26, 20),
        torch1: snap.at(31, 10),
        torch2: snap.at(35, 19),
        boar1: snap.at(37, 13),
        boar2: snap.at(38, 17),
        varn: snap.at(43, 15),
        ending: snap.at(46, 15),
        camp: snap.at(40, 8),
      },
    }),
  );

  return { wrecks, port, reefs, marsh, lighthouse, battle };
}

// ---------------------------------------------------------------------------
// Passe 2 — le contenu. Petits assembleurs d'événements récurrents.
// ---------------------------------------------------------------------------

/** Un PNJ qui répète les mêmes lignes : le décor parlant d'une carte. */
function npc(
  factory: Factory,
  key: string,
  name: string,
  at: { col: number; row: number },
  graphic: MapEventPage["graphicAssetId"],
  lines: readonly string[],
): MapEvent {
  return factory.normal(key, name, at, graphic, [
    page(
      lines.map((line) => say(name, line)),
      { graphicAssetId: graphic },
    ),
  ]);
}

/**
 * Un événement à usage unique : la page 1 joue le programme puis lève son self-switch A, la page 2
 * — sélectionnée parce qu'elle est plus haute ET que sa condition tient — ne dit plus que la
 * réplique d'après. C'est la mécanique RPG Maker de la « chose déjà faite », sans variable globale.
 */
function once(
  factory: Factory,
  key: string,
  name: string,
  at: { col: number; row: number },
  graphic: MapEventPage["graphicAssetId"],
  commands: readonly ReturnType<typeof say>[],
  after: string,
): MapEvent {
  return factory.normal(key, name, at, graphic, [
    page([...commands, selfSwitchOn("A")], { graphicAssetId: graphic }),
    page([say(name, after)], { condSelfSwitch: "A", graphicAssetId: graphic }),
  ]);
}

/**
 * Une barque. Verrouillée tant que son switch n'est pas levé, elle explique POURQUOI ; levée, elle
 * embarque. Déclenchement à l'action et jamais au contact : on ne monte pas dans un bateau en
 * marchant à côté, et le validateur refuse de faire arriver un téléport près d'un contact.
 */
function boat(
  factory: Factory,
  key: string,
  name: string,
  at: { col: number; row: number },
  destination: { map: MapKey; col: number; row: number },
  unlock: string | null,
  locked: string,
  boarding: string,
): MapEvent {
  const sail = page(
    [say(name, boarding), teleport(destination.map, destination.col, destination.row)],
    { graphicAssetId: GRAPHICS.boat },
  );
  return factory.normal(
    key,
    name,
    at,
    GRAPHICS.boat,
    unlock === null
      ? [sail]
      : [
          page([say(name, locked)], { graphicAssetId: GRAPHICS.boat }),
          { ...sail, condSwitchId: unlock },
        ],
  );
}

function pack(
  factory: Factory,
  keyPrefix: string,
  name: string,
  species: MonsterSpecies,
  spots: readonly { col: number; row: number }[],
  tuning: Partial<MonsterTuning> = {},
  onDeath: readonly ReturnType<typeof say>[] = [],
): void {
  spots.forEach((spot, index) => {
    factory.monster(
      `${keyPrefix}-${index + 1}`,
      `${name} ${index + 1}`,
      spot,
      species,
      tuning,
      onDeath,
    );
  });
}

function bundle(
  g: Ground<Spots>,
  events: readonly MapEvent[],
  elements: ReturnType<Scene["finish"]>["elements"],
  layers: string[],
  spawn: { col: number; row: number },
): AdventureBundleMap {
  return {
    id: MAP_IDS[g.key],
    name: g.name,
    tilesetId: TINY_SWORDS_TILESET_ID,
    cols: g.cols,
    rows: g.rows,
    layers,
    elements,
    spawn,
    events,
  };
}

// ---------------------------------------------------------------------------

type Grounds = ReturnType<typeof buildGrounds>;

export function buildMaps(refs: StoryRefs): AdventureBundleMap[] {
  const g = buildGrounds();
  const dock: Dock = (key) => g[key].dock;

  return [
    contentWrecks(g.wrecks, dock, refs),
    contentPort(g.port, dock, refs),
    contentReefs(g.reefs, dock, refs),
    contentMarsh(g.marsh, dock, refs),
    contentLighthouse(g.lighthouse, dock, refs),
    contentBattle(g.battle, refs),
  ];
}

type Dock = (key: MapKey) => Cell;

function contentWrecks(g: Grounds["wrecks"], dock: Dock, refs: StoryRefs): AdventureBundleMap {
  const e = createEventFactory("wrecks", refs);
  const s = g.spots;
  const spawn = g.dock;

  e.anchor("spawn", "Grève basse", spawn, "spawn");

  npc(e, "sign", "Poteau de marée", s.sign, GRAPHICS.sign, [
    "GRÈVE DES ÉPAVES — cap au nord-est, Port-Fanal à une heure de rame. Le fanal est éteint : ne naviguez pas de nuit.",
  ]);

  e.normal("bosco", "Bosco", s.bosco, GRAPHICS.castaway, [
    page(
      [
        say(
          "Bosco",
          "Vous tenez debout ? Trois des nôtres ne se sont pas relevés sur la grève. Ils respirent encore, je les entends.",
        ),
        say(
          "Bosco",
          "Moi je ne peux plus marcher. Allez les chercher, je compte les vagues en vous attendant.",
        ),
        startQuest(Q.castaways),
      ],
      { graphicAssetId: GRAPHICS.castaway },
    ),
    page(
      [
        say(
          "Bosco",
          "Trois sauvés, trois debout. Le fanal de Malemer était éteint quand nous avons donné sur le récif — il ne s'est pas éteint tout seul.",
        ),
        say(
          "Bosco",
          "Filez au port. Demandez la capitaine Ondine, dites-lui que Bosco vous envoie.",
        ),
      ],
      { condVariableId: V.castaways, condVariableMin: 3, graphicAssetId: GRAPHICS.castaway },
    ),
  ]);

  for (const [index, spot] of [s.castaway1, s.castaway2, s.castaway3].entries()) {
    const names = ["Wenna", "Jorick", "la petite Aude"];
    const lines = [
      "De l'eau… J'ai cru que la lumière reviendrait. Elle n'est jamais revenue.",
      "Ma main est cassée, pas ma tête. J'ai vu une barque noire filer vers les Brisants pendant qu'on coulait.",
      "Je n'ai rien lâché. Regardez : le rôle de l'équipage. Il en manque quatre, et pas des moindres.",
    ];
    once(
      e,
      `castaway-${index + 1}`,
      String(names[index]),
      spot,
      GRAPHICS.castaway,
      [
        say(String(names[index]), String(lines[index])),
        activity("naufrage_secouru"),
        addVar(V.castaways, 1),
        addVar(V.allies, 1),
      ],
      "Je tiendrai jusqu'au port. Allez-y sans moi.",
    );
  }

  once(
    e,
    "logbook",
    "Journal de bord",
    s.logbook,
    GRAPHICS.crate,
    [
      say(
        null,
        "Le livre de bord a flotté. La dernière ligne est nette : « Fanal éteint depuis trois lunes. Le gardien ne répond pas aux signaux. »",
      ),
      say(null, "En dessous, une autre main, plus sèche : « Il répond. Il refuse. »"),
      switchOn(S.logbookFound),
      addVar(V.aldemarSecrets, 1),
    ],
    "Le journal est trempé mais lisible. Ondine voudra le voir.",
  );

  once(
    e,
    "chest",
    "Coffre de gabier",
    s.chest,
    GRAPHICS.chest,
    [
      say(
        null,
        "Un coffre calé sous une vergue : douze pièces, deux fioles et un jeu de cartes gonflé d'eau.",
      ),
      gold(35),
      items("health_potion", 2),
    ],
    "Le coffre est vide, les cartes sèchent au soleil.",
  );

  pack(e, "raider", "Pillard d’épave", "spear_goblin", [s.raider1, s.raider2, s.raider3], {
    maxHp: 46,
    damage: 7,
    xp: 22,
    weakness: "warrior",
    weaknessPercent: 130,
    specialTechnique: "spear_fan",
  });

  boat(
    e,
    "boat-port",
    "Youyou de la grève",
    s.boatPort,
    { map: "port", ...dock("port") },
    null,
    "",
    "Deux avirons, un fond qui prend l'eau. Cap sur Port-Fanal.",
  );

  const { scene } = g;
  scene.reserve(e.events, 1);
  scene
    .placeNear(BUILD.ruinHouse, s.wreckLine.col, s.wreckLine.row)
    .placeNear(WOOD, s.wreckLine.col + 4, s.wreckLine.row - 1)
    .placeNear(WOOD, s.bosco.col + 2, s.bosco.row + 2)
    .placeNear(TOOLS[0] as EditorAssetId, s.logbook.col - 2, s.logbook.row + 1)
    .placeNear(TOOLS[2] as EditorAssetId, s.chest.col - 2, s.chest.row + 2)
    .place(DUCK, 4, 12)
    .place(DUCK, 40, 24)
    .dress({
      shoreTrees: 0.34,
      groves: 5,
      undergrowth: 0.07,
      inlandProps: stumpsAndProps(),
      inlandDensity: 0.05,
      reefs: 0.07,
      clouds: 3,
    });

  const finished = scene.finish();
  return bundle(g, e.events, finished.elements, finished.layers, spawn);
}

function contentPort(g: Grounds["port"], dock: Dock, refs: StoryRefs): AdventureBundleMap {
  const e = createEventFactory("port", refs);
  const s = g.spots;

  npc(e, "sign", "Panneau du quai", s.sign, GRAPHICS.sign, [
    "PORT-FANAL — Rade franche. Amarrage libre aux rescapés. Défense de sonner la cloche sans motif.",
  ]);

  e.normal("ondine", "Capitaine Ondine", s.ondine, GRAPHICS.ondine, [
    page(
      [
        say(
          "Ondine",
          "Encore des rescapés. Cinq navires en trois lunes, et le fanal de Malemer reste noir.",
        ),
        say(
          "Ondine",
          "J'ai besoin de deux choses avant de monter là-haut : l'huile du fanal, que les pillards ont prise aux Brisants, et un verre de sel du marais pour refaire le miroir.",
        ),
        switchOn(S.ondineAllied),
        addVar(V.allies, 1),
        startQuest(Q.oil),
      ],
      { graphicAssetId: GRAPHICS.ondine },
    ),
    page(
      [
        say(
          "Ondine",
          "L'huile est là, le verre est coulé. Le phare nous attend — et son gardien avec.",
        ),
        say("Ondine", "Prenez la barque du nord-est. Je fais lever le guet et je vous suis."),
        switchOn(S.lighthouseOpen),
        startQuest(Q.lighthouse),
      ],
      {
        condSwitchId: S.saltGlass,
        graphicAssetId: GRAPHICS.ondine,
      },
    ),
    page(
      [
        say(
          "Ondine",
          "Le miroir est réparé, la baie sait. Ce qui vient maintenant, aucun fanal ne l'empêchera.",
        ),
        say("Ondine", "Les Cent Voiles, à l'aube. Ne me faites pas attendre."),
      ],
      { condSwitchId: S.mirrorRepaired, graphicAssetId: GRAPHICS.ondine },
    ),
  ]);

  e.normal("carpenter", "Maître Galiane", s.carpenter, GRAPHICS.carpenter, [
    page(
      [
        say(
          "Galiane",
          "La passerelle des Brisants est coupée en deux. Sans elle, la moitié de l'îlot est un caillou qu'on regarde.",
        ),
        say("Galiane", "Apportez-moi de quoi la refaire et je la remonte avant la marée."),
        startQuest(Q.bridge),
      ],
      { graphicAssetId: GRAPHICS.carpenter },
    ),
    page(
      [
        say(
          "Galiane",
          "Elle tiendra vingt ans. Passez-y sans courir, c'est tout ce que je demande.",
        ),
      ],
      { condSwitchId: S.reefBridge, graphicAssetId: GRAPHICS.carpenter },
    ),
  ]);

  e.normal("merchant", "Perrin le Sec", s.merchant, GRAPHICS.merchant, [
    page(
      [
        say(
          "Perrin",
          "Naufragés, donc sans le sou. J'ai quand même de quoi vous remettre debout — au prix de la baie, pas au prix de la pitié.",
        ),
        switchOn(S.merchantSettled),
        openShop(),
      ],
      { graphicAssetId: GRAPHICS.merchant },
    ),
  ]);

  e.normal("mila", "Mila", s.mila, GRAPHICS.mila, [
    page(
      [
        say(
          "Mila",
          "Mon canot s'est détaché pendant la tempête. Il est vert, avec une étoile peinte dessus.",
        ),
        say(
          "Mila",
          "Si vous le voyez au marais, ne le laissez pas. C'est le seul que mon père ait fait.",
        ),
      ],
      { graphicAssetId: GRAPHICS.mila },
    ),
    page(
      [
        say("Mila", "Vous l'avez retrouvé ! L'étoile est encore là, sous le sel."),
        say("Mila", "Tenez — c'est tout ce que j'ai. Papa disait qu'on paie ce qu'on doit."),
        gold(60),
        addVar(V.ondineTrust, 1),
        selfSwitchOn("B"),
      ],
      { condSwitchId: S.milaBoat, graphicAssetId: GRAPHICS.mila },
    ),
    page([say("Mila", "Je l'ai amarré à double tour, cette fois.")], {
      condSelfSwitch: "B",
      graphicAssetId: GRAPHICS.mila,
    }),
  ]);

  npc(e, "fisher", "Vieux Tannec", s.fisher, GRAPHICS.fisher, [
    "Quarante ans que je relève des casiers sous ce fanal. Aldemar l'allumait par tempête, par deuil, par n'importe quoi.",
    "S'il l'a éteint, c'est qu'il a vu quelque chose que la lumière appelait.",
  ]);

  once(
    e,
    "bell",
    "Cloche du port",
    s.bell,
    GRAPHICS.sign,
    [
      say(
        null,
        "La cloche de rade. On la sonne pour un incendie, un abordage, ou un retour qu'on n'espérait plus.",
      ),
      say(null, "Le bronze porte loin. Sur la terrasse, le guet décroche ses lances."),
      switchOn(S.portWatch),
      addVar(V.allies, 2),
    ],
    "La corde pend encore. Le guet est à son poste.",
  );

  // Le guet n'existe QUE si la cloche a sonné : une page conditionnelle décide de sa présence,
  // sans qu'aucun script n'ait à faire apparaître quoi que ce soit.
  e.guard("guard-1", "Guet du port", s.guard1, 220, S.portWatch);
  e.guard("guard-2", "Guet de la rade", s.guard2, 220, S.portWatch);
  e.guard("watch-1", "Vigie de la terrasse", s.watch1, 180, S.portWatch);

  npc(e, "watch-2", "Sergent Brann", s.watch2, GRAPHICS.guardBlue, [
    "De là-haut on voit jusqu'aux Brisants. Depuis six nuits, des feux y bougent qui ne sont pas des feux de pêche.",
    "Sonnez la cloche si vous voulez du monde. Sans elle, je ne peux pas dégarnir la terrasse.",
  ]);

  boat(
    e,
    "boat-wrecks",
    "Youyou de la grève",
    s.boatWrecks,
    { map: "wrecks", ...dock("wrecks") },
    null,
    "",
    "Retour à la grève.",
  );
  boat(
    e,
    "boat-reefs",
    "Chaloupe des Brisants",
    s.boatReefs,
    { map: "reefs", ...dock("reefs") },
    S.ondineAllied,
    "La chaloupe est cadenassée. « Ordre de la capitaine », dit l'écriteau.",
    "Cap sur les Brisants. La mer y casse court.",
  );
  boat(
    e,
    "boat-marsh",
    "Plate du marais",
    s.boatMarsh,
    { map: "marsh", ...dock("marsh") },
    S.ondineAllied,
    "Une plate à fond plat, sans avirons. Personne ne vous a encore autorisé à la prendre.",
    "Cap sur le Marais de Sel. Respirez par la bouche.",
  );
  boat(
    e,
    "boat-lighthouse",
    "Canot du phare",
    s.boatLighthouse,
    { map: "lighthouse", ...dock("lighthouse") },
    S.lighthouseOpen,
    "Le canot du gardien. Ondine ne le décrochera pas avant d'avoir l'huile ET le verre.",
    "Cap sur Malemer. Le rocher grossit vite.",
  );

  const { scene } = g;
  scene.reserve(e.events, 1);
  scene
    .placeNear(BUILD.castle, s.plaza.col + 2, s.plaza.row - 4)
    .placeNear(BUILD.house1, s.ondine.col - 4, s.ondine.row - 2)
    .placeNear(BUILD.house2, s.merchant.col + 3, s.merchant.row - 2)
    .placeNear(BUILD.house3, s.carpenter.col - 1, s.carpenter.row - 4)
    .placeNear(BUILD.houseYellow, s.fisher.col + 3, s.fisher.row - 3)
    .placeNear(BUILD.houseYellow2, s.mila.col + 3, s.mila.row - 3)
    .placeNear(BUILD.barracks, s.guard2.col + 5, s.guard2.row - 3)
    .placeNear(BUILD.monastery, s.chapel.col, s.chapel.row)
    .placeNear(BUILD.tower, s.watch1.col - 2, s.watch1.row - 1)
    .placeNear(WOOD, s.carpenter.col + 2, s.carpenter.row + 1)
    .placeNear(TOOLS[1] as EditorAssetId, s.carpenter.col + 2, s.carpenter.row + 2)
    .placeNear(GOLDPILE, s.merchant.col - 2, s.merchant.row + 1)
    .placeNear(MEAT, s.fisher.col - 2, s.fisher.row - 1)
    .place(DUCK, 26, 33)
    .place(DUCK, 29, 31)
    .dress({
      shoreTrees: 0.3,
      groves: 4,
      undergrowth: 0.06,
      inlandProps: PROPS,
      inlandDensity: 0.06,
      reefs: 0.06,
      clouds: 4,
    });

  const finished = scene.finish();
  return bundle(g, e.events, finished.elements, finished.layers, g.dock);
}

function contentReefs(g: Grounds["reefs"], dock: Dock, refs: StoryRefs): AdventureBundleMap {
  const e = createEventFactory("reefs", refs);
  const s = g.spots;

  npc(e, "camp-sign", "Écriteau renversé", s.campSign, GRAPHICS.sign, [
    "BRISANTS — Récifs. Passerelle interdite aux charges lourdes. Le mot « interdite » a été gratté et remplacé par « cassée ».",
  ]);

  e.normal("footbridge", "Passerelle brisée", s.footbridge, GRAPHICS.crate, [
    page(
      [
        say(
          null,
          "Les deux travées centrales manquent. Les madriers ont été sciés, proprement, du côté est.",
        ),
        say(
          null,
          "On les a coupées pour qu'on ne vienne pas voir. Maître Galiane saurait la refaire.",
        ),
        activity("passerelle_relevee"),
      ],
      { graphicAssetId: GRAPHICS.crate },
    ),
    page([say(null, "La passerelle neuve sent la résine. Elle tient bon sous le pas.")], {
      condSwitchId: S.reefBridge,
      graphicAssetId: GRAPHICS.crate,
    }),
  ]);

  e.normal("scout", "Éclaireur d’Ondine", s.scout, GRAPHICS.archerBlue, [
    page(
      [
        say(
          "Éclaireur",
          "Je compte leurs feux depuis trois nuits. Ils ne pillent pas : ils entassent. Barriques d'huile, cordages, poix.",
        ),
        say(
          "Éclaireur",
          "On ne prépare pas un pillage avec de l'huile. On prépare une flotte. Montez au camp et rapportez-moi un nom.",
        ),
        startQuest(Q.camp),
      ],
      { graphicAssetId: GRAPHICS.archerBlue },
    ),
    page(
      [
        say(
          "Éclaireur",
          "Grish est mort et le camp est froid. Le nom, c'est Varn. Ondine doit l'entendre de vous.",
        ),
        completeQuest(Q.camp),
      ],
      { condSwitchId: S.goblinCamp, graphicAssetId: GRAPHICS.archerBlue },
    ),
  ]);

  once(
    e,
    "oil",
    "Barriques d’huile",
    s.oil,
    GRAPHICS.crate,
    [
      say(
        null,
        "Six barriques marquées au fer du phare. Cinq sont pleines ; la sixième a servi à peindre une coque en noir.",
      ),
      say(
        null,
        "Sur le fût, une main gobeline a tracé un croissant renversé. Le même que sur la voile aperçue au large.",
      ),
      switchOn(S.lampOil),
      activity("huile_recuperee"),
      addVar(V.goblinThreat, 1),
    ],
    "Les barriques sont à vous. Elles pèsent leur poids d'huile.",
  );

  pack(e, "camp", "Pillard des Brisants", "spear_goblin", [s.camp1, s.camp2, s.camp3], {
    maxHp: 58,
    damage: 9,
    xp: 30,
    weakness: "warrior",
    weaknessPercent: 135,
    specialTechnique: "spear_fan",
  });

  e.monster(
    "shaman",
    "Grish, brûleur de fanaux",
    s.shaman,
    "hex_shaman",
    {
      rank: "elite",
      maxHp: 220,
      damage: 16,
      speed: 78,
      xp: 160,
      weakness: "ranger",
      weaknessPercent: 150,
      specialTechnique: "hex_burst",
    },
    [
      say(
        null,
        "Le chaman tombe sur ses propres braises. Le croissant renversé peint sur son bâton fume et se tord.",
      ),
      switchOn(S.goblinCamp),
      activity("camp_brise"),
      addVar(V.goblinThreat, 1),
      addVar(V.allies, 1),
    ],
  );

  e.monster("watcher", "Guetteur du chenal", s.watcher, "torch_goblin", {
    maxHp: 64,
    damage: 11,
    xp: 34,
    weakness: "ranger",
    weaknessPercent: 130,
    specialTechnique: "fire_burst",
  });

  e.monster("beach-raider", "Rôdeur de grève", s.beachRaider, "gnoll_marauder", {
    maxHp: 78,
    damage: 12,
    xp: 42,
    weakness: "warrior",
    weaknessPercent: 130,
    specialTechnique: "marauder_frenzy",
  });

  boat(
    e,
    "boat-port",
    "Chaloupe des Brisants",
    s.boatPort,
    { map: "port", ...dock("port") },
    null,
    "",
    "Retour à Port-Fanal.",
  );

  const { scene } = g;
  scene.reserve(e.events, 1);
  scene
    .placeNear(BUILD.goblinHouse, s.camp1.col + 3, s.camp1.row - 3)
    .placeNear(BUILD.goblinRuin, s.camp3.col + 2, s.camp3.row - 2)
    .placeNear(BUILD.goblinTower, s.shaman.col - 3, s.shaman.row - 2)
    .placeNear(BUILD.ruinTower, s.scout.col - 3, s.scout.row - 3)
    .placeNear(WOOD, s.oil.col - 2, s.oil.row + 2)
    .placeNear(MEAT, s.camp2.col - 2, s.camp2.row + 2)
    .placeNear(GOLD_STONES[0] as EditorAssetId, s.beachRaider.col + 3, s.beachRaider.row - 2)
    .dress({
      shoreTrees: 0.38,
      groves: 6,
      undergrowth: 0.08,
      inlandProps: stumpsAndProps(),
      inlandDensity: 0.05,
      reefs: 0.09,
      clouds: 3,
    });

  const finished = scene.finish();
  return bundle(g, e.events, finished.elements, finished.layers, g.dock);
}

function contentMarsh(g: Grounds["marsh"], dock: Dock, refs: StoryRefs): AdventureBundleMap {
  const e = createEventFactory("marsh", refs);
  const s = g.spots;

  npc(e, "sign", "Borne des salines", s.sign, GRAPHICS.sign, [
    "MARAIS DE SEL — Trois vannes, une seule règle : on les ouvre dans l'ordre de la marée, jamais toutes ensemble.",
  ]);

  e.normal("saline", "Sœur Saline", s.saline, GRAPHICS.saline, [
    page(
      [
        say(
          "Saline",
          "Le marais s'est arrêté de respirer. Les vannes sont bloquées et le sel ne prend plus.",
        ),
        say(
          "Saline",
          "Sans sel, pas de verre. Sans verre, pas de miroir. Et sans miroir, votre phare restera un rocher.",
        ),
        startQuest(Q.valves),
      ],
      { graphicAssetId: GRAPHICS.saline },
    ),
    page(
      [
        say("Saline", "L'eau court de nouveau. Le bassin blanchira d'ici l'aube."),
        say(
          "Saline",
          "Rallumez le four quand le sel aura pris. Le verre est à vous, vous l'avez payé de vos bottes.",
        ),
        startQuest(Q.glass),
      ],
      { condSwitchId: S.marshValves, graphicAssetId: GRAPHICS.saline },
    ),
  ]);

  for (const [index, spot] of [s.valve1, s.valve2, s.valve3].entries()) {
    const names = ["Vanne du levant", "Vanne du milieu", "Vanne du couchant"];
    once(
      e,
      `valve-${index + 1}`,
      String(names[index]),
      spot,
      GRAPHICS.valve,
      [
        say(
          null,
          "La crémaillère est prise dans le sel. Vous frappez, vous forcez — elle cède d'un cran, puis d'un tour.",
        ),
        addVar(V.valves, 1),
        activity("vanne_ouverte"),
        // Trois vannes ouvertes = le marais respire. La condition est lue sur la copie de travail du
        // drain, donc la troisième vanne voit bien sa propre incrémentation.
        ifVariable(V.valves, 3, [
          say(
            null,
            "Loin derrière vous, l'eau part d'un coup dans les trois canaux. Le marais entier se remet à bruire.",
          ),
          switchOn(S.marshValves),
        ]),
      ],
      "La vanne est ouverte à fond. L'eau file sans bruit.",
    );
  }

  e.normal("glass", "Four à verre", s.glass, GRAPHICS.crate, [
    page(
      [
        say(
          null,
          "Le four est froid et le bassin sec. Il faudrait que l'eau revienne avant d'espérer une seule galette de sel.",
        ),
      ],
      { graphicAssetId: GRAPHICS.crate },
    ),
    page(
      [
        say(
          null,
          "Le sel a pris en croûte. Vous en tirez une plaque, la passez au four, et le verre coule enfin — épais, vert, parfait pour un miroir de phare.",
        ),
        switchOn(S.saltGlass),
        activity("verre_coule"),
        addVar(V.salt, 1),
        items("mana_potion", 2),
        selfSwitchOn("A"),
      ],
      { condSwitchId: S.marshValves, graphicAssetId: GRAPHICS.crate },
    ),
    page([say(null, "Le four ronfle doucement. Le verre est déjà chez Ondine.")], {
      condSelfSwitch: "A",
      graphicAssetId: GRAPHICS.crate,
    }),
  ]);

  once(
    e,
    "mila-boat",
    "Canot vert",
    s.pan1,
    GRAPHICS.boat,
    [
      say(
        null,
        "Un canot vert échoué dans les roseaux, une étoile peinte à l'avant, à demi mangée par le sel.",
      ),
      say(null, "Il est intact. Il suffirait de le remorquer jusqu'au port."),
      switchOn(S.milaBoat),
      addVar(V.ondineTrust, 1),
    ],
    "Le canot est amarré à la plate. Mila sera contente.",
  );

  pack(e, "troll", "Troll des vases", "mire_troll", [s.troll1, s.troll2, s.troll3], {
    maxHp: 150,
    damage: 15,
    speed: 62,
    xp: 70,
    weakness: "priest",
    weaknessPercent: 140,
    specialTechnique: "troll_sweep",
  });

  e.monster(
    "gate-troll",
    "Barbotte, gardienne des vannes",
    s.gateTroll,
    "gate_troll",
    {
      rank: "elite",
      maxHp: 300,
      damage: 20,
      speed: 66,
      xp: 180,
      weakness: "priest",
      weaknessPercent: 150,
      specialTechnique: "troll_quake",
    },
    [
      say(
        null,
        "La trollesse s'affaisse dans son propre bassin. Le sel se referme sur elle, très blanc.",
      ),
      switchOn(S.trollsCleared),
      activity("marais_degage"),
      addVar(V.allies, 1),
    ],
  );

  boat(
    e,
    "boat-port",
    "Plate du marais",
    s.boatPort,
    { map: "port", ...dock("port") },
    null,
    "",
    "Retour à Port-Fanal.",
  );

  const { scene } = g;
  scene.reserve(e.events, 1);
  scene
    .placeNear(BUILD.ruinHouse, s.saline.col + 1, s.saline.row - 4)
    .placeNear(BUILD.towerYellow, s.pan2.col, s.pan2.row - 1)
    .placeNear(WOOD, s.glass.col - 2, s.glass.row + 2)
    .placeNear(TOOLS[3] as EditorAssetId, s.valve2.col + 2, s.valve2.row + 1)
    .place(DUCK, 5, 25)
    .place(DUCK, 44, 9)
    .dress({
      shoreTrees: 0.26,
      groves: 4,
      undergrowth: 0.11,
      inlandProps: stumpsAndProps(),
      inlandDensity: 0.07,
      reefs: 0.05,
      clouds: 3,
    });

  const finished = scene.finish();
  return bundle(g, e.events, finished.elements, finished.layers, g.dock);
}

function contentLighthouse(
  g: Grounds["lighthouse"],
  dock: Dock,
  refs: StoryRefs,
): AdventureBundleMap {
  const e = createEventFactory("lighthouse", refs);
  const s = g.spots;

  npc(e, "sign", "Stèle du gardien", s.sign, GRAPHICS.sign, [
    "MALEMER — Le fanal brûle pour ceux qui rentrent. Gravé dessous, plus récemment : « et pour ceux qui suivent. »",
  ]);

  e.normal("gate", "Seuil de Malemer", s.gate, null, [
    page(
      [
        enterArea("phare_malemer"),
        say(
          null,
          "Le rocher monte en deux paliers. Tout en haut, la lanterne est noire — et propre. Personne ne l'a laissée à l'abandon : quelqu'un l'entretient éteinte.",
        ),
      ],
      {
        trigger: "player-touch",
      },
    ),
  ]);

  pack(e, "bone", "Ossement du récif", "skull_guard", [s.bone1, s.bone2, s.bone3], {
    maxHp: 90,
    damage: 13,
    xp: 48,
    weakness: "priest",
    weaknessPercent: 145,
    specialTechnique: "bone_cleave",
  });

  e.monster("crusader", "Noyé en armes", s.crusader, "skull_crusader", {
    rank: "elite",
    maxHp: 190,
    damage: 18,
    xp: 120,
    weakness: "priest",
    weaknessPercent: 150,
    specialTechnique: "grave_siphon",
  });

  e.monster(
    "warden",
    "Le Veilleur de Malemer",
    s.warden,
    "skull_warden",
    {
      rank: "boss",
      maxHp: 620,
      damage: 26,
      speed: 74,
      xp: 400,
      weakness: "priest",
      weaknessPercent: 160,
      specialTechnique: "grave_siphon",
    },
    [
      say(
        null,
        "L'armure s'ouvre et se vide. Dessous, il n'y a qu'un manteau de gardien, plié avec soin, et une clef de lanterne.",
      ),
      switchOn(S.aldemarUnmasked),
      activity("veilleur_abattu"),
      addVar(V.allies, 1),
    ],
  );

  e.normal("aldemar", "Aldemar, gardien du fanal", s.aldemar, GRAPHICS.aldemar, [
    page(
      [
        say(
          "Aldemar",
          "N'approchez pas de la lanterne. Vous ne savez pas ce que vous rallumeriez.",
        ),
        say(
          "Aldemar",
          "Abattez d'abord ce que j'ai mis devant la porte, si vous y tenez. Ensuite nous parlerons.",
        ),
      ],
      { graphicAssetId: GRAPHICS.aldemar },
    ),
    page(
      [
        say("Aldemar", "Vous avez tué mon veilleur. Soit. Alors écoutez ce qu'il gardait."),
        say(
          "Aldemar",
          "Le fanal ne guide pas seulement les nôtres. Varn le suit. Trois lunes que je le tiens dans le noir, et trois lunes qu'aucune de ses voiles n'a trouvé la rade.",
        ),
        say(
          "Aldemar",
          "Cinq navires ont donné sur le récif, oui. J'ai compté chaque nom. Je les compte encore la nuit.",
        ),
        switchOn(S.eclipseTruth),
        addVar(V.aldemarSecrets, 2),
        choice("Que faire du gardien ?", [
          {
            label: "L’épargner : il connaît la lanterne",
            body: [
              say(
                "Aldemar",
                "Alors je monterai avec vous. Et si je me suis trompé, vous me le direz en face.",
              ),
              switchOn(S.aldemarSpared),
              addVar(V.allies, 1),
              addVar(V.ondineTrust, 1),
            ],
          },
          {
            label: "L’abattre : cinq navires valent bien un homme",
            body: [
              say(
                null,
                "Il ne lève pas la main. Il regarde la mer pendant que vous approchez, et il compte à voix basse.",
              ),
              switchOn(S.aldemarSlain),
              addVar(V.aldemarSecrets, 1),
            ],
          },
          {
            label: "Le laisser au noir et monter seul",
            body: [
              say("Aldemar", "Faites. Je resterai là. Quelqu'un doit rester là."),
              addVar(V.aldemarSecrets, 1),
            ],
          },
        ]),
        selfSwitchOn("A"),
      ],
      { condSwitchId: S.aldemarUnmasked, graphicAssetId: GRAPHICS.aldemar },
    ),
    page(
      [
        ifSwitch(
          S.aldemarSpared,
          [say("Aldemar", "La lanterne est prête. C'est vous qui direz quand.")],
          [
            say(
              null,
              "Le manteau du gardien est resté plié sur la rambarde. Personne ne l'a repris.",
            ),
          ],
        ),
      ],
      { condSelfSwitch: "A", graphicAssetId: GRAPHICS.aldemar },
    ),
  ]);

  e.normal("mirror", "Miroir du fanal", s.mirror, GRAPHICS.flame, [
    page(
      [
        say(
          null,
          "Le cadre du miroir est nu : ni huile dans la réserve, ni verre dans la monture. On ne rallume rien avec un cadre vide.",
        ),
      ],
      { graphicAssetId: GRAPHICS.flame },
    ),
    page(
      [
        say(
          null,
          "Vous coulez le verre de sel dans la monture, remplissez la réserve d'huile des Brisants. Le miroir reprend d'un coup toute la lumière du ciel.",
        ),
        say(null, "Il ne manque plus que la flamme — et la décision de la donner."),
        switchOn(S.mirrorRepaired),
        activity("miroir_repare"),
        addVar(V.beacons, 1),
        addVar(V.mirrorShards, 3),
        selfSwitchOn("A"),
      ],
      { condSwitchId: S.eclipseTruth, graphicAssetId: GRAPHICS.flame },
    ),
    page(
      [
        say(
          null,
          "Le miroir est monté, la réserve pleine. La baie n'attend plus qu'une allumette.",
        ),
        say(null, "Ondine a fait armer les Cent Voiles. Elle vous attend sur la plage."),
        switchOn(S.fleetSighted),
      ],
      { condSelfSwitch: "A", graphicAssetId: GRAPHICS.flame },
    ),
  ]);

  once(
    e,
    "lens",
    "Réserve du gardien",
    s.lens,
    GRAPHICS.chest,
    [
      say(
        null,
        "Sous la couchette : trois lunes de rations comptées, un carnet de relevés, et une bourse que le gardien n'a jamais ouverte.",
      ),
      gold(90),
      items("health_potion", 3),
      items("mana_potion", 1),
      addVar(V.aldemarSecrets, 1),
    ],
    "La réserve est vide. Le carnet, lui, vous l'avez gardé.",
  );

  boat(
    e,
    "boat-battle",
    "Canot du gardien",
    s.boatPort,
    { map: "battle", ...dock("battle") },
    S.mirrorRepaired,
    "Le canot vous ramènerait au port, mais le miroir n'est pas remonté. Vous n'êtes pas venu jusqu'ici pour redescendre.",
    "Cap sur la plage des Cent Voiles. Ondine y a rangé tout ce qui flotte encore.",
  );

  const { scene } = g;
  scene.reserve(e.events, 1);
  scene
    .placeNear(BUILD.tower, s.mirror.col + 2, s.mirror.row - 1)
    .placeNear(BUILD.ruinCastle, s.warden.col - 4, s.warden.row - 3)
    .placeNear(BUILD.ruinTower, s.bone3.col - 1, s.bone3.row - 2)
    .placeNear(GOLD_STONES[1] as EditorAssetId, s.crusader.col + 3, s.crusader.row + 1)
    .placeNear(TOOLS[0] as EditorAssetId, s.lens.col - 1, s.lens.row + 2)
    .dress({
      shoreTrees: 0.22,
      groves: 2,
      undergrowth: 0.09,
      inlandProps: stumpsAndProps(),
      inlandDensity: 0.04,
      reefs: 0.11,
      clouds: 4,
    });

  const finished = scene.finish();
  return bundle(g, e.events, finished.elements, finished.layers, g.dock);
}

function contentBattle(g: Grounds["battle"], refs: StoryRefs): AdventureBundleMap {
  const e = createEventFactory("battle", refs);
  const s = g.spots;

  e.normal("rally", "Ligne de sable", s.rally, null, [
    page(
      [
        enterArea("plage_cent_voiles"),
        say(
          "Ondine",
          "Ils ont doublé la pointe à l'aube. Cent voiles, et pas une seule qui rentre chez elle.",
        ),
        say("Ondine", "Tenez le sable. Quand Varn tombera, la baie décidera de sa lumière."),
      ],
      { trigger: "player-touch" },
    ),
  ]);

  // Chaque allié gagné en chemin devient une lance de plus sur la plage. Rien n'est scripté : la
  // page conditionnelle du garde décide seule si le renfort existe dans cette partie.
  e.guard("ally-1", "Lancier d’Ondine", s.ally1, 260, S.ondineAllied);
  e.guard("ally-2", "Guet de Port-Fanal", s.ally2, 260, S.portWatch);
  e.guard("ally-3", "Batteur des Brisants", s.ally3, 260, S.goblinCamp);
  e.guard("ally-4", "Saunier du marais", s.ally4, 260, S.trollsCleared);

  pack(
    e,
    "raider",
    "Pillard de Varn",
    "spear_goblin",
    [s.raider1, s.raider2, s.raider3, s.raider4],
    {
      maxHp: 72,
      damage: 12,
      xp: 44,
      weakness: "warrior",
      weaknessPercent: 130,
      specialTechnique: "spear_fan",
    },
  );

  pack(e, "torch", "Incendiaire", "torch_goblin", [s.torch1, s.torch2], {
    maxHp: 84,
    damage: 15,
    xp: 55,
    weakness: "ranger",
    weaknessPercent: 140,
    specialTechnique: "fire_burst",
  });

  pack(e, "boar", "Sanglier de guerre", "war_pig", [s.boar1, s.boar2], {
    maxHp: 160,
    damage: 18,
    speed: 96,
    xp: 90,
    weakness: "warrior",
    weaknessPercent: 135,
    specialTechnique: "tusk_charge",
  });

  e.monster(
    "varn",
    "Varn, le Croissant renversé",
    s.varn,
    "pig_rider",
    {
      rank: "boss",
      maxHp: 900,
      damage: 32,
      speed: 104,
      xp: 700,
      weakness: "ranger",
      weaknessPercent: 160,
      specialTechnique: "mounted_trample",
    },
    [
      say(
        null,
        "La monture s'écroule, le cavalier roule dans le ressac. Sur son pavois, le croissant renversé se remplit de sable.",
      ),
      say(null, "Au large, les voiles hésitent. Elles suivaient un homme ; il n'y a plus d'homme."),
      switchOn(S.varnDefeated),
      switchOn(S.beachHeld),
      activity("varn_abattu"),
      addVar(V.sailsSaved, 1),
    ],
  );

  e.normal("ending", "La décision de la baie", s.ending, GRAPHICS.flame, [
    page(
      [
        say(
          null,
          "La plage n'est pas encore tenue. Tant que Varn charge, personne ne décide de rien.",
        ),
      ],
      { graphicAssetId: GRAPHICS.flame },
    ),
    page(
      [
        say(
          "Ondine",
          "Voilà. La plage est à nous, et le miroir attend là-haut. Trois façons d'en finir, et aucune n'est gratuite.",
        ),
        completeQuest(Q.lighthouse),
        choice("Que devient le fanal de Malemer ?", [
          {
            label: "Le rallumer maintenant",
            body: [
              say(
                null,
                "La flamme prend d'un coup et la baie entière se dessine. Les navires perdus trouvent la rade avant la nuit.",
              ),
              say(
                null,
                "Au large, ce qui reste de la flotte noire trouve la rade aussi. Port-Fanal vivra en armes, et le saura.",
              ),
              switchOn(S.endingRelit),
              addVar(V.sailsSaved, 3),
            ],
          },
          {
            label: "Briser le miroir : plus jamais de lumière",
            body: [
              say(
                null,
                "Le verre de sel éclate sous le marteau. La baie restera noire, et personne ne la trouvera plus — ni ami, ni ennemi.",
              ),
              say(
                null,
                "Les pêcheurs rentreront à la sonde et au souvenir. Certains ne rentreront pas.",
              ),
              switchOn(S.endingShattered),
              addVar(V.sailsSaved, 1),
            ],
          },
          {
            label: "Évacuer la baie, puis rallumer",
            body: [
              ifVariable(
                V.allies,
                5,
                [
                  say(
                    "Ondine",
                    "Trois jours pour vider les îles, et on rallume sur une rade vide. Il faut assez de bras — et nous les avons.",
                  ),
                  say(
                    null,
                    "Le quatrième soir, le fanal se rallume sur une baie déserte. La flotte de Varn entre dans un piège éclairé.",
                  ),
                  switchOn(S.bayEvacuated),
                  switchOn(S.endingEvacuated),
                  addVar(V.sailsSaved, 5),
                ],
                [
                  say(
                    "Ondine",
                    "Vider six îles en trois jours avec ce que nous sommes ? Nous laisserions plus de monde derrière que la mer n'en prendrait.",
                  ),
                  say(null, "Le plan est reposé sur la table. Il faudra choisir autrement."),
                ],
              ),
            ],
          },
        ]),
        // Le choix « évacuer » peut être refusé faute d'alliés : on ne clôt l'aventure que si une fin
        // a réellement été prononcée. Sans ce garde, un refus terminerait quand même la partie.
        ifSwitch(S.endingRelit, [switchOn(S.finished), endAdventure()]),
        ifSwitch(S.endingShattered, [switchOn(S.finished), endAdventure()]),
        ifSwitch(S.endingEvacuated, [switchOn(S.finished), endAdventure()]),
      ],
      { condSwitchId: S.beachHeld, graphicAssetId: GRAPHICS.flame },
    ),
  ]);

  const { scene } = g;
  scene.reserve(e.events, 1);
  scene
    .placeNear(BUILD.blackTower, s.camp.col, s.camp.row)
    .placeNear(BUILD.blackBarracks, s.camp.col + 6, s.camp.row + 2)
    .placeNear(BUILD.blackHouse, s.varn.col - 2, s.varn.row - 4)
    .placeNear(BUILD.ruinHouse, s.rally.col - 3, s.rally.row - 4)
    .placeNear(WOOD, s.line1.col - 1, s.line1.row - 2)
    .placeNear(MEAT, s.camp.col + 3, s.camp.row + 1)
    .placeNear(GOLD_STONES[2] as EditorAssetId, s.boar1.col - 3, s.boar1.row - 3)
    .dress({
      shoreTrees: 0.24,
      groves: 3,
      undergrowth: 0.06,
      inlandProps: stumpsAndProps(),
      inlandDensity: 0.05,
      reefs: 0.08,
      clouds: 5,
    });

  const finished = scene.finish();
  return bundle(g, e.events, finished.elements, finished.layers, g.dock);
}
