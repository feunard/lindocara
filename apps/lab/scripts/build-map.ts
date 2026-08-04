// Task 10 : produit `public/maps/ile.json`, la carte que le labo charge désormais au démarrage
// au lieu de la générer. `generateIsland` (`src/world/island.ts`) ne disparaît pas — il cesse
// d'être une dépendance d'EXÉCUTION du labo pour devenir un outil de PRODUCTION de données, ce
// script étant son seul appelant. `decidePlacements` (`src/world/props.ts`) fait de même pour les
// props : décision pure (position/échelle/collider), sans jamais construire un billboard, donc
// appelable ici en Node comme au chargement dans le navigateur.
//
// Run: npm run build:map -w @lindocara/lab

import { writeFileSync } from "node:fs";
import type { ColliderRect } from "@lindocara/engine/hd2d/collider-index.js";
import { encodeMap, type MapData } from "@lindocara/engine/hd2d/map-data.js";
import type { TerrainMaterial } from "@lindocara/engine/hd2d/terrain-query.js";
import { GROTA, NANUQ, SPAWN, WORLD } from "../src/settings.js";
import { CHEST_RADIUS, decideChestPlacement } from "../src/world/chest.js";
import {
  decideHousePlacement,
  decideSakuraPlacement,
  HOUSE_FOOTPRINT_RADIUS,
  SAKURA_RADIUS,
} from "../src/world/house.js";
import { generateIsland } from "../src/world/island.js";
import { decidePlacements } from "../src/world/props.js";

const { field, query } = generateIsland({ size: WORLD.size, seed: WORLD.seed });
const size = field.cols;

// --- relief et matières -------------------------------------------------------------------------
// `levels` reprend `field.levelAt` tel quel (le palier BRUT, pas la hauteur monde — c'est
// `levelHeight` qui la porte séparément dans `MapData`). `materials` reprend la matière de RÈGLE
// (`query.kindAt`, cinq valeurs — sable/herbe/neige/glace/glace-fine), PAS la bande de rendu de
// `field.materialAt` ("lvl0"/"lvl1"/"lvl2" pour l'herbe) : celle-ci n'est qu'une dérivation
// (matière, palier) → bloc d'atlas que `mapToHeightField`/`renderMaterialAt` (`island.ts`)
// recalculent au chargement, jamais une donnée en soi — la sérialiser aurait de toute façon été
// rejetée par `decodeMap` (`TerrainMaterial` n'inclut pas "lvl0").
const levels = new Array<number | null>(size * size);
const materials = new Array<TerrainMaterial>(size * size);
for (let j = 0; j < size; j++) {
  for (let i = 0; i < size; i++) {
    const idx = j * size + i;
    const h = field.levelAt(i, j);
    // Garde : `encodeMap` s'appuie sur `JSON.stringify`, qui sérialise silencieusement `NaN`/
    // `Infinity` en `null` — une hauteur cassée deviendrait donc de l'eau dans la carte produite,
    // sans un mot. Le générateur actuel n'assigne que des entiers 0/1/2 (voir `island.ts`,
    // `makeHeightmap`), donc ce cas ne se présente pas aujourd'hui — mais une évolution future du
    // générateur ne doit pas pouvoir corrompre la carte en silence : on échoue bruyamment ici,
    // au moment de la génération, plutôt que de laisser `decodeMap` avaler un `null` mensonger.
    if (h !== null && !Number.isFinite(h)) {
      throw new Error(`Hauteur non finie en case (${i}, ${j}) : ${h}`);
    }
    levels[idx] = h;
    if (h === null) {
      // Sans signification là où `levels` vaut `null` (voir `MapData`) : n'importe quelle valeur
      // valide fait l'affaire.
      materials[idx] = "herbe";
      continue;
    }
    const [x, z] = query.cellCenter(i, j);
    materials[idx] = query.kindAt(x, z) ?? "herbe";
  }
}

// --- colliders des props --------------------------------------------------------------------------
// `decidePlacements` décide tout ce que l'ancien `populate` tirait au hasard (arbres, décors,
// buissons, sapins, stalagmites) plus le feu et la source, fixes. Seuls les cinq premiers kinds
// PEUVENT porter un collider (`Placement.collider`) ; décors/buissons restent `null` (traversables).
const plan = decidePlacements(field, query, WORLD.seed + 7, SPAWN);
const colliders: ColliderRect[] = [];
for (const p of plan.placements) if (p.collider) colliders.push(p.collider);
if (plan.fire.collider) colliders.push(plan.fire.collider);
colliders.push(plan.spring.collider);

// --- les cinq colliders que `main.ts` enregistrait encore à l'assemblage de la scène, jamais
// via la carte (relevé de la revue finale du chantier S2) : Grota, Nanuq, la maison, le cerisier
// et le coffre. Leurs positions sont toutes des fonctions déterministes de `field`/`query`/de
// réglages fixes, exactement comme les props ci-dessus — la carte peut donc porter TOUTE la
// collision du labo, pas seulement la plus grande part. Ajoutés APRÈS les colliders existants
// plutôt qu'entremêlés : ça garde les index des 57 colliders déjà livrés stables.
const rectFor = (at: readonly [number, number], radius: number): ColliderRect => ({
  x: at[0] - radius,
  z: at[1] - radius,
  w: 2 * radius,
  h: 2 * radius,
});
colliders.push(rectFor(GROTA.at, GROTA.radius));
colliders.push(rectFor(NANUQ.at, NANUQ.radius));

const maison = decideHousePlacement(query);
if (maison) {
  colliders.push(rectFor(maison, HOUSE_FOOTPRINT_RADIUS));
  const sakura = decideSakuraPlacement(maison, query);
  if (sakura) colliders.push(rectFor(sakura, SAKURA_RADIUS));
}

const coffre = decideChestPlacement(field, query);
if (coffre) colliders.push(rectFor([coffre.x, coffre.z], CHEST_RADIUS));

const map: MapData = {
  version: 1,
  size,
  levelHeight: WORLD.levelHeight,
  waterLevel: WORLD.waterLevel,
  levels,
  materials,
  colliders,
  // Le spawn du héros (`settings.ts`, `SPAWN`) est un point fixe unique : rien dans cette task ne
  // fait encore LIRE le spawn depuis la carte (`main.ts` continue de lire `SPAWN` directement),
  // mais l'écrire ici coûte une ligne et prépare le jour où ce sera le cas.
  spawns: [{ name: "default", x: SPAWN[0], z: SPAWN[1] }],
  // Le lab n'a ni décor authoré ni événements : ces deux champs existent pour le jeu, pas pour lui.
  elements: [],
  events: [],
};

const dest = new URL("../public/maps/ile.json", import.meta.url);
writeFileSync(dest, encodeMap(map));
console.log(`Carte écrite : ${dest.pathname} — ${size}x${size}, ${colliders.length} colliders.`);
