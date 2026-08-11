import { createColliderIndex } from "@lindocara/engine/hd2d/collider-index.js";
import { decodeMap, mapToQuerySource } from "@lindocara/engine/hd2d/map-data.js";
import { createTerrainQuery } from "@lindocara/engine/hd2d/terrain-query.js";
import { makeBillboard, RIM_LAYER } from "@lindocara/hd2d/billboard.js";
import { createCloudCover } from "@lindocara/hd2d/clouds.js";
import { createHd2dContext, type Hd2dContext } from "@lindocara/hd2d/context.js";
import { fillAmount } from "@lindocara/hd2d/fill-light.js";
import { fetchAll } from "@lindocara/hd2d/loader.js";
import { createMoodMixer } from "@lindocara/hd2d/mood.js";
import { createParticleField, createPetalFall } from "@lindocara/hd2d/particles.js";
import { createPipeline } from "@lindocara/hd2d/pipeline.js";
import { createSky } from "@lindocara/hd2d/sky.js";
import type { TerrainAtlas } from "@lindocara/hd2d/terrain/atlas.js";
import { createFoam, FOAM_SPREAD } from "@lindocara/hd2d/terrain/foam.js";
import { meshTerrain } from "@lindocara/hd2d/terrain/mesh.js";
import { createWater } from "@lindocara/hd2d/terrain/water.js";
import { createWaterfall } from "@lindocara/hd2d/terrain/waterfall.js";
import { createTextureRegistry } from "@lindocara/hd2d/textures.js";
import * as THREE from "three";
import {
  BENCH_CENTER_OFFSET,
  type BenchLevel,
  type BenchSnapshot,
  benchStillValid,
  createBench,
} from "./bench.js";
import {
  AUDIO_URLS,
  closeDoor,
  ding,
  gust,
  initAudio,
  musicEnabled,
  openDoor,
  sayLine,
  setAmbience,
  setCascadeDistance,
  setFireDistance,
  setZoneMusic,
  stopLine,
  toggleMusic,
  unlockAudio,
} from "./core/audio.js";
import { createDialog, createPrompt } from "./core/dialog.js";
import { createInput, type InputSample } from "./core/input.js";
import {
  AURORE,
  BLIZZARD,
  CAMERA,
  FALLS_FOG,
  MOOD_FADE,
  MOODS,
  MOUNTAIN,
  MOUNTAIN_FACE_Z,
  NEIGE_CHUTE,
  NORD,
  RAINBOW,
  SPAWN,
  SUN_DRIFT,
  TARGET_FPS,
  TEXTURE_URLS,
  WATER,
  WATERFALLS,
  WORLD,
  ZONE_FALLS,
  ZONE_LARGE,
  ZONE_POLAIRE,
  ZONES,
} from "./settings.js";
import { createChest } from "./world/chest.js";
import { createDebugView } from "./world/debug.js";
import { createHero } from "./world/hero.js";
import {
  createHouse,
  decideHousePlacement,
  decideSakuraPlacement,
  SAKURA_RADIUS,
} from "./world/house.js";
import { createInterior } from "./world/interior.js";
import { mapToHeightField } from "./world/island.js";
import { createGrota } from "./world/npc.js";
import { populate, windPhase } from "./world/props.js";
import { createSnowNpc } from "./world/snow-npc.js";
import { createWaterfallFx } from "./world/waterfall-fx.js";
import { type Zone, zoneAt } from "./world/zones.js";

// Task 10 : l'île n'est plus générée au démarrage, elle est CHARGÉE — `world/island.ts`
// (`generateIsland`) reste le seul outil qui sait la produire, mais devient un outil de
// PRODUCTION de données (`scripts/build-map.ts`), plus une dépendance d'exécution du labo. La
// carte rejoint donc les textures et les sons dans la barre de chargement, pondérée en octets
// comme le reste (voir `avancement` plus bas).
const MAP_URL = "/maps/ile.json";

// --- chargement -------------------------------------------------------------------------------
// Tout est chargé AVANT de construire quoi que ce soit : la scène naît complète, et aucun sprite
// ne se clone sur une image encore vide.
//
// Le pourcentage se répartit sur deux temps. Le téléchargement pèse 85 % : il est suivi en
// octets, seule mesure honnête quand deux fichiers de musique pèsent plus que les soixante
// autres réunis. Le décodage — images vers textures, OGG vers tampons audio — prend les 15
// derniers, et les deux décodages tournent de front (chacun compte pour sa moitié).
const texteChargement = document.getElementById("load-text");
const barreChargement = document.getElementById("load-fill");
let partTelechargee = 0;
let partDecodee = 0;

function avancement(): void {
  const p = Math.round((partTelechargee * 0.85 + partDecodee * 0.15) * 100);
  if (texteChargement) texteChargement.textContent = `CHARGEMENT ${p} %`;
  if (barreChargement) barreChargement.style.width = `${p}%`;
}

const blobs = await fetchAll([...TEXTURE_URLS.map((t) => t.url), ...AUDIO_URLS, MAP_URL], (p) => {
  partTelechargee = p;
  avancement();
});

const textures = createTextureRegistry(TEXTURE_URLS);
let imagesFaites = 0;
let sonsFaits = 0;
const decode = (): void => {
  partDecodee = (imagesFaites + sonsFaits) / 2;
  avancement();
};
await Promise.all([
  textures.decode(blobs, (p) => {
    imagesFaites = p;
    decode();
  }),
  initAudio(blobs, (p) => {
    sonsFaits = p;
    decode();
  }),
]);

const canvas = document.getElementById("view") as HTMLCanvasElement;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, 0.5, 220);

const ctx = createHd2dContext();

// --- monde ------------------------------------------------------------------------------------
// La carte remplace `generateIsland` comme source de vérité (Task 10) : `decodeMap` ne jette
// jamais, mais une carte absente ou corrompue laisserait le labo démarrer sur un monde vide sans
// rien dire — un échec bruyant ici vaut mieux qu'une île silencieusement plate.
const carteBlob = blobs.get(MAP_URL);
if (!carteBlob) throw new Error(`Carte introuvable au chargement : ${MAP_URL}`);
const carte = decodeMap(await carteBlob.text());
if (!carte)
  throw new Error(`Carte invalide : ${MAP_URL} (relancer "npm run build:map -w @lindocara/lab")`);

const field = mapToHeightField(carte);
const query = createTerrainQuery(mapToQuerySource(carte));

// Un atlas par clé de matière (voir `HeightField.materialAt`, `island.ts`). `TerrainAtlas.block`
// dit quel bloc 4x4 l'image contient (voir `atlas.ts`) : dans le tileset du Free Pack, le palier 0
// borde toujours l'EAU directement (une case de palier 0 ne porte jamais de paroi face à la mer,
// voir `wallDrop` — c'est l'herbe qui touche la mer, pas une falaise), donc son atlas ("lvl0") est
// le bloc à liseré d'écume. Les paliers 1 et 2 bordent forcément un VIDE (ils dominent un voisin
// plus bas, jamais l'eau elle-même) : leur atlas prend le bloc à bordure touffue, celui qui se
// raccorde à la paroi. Le sable n'existe qu'au palier 0 lui aussi (jamais de paroi), mais son
// image (Update 010, `Tilemap_Flat.png`) réutilise la MÊME disposition de colonnes que le bloc à
// bordure touffue pour son propre liseré sable-contre-herbe — colonne 5, comme `CLIFF_EDGE_COL`.
const atlases: Record<string, TerrainAtlas> = {
  lvl0: {
    texture: textures.get("/tex/tileset-lvl0.png"),
    cols: 9,
    rows: 6,
    block: "water-edge",
    wallRow: 4,
    tilePx: 64,
  },
  lvl1: {
    texture: textures.get("/tex/tileset-lvl1.png"),
    cols: 9,
    rows: 6,
    block: "cliff-edge",
    wallRow: 4,
    tilePx: 64,
  },
  lvl2: {
    texture: textures.get("/tex/tileset-lvl2.png"),
    cols: 9,
    rows: 6,
    block: "cliff-edge",
    wallRow: 4,
    tilePx: 64,
  },
  // Jamais de paroi pour le sable (toujours au palier 0) : `wallRow` n'est ici jamais lu, gardé à
  // 4 par cohérence avec les autres atlas plutôt que par nécessité.
  sable: {
    texture: textures.get("/tex/tileset-sand.png"),
    cols: 10,
    rows: 4,
    block: "cliff-edge",
    wallRow: 4,
    tilePx: 64,
  },
  // Task 2 : surfaces générées sur la géométrie d'origine (voir `scripts/compose-tileset.py`).
  // Même bloc/mêmes colonnes que `lvl0`/`lvl1` : seul le remplissage a changé, la découpe et les
  neige: {
    texture: textures.get("/tex/tileset-neige.png"),
    cols: 9,
    rows: 6,
    block: "water-edge",
    wallRow: 4,
    tilePx: 64,
  },
  glace: {
    texture: textures.get("/tex/tileset-glace.png"),
    cols: 9,
    rows: 6,
    block: "cliff-edge",
    wallRow: 4,
    tilePx: 64,
  },
  // The mountain's rock (Task 1 of the waterfall chantier). `block: "cliff-edge"` like `lvl1`/
  // `lvl2`: a rock terrace always overlooks a lower neighbour, never the sea directly, so it needs
  // the tufted border block that joins onto a wall — not the water-edge one with foam painted in.
  roche: {
    texture: textures.get("/tex/tileset-roche.png"),
    cols: 9,
    rows: 6,
    block: "cliff-edge",
    wallRow: 4,
    tilePx: 64,
  },
};

const terrainMesh = meshTerrain(ctx, field, { atlases, levelHeight: WORLD.levelHeight });
scene.add(terrainMesh.group);

// Un plan trois fois plus large que la grille : assez pour que la mer se perde dans le brouillard
// avant sa propre bordure, à tous les zooms.
const water = createWater(ctx, field, {
  texture: textures.get("/tex/water.png"),
  level: WORLD.waterLevel,
  size: WORLD.size * 3,
  segment: WATER.segment,
  depthRange: WATER.depthRange,
  roughness: WATER.roughness,
});
scene.add(water.mesh);

const foam = createFoam(ctx, field, {
  texture: textures.get("/tex/foam.png"),
  frames: 8,
  fps: 7,
  spread: FOAM_SPREAD,
  waterLevel: WORLD.waterLevel,
});
scene.add(foam.group);

// The waterfall: ONE sheet straight down the mountain's sheer south face, from the summit to the
// ground. See `WATERFALLS` (`settings.ts`) for why south, why one, and why these numbers are
// measured rather than derived.
const waterfalls = WATERFALLS.map((w) =>
  createWaterfall(ctx, {
    texture: textures.get("/tex/water.png"),
    x: w.x,
    z: w.z,
    width: w.width,
    topY: w.topLevel * WORLD.levelHeight,
    bottomY: w.bottomLevel * WORLD.levelHeight,
    facing: w.facing,
    poolOffset: w.poolOffset,
  }),
);
for (const w of waterfalls) scene.add(w.group);

// The two pools are REAL WATER — `createWater`, the same surface the sea is made of, given a
// `center` and a `level` so it can sit somewhere other than the world origin and higher than zero.
// They were flat shaded discs first, and read as blue paint: what makes the sea in this scene look
// wet is its four crossed swells, its sparkle and its mood-driven colours, and a bespoke shader has
// none of those. `shallow: 1` because a pool is all bank — the field's depth gradient answers a
// question ("how far to the nearest land") that means nothing this small.
// The spring is exactly the fall's width, so the water that pours over the lip is the water that
// falls. Derived from the placement rather than typed twice: they cannot drift apart.
const SPRING_SIZE = WATERFALLS[0]?.width ?? 3;

const pools = [
  // ONLY the summit spring is a placed surface. The plunge pool at the foot of the fall is CUT INTO
  // the terrain instead (`isPlungePool`, `world/island.ts`) — it lands at level 0, a hair above the
  // global water level, so the sea itself shows through the hole and `createFoam` rings it with
  // foam for free. A pool at ELEVATION cannot be cut that way: the hole would open a shaft to the
  // sea 3.6 units below. That is what `center`/`level` are for, and this is the one that needs it.
  createWater(ctx, field, {
    texture: textures.get("/tex/water.png"),
    level: 4 * WORLD.levelHeight + 0.02,
    // As wide as the fall, and reaching exactly to the lip: its SOUTH edge sits on
    // `MOUNTAIN_FACE_Z`, so the spring runs to the cliff and pours over the sheet's top rather
    // than stopping a metre short with a band of bare rock between the two — which is what a
    // centre chosen by eye left, and which read as a pond that happened to be near a waterfall.
    size: SPRING_SIZE,
    segment: 0.35,
    depthRange: WATER.depthRange,
    roughness: WATER.roughness,
    center: [MOUNTAIN.x, MOUNTAIN_FACE_Z - SPRING_SIZE / 2],
    // Not fully shallow: a flat single tone reads as painted mint. Mid-depth lets the swell
    // normals and the sparkle actually show, which is what says "water" at this size.
    shallow: 0.55,
  }),
];
for (const p of pools) scene.add(p.mesh);

// Mist, spray and the rainbow: anchored to the fall's own impact point rather than recomputing it
// from the placement, so the effects can never drift from where the water actually lands.
const waterfallFx = createWaterfallFx(
  ctx,
  waterfalls.map((w) => w.impact),
  textures.get("/tex/water-fog.png"),
);
scene.add(waterfallFx.group);

// `colliders` est créé ICI, dans le composition root, parce que le héros — créé juste après
// Grota — doit voir la MÊME instance que celle que Grota/Nanuq peuplent ensuite : contrairement au
// PoC, où `props.js` fabriquait et possédait ses propres colliders, l'architecture du labo (Task
// 11) fait de `main.ts` le propriétaire de `colliders`.
//
// Task 10 : les colliders des PROPS (arbres, rochers, feu, source chaude) ne sont plus déclarés
// par `populate` — ils viennent de la carte, chargée une fois pour toutes. `populate` continue de
// créer les billboards (mêmes positions, même graine — voir `world/props.ts`, `decidePlacements`),
// mais n'écrit plus dans `colliders`.
const colliders = createColliderIndex();
for (const c of carte.colliders) colliders.add(c);

const props = populate(ctx, textures, field, query, SPAWN);
scene.add(props.group);

// Grota AVANT le héros : il déclare son collider, que le héros doit connaître.
const grota = createGrota(ctx, textures, query, colliders);
scene.add(grota.object);

// Nanuq, l'habitant de la banquise (Task 12 de l'île de neige) : même raison, même ordre — son
// collider doit exister avant que le héros ne soit construit.
const nanuq = createSnowNpc(ctx, textures, query, colliders);
scene.add(nanuq.object);

const hero = createHero(ctx, textures, query, colliders, SPAWN);
scene.add(hero.object);
scene.add(hero.effects);

// Couverture nuageuse : dérive et multiplie l'albédo du décor ET des sprites, sans passe d'ombre
// supplémentaire.
const clouds = createCloudCover(ctx);

// Braises du foyer, lucioles de nuit, pollen de jour : rien n'éclaire, c'est du mouvement dans le
// vide entre les sprites — la Task 11 avait laissé ce câblage en attente du foyer, posé ici par
// `populate`.
const particles = createParticleField(ctx, { firePosition: props.firePosition, worldRadius: 22 });
scene.add(particles.group);

// Chutes de neige (Task 8 de l'île de neige) : la même mécanique de chute que le cerisier
// (`createPetalFall`), recolorée/redensifiée pour lire comme des flocons plutôt que des pétales —
// `PetalFallOptions.color`/`count`/`size` (voir `packages/hd2d/src/particles.ts`, dont le rapport
// de cette task explique le touché). `neigeCentre` est un `THREE.Vector3` MUTÉ chaque image dans
// la boucle (voir plus bas) pour suivre le héros, x/y/z compris — `createPetalFall` relit
// `centre.x`/`centre.y`/`centre.z` à chaque respawn de grain (correction du round 1 de revue :
// `y` était lu une seule fois à la construction, donc figé sur l'altitude du spawn, alors que la
// banquise a du relief — un flocon pouvait traverser le sol ou flotter au-dessus dès qu'on
// s'éloignait du point de départ), donc rien d'autre n'est nécessaire pour que le champ suive sans
// jamais réallouer. Ambiguïté 5 du brief : un rayon autour du héros, pas toute la zone — en
// couvrir toute l'île serait invisible (hors cadre la plupart du temps) et cher.
const neigeCentre = new THREE.Vector3(hero.position.x, hero.position.y + 1, hero.position.z);
const neige = createPetalFall(ctx, {
  centre: neigeCentre,
  radius: NEIGE_CHUTE.radius,
  height: NEIGE_CHUTE.height,
  color: NEIGE_CHUTE.color,
  count: NEIGE_CHUTE.count,
  size: NEIGE_CHUTE.size,
});
scene.add(neige.group);
// N'apparaît qu'en entrant dans la zone polaire — la boucle plus bas bascule cette visibilité et
// ne relance `neige.update()` que là, exactement comme pour le souffle du héros (`haleineVisible`).
neige.group.visible = false;

const sky = createSky(ctx);
scene.add(sky.mesh);

// La maison sur l'île de l'est : posée au centre d'une zone plate cherchée par anneaux, et son
// empreinte entre dans la grille de collision comme n'importe quel prop. La recherche elle-même
// vit dans `world/house.ts` (`decideHousePlacement`), pas ici : `scripts/build-map.ts` doit
// trouver EXACTEMENT la même position pour sérialiser le collider de la maison dans la carte.
const placeMaison = decideHousePlacement(query);

const house = placeMaison
  ? createHouse(
      textures,
      placeMaison[0],
      query.heightAt(placeMaison[0], placeMaison[1]) ?? 0,
      placeMaison[1],
    )
  : null;
if (house) {
  scene.add(house.group);
  // Rectangle centré, de côté 2r : même rayon qu'avant Task 8, en rectangle.
  colliders.add({
    x: house.footprint.x - house.footprint.r,
    z: house.footprint.z - house.footprint.r,
    w: 2 * house.footprint.r,
    h: 2 * house.footprint.r,
  });
}

// L'intérieur vit très loin de la carte, caché tant qu'on n'y est pas entré.
const interior = createInterior(ctx, textures);
scene.add(interior.group);

// Le cerisier devant la maison. 7.5 unités : à l'échelle du héros, qui fait 1.3 unité pour
// environ 1m75, ça vaut la dizaine de mètres demandée. Le décalage vers l'est et le refus de
// palier vivent dans `world/house.ts` (`decideSakuraPlacement`), pour la même raison que
// `placeMaison` ci-dessus : `build-map.ts` doit trouver la même position.
const sakuraSpot = decideSakuraPlacement(placeMaison, query);
const sakura = ((): {
  petales: ReturnType<typeof createPetalFall>;
  position: THREE.Vector3;
} | null => {
  if (!house || !sakuraSpot) return null;
  const [x, z] = sakuraSpot;
  const y = query.heightAt(x, z) ?? 0;
  const billboard = makeBillboard(ctx, {
    texture: textures.get("/tex/sakura.png"),
    height: 3.4,
    aspect: 150 / 152,
    foot: 0.03,
    pitch: CAMERA.pitch,
  });
  billboard.placeAt(x, y, z);
  scene.add(billboard.mesh);
  // Rectangle centré, côté 2*SAKURA_RADIUS : même rayon (0.42) qu'avant Task 8, en rectangle.
  colliders.add({
    x: x - SAKURA_RADIUS,
    z: z - SAKURA_RADIUS,
    w: 2 * SAKURA_RADIUS,
    h: 2 * SAKURA_RADIUS,
  });
  // La ramure culmine vers 2.9 : les pétales tombent de là.
  const petales = createPetalFall(ctx, {
    centre: new THREE.Vector3(x, y, z),
    radius: 1.5,
    height: 2.9,
  });
  scene.add(petales.group);
  return { petales, position: new THREE.Vector3(x, y, z) };
})();

const chest = createChest(ctx, textures, field, query, colliders);
scene.add(chest.group);

const debugView = createDebugView(field, query, colliders);
scene.add(debugView.group);

// --- harnais de charge (Task 13) -------------------------------------------------------------
// `?bench=game` / `?bench=heavy` peuplent la scène au niveau du JEU (quatre joueurs, monstres,
// gardes, butin, corps, projectiles, effets de combat, sources ponctuelles projetant — voir
// `bench.ts`) pour mesurer le coût de rendu réel avant de réécrire tout le renderer en S3. `off`,
// ou l'absence du paramètre, laisse la scène du PoC inchangée : c'est le comportement par défaut.
//
// Round 1 de revue : peupler n'importe où sur la carte mesurait une scène partiellement CULLÉE —
// hors du tronc de vue caméra et hors de la passe d'ombre du soleil, une part de la population
// coûtait zéro, et le chiffre annoncé était rassurant et FAUX. `bench.ts` circonscrit désormais le
// peuplement à `BENCH_RADIUS` autour d'un centre explicite.
//
// Round 2 de revue : ce centre n'est PAS le héros. L'empreinte au sol réellement visible n'est pas
// symétrique autour de lui — une caméra qui plonge voit plus loin qu'elle ne voit près — donc un
// disque centré sur le héros débordait encore du cadre côté caméra (`cameraGroundFootprint` dans
// `bench.ts` : proche ≈9.07, lointain ≈19.17). Le centre est donc décalé de `BENCH_CENTER_OFFSET`
// (le milieu de cette empreinte) le long de l'axe de visée, dans le sens OPPOSÉ à la caméra.
//
// yaw=0 est le SEUL yaw possible au premier peuplement — il a lieu avant la première image, donc
// avant toute rotation de caméra (`yaw` n'est même pas encore déclaré à ce point du fichier) — et
// à yaw=0, `updateCamera` place la caméra à `camTarget.z + horizontal` : la caméra est du côté +Z,
// donc l'opposé de la caméra est -Z. La même hypothèse reste la bonne approximation pour un
// réarmement ultérieur (voir round 4 ci-dessous) : hors orbite active, `yaw` revient tout seul vers
// 0 par amortissement exponentiel (`updateCamera`), donc -Z reste la direction correcte dès que le
// joueur n'est pas activement en train de faire tourner la caméra pile au moment du réarmement.
//
// Round 4 de revue : ce calcul était fait UNE fois ici et figé dans `benchCenter`, que `bench.ts`
// fermait ensuite pour toujours — peupler la charge lourde restait donc ancré au spawn même si le
// héros marchait ensuite jusqu'à l'île polaire et qu'on rappelait `bench.populate()` depuis la
// console : la population, hors cadre, se faisait culler et le chiffre relevé au pôle était plus
// bas qu'au spawn alors que trois effets de particules tournent en plus. `benchCenter` devient donc
// un ACCESSEUR, relu par `bench.ts` à CHAQUE `populate()` plutôt qu'une seule fois à la
// construction — au tout premier appel (avant la boucle), `hero.position` est encore celle du
// spawn, donc une mesure prise là reste identique à avant ce correctif ; un réarmement plus tard
// (déplacement/téléportation suivi d'un nouvel appel à `populate()`) recentre alors réellement sur
// la position courante.
const benchLevel: BenchLevel = ((): BenchLevel => {
  const v = new URLSearchParams(location.search).get("bench");
  return v === "game" || v === "heavy" ? v : "off";
})();
const benchCenter = (): readonly [number, number] => [
  hero.position.x,
  hero.position.z - BENCH_CENTER_OFFSET,
];
const bench = createBench(ctx, scene, textures, query, benchCenter, {
  level: benchLevel,
});
// Round 3 de revue : `scheduleBenchMeasure` se redéclenche à CHAQUE bascule jour/nuit, longtemps
// après ce peuplement — instantané de l'état qui a servi à peupler, comparé plus tard dans
// `runBenchMeasure` (`benchStillValid`, `bench.ts`) avant d'afficher un chiffre au HUD.
//
// Round 5 de revue : cet instantané était un `const` pris une seule fois, alors que le round 4
// venait de rendre `benchCenter` relisable à chaque peuplement. Le correctif n'était donc appliqué
// qu'à moitié : réarmer au pôle recentrait bien la charge, puis `benchStillValid` comparait la
// position courante à celle du SPAWN, concluait « déplacé depuis le peuplement » et affichait
// « mesure invalide » à jamais dès qu'on quittait le spawn — réarmé ou non. Il doit donc se
// rafraîchir avec la charge, ce qui n'est garanti qu'en passant par un point d'entrée unique.
let benchPopulatedAt: BenchSnapshot = {
  heroX: hero.position.x,
  heroZ: hero.position.z,
  cameraDistance: CAMERA.distance,
};

/**
 * Le SEUL point d'entrée du peuplement du harnais : il recentre la charge sur la position courante
 * et réaligne l'instantané de validité dans le même geste. Appeler `bench.populate()` directement
 * peuple sans rafraîchir l'instantané, ce qui est exactement le demi-correctif décrit ci-dessus.
 */
function armerBench(): void {
  bench.populate();
  benchPopulatedAt = {
    heroX: hero.position.x,
    heroZ: hero.position.z,
    cameraDistance: CAMERA.distance,
  };
}

armerBench();

// Mesurer ailleurs qu'au spawn suppose de réarmer SUR PLACE, et jusqu'ici cela n'était possible
// qu'en bricolant depuis la console ou en éditant `SPAWN` avant de recharger. Trois mesures fausses
// de suite sur ce chantier ont eu pour cause une charge mal ancrée : autant rendre le geste correct
// explicite plutôt que de compter sur la ruse de celui qui mesure.
if (benchLevel !== "off") {
  (globalThis as unknown as { labBench?: { armer: () => void } }).labBench = {
    armer: armerBench,
  };
}

// Téléportation de DEBUG (aucune mécanique de jeu ne s'en sert) : trois implémenteurs successifs
// de la Task 5 (glace fine) n'ont pas pu vérifier leur travail sur l'île du nord — la traversée se
// fait à la nage, le souffle y est calibré juste (doublement consommé dans le couloir polaire,
// `ZONE_POLAIRE.souffle`), et chacun s'est noyé avant d'accoster. Sans poignée, le seul recours
// était de bricoler `SPAWN` puis de recharger toute la scène. `versIleDuNord` évite à quiconque
// d'avoir à retrouver les coordonnées de `NORD` (`settings.ts`) : elle pose le héros au centre du
// lac gelé. Exposée INCONDITIONNELLEMENT (pas seulement sous `?bench=`) : contrairement
// au harnais de mesure, ce n'est pas une charge coûteuse, et c'est utile dans toute session de dev.
(
  globalThis as unknown as {
    labHero?: { teleporter: (x: number, z: number) => void; versIleDuNord: () => void };
  }
).labHero = {
  teleporter: (x, z) => hero.teleport(x, z),
  versIleDuNord: () => hero.teleport(NORD.x, NORD.z),
};

// --- lumières -----------------------------------------------------------------------------------
const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xffffff, 1);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
// Étendue fixe, et non proportionnelle à la carte : la shadow map suit le héros, l'étaler sur
// toute l'île ne ferait que gâcher sa définition.
const OMBRE = 26;
sun.shadow.camera.left = -OMBRE;
sun.shadow.camera.right = OMBRE;
sun.shadow.camera.top = OMBRE;
sun.shadow.camera.bottom = -OMBRE;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 90;
sun.shadow.bias = -0.0006;
// Les sprites reçoivent désormais les ombres, et leur propre quad figure dans la shadow map
// (shadowSide DoubleSide, sans quoi ils n'en projetteraient aucune) : sans un biais le long de la
// normale, chacun s'auto-ombrerait.
sun.shadow.normalBias = 0.09;
scene.add(sun);
scene.add(sun.target);

// Contre-jour, pris du côté OPPOSÉ au soleil. Les normales des sprites sont bombées vers la
// gauche et vers la droite : une lumière latérale n'allume donc qu'une de leurs deux arêtes —
// c'est exactement le liseré qui les détache du décor.
const rim = new THREE.DirectionalLight(0xffffff, 0);
// Cantonné au calque des sprites : appliqué au sol et aux falaises, ce contre-jour sans ombre
// n'était plus un liseré mais un voile qui délavait le décor.
rim.layers.set(RIM_LAYER);
scene.add(rim);
scene.add(rim.target);

// --- rendu ----------------------------------------------------------------------------------
const pipeline = createPipeline(canvas, scene, camera, ctx);
// `resize()` ne s'abonne plus lui-même : c'est l'appelant qui le fait, pour que `dispose()`
// puisse se désabonner proprement.
addEventListener("resize", pipeline.resize);

// --- ambiances ------------------------------------------------------------------------------
// Le basculement n'est pas sec : tout se fond, couleurs comprises (voir `mood.ts`).
const mood = createMoodMixer(MOODS, "day", MOOD_FADE);
const fog = new THREE.Fog(0x000000, 1, 100);
scene.fog = fog;

function pushMood(): void {
  const m = mood.value;
  sun.color.copy(m.sun.color);
  sun.intensity = m.sun.intensity;
  hemi.color.copy(m.hemi.sky);
  hemi.groundColor.copy(m.hemi.ground);
  hemi.intensity = m.hemi.intensity;
  rim.color.copy(m.rim.color);
  rim.intensity = m.rim.intensity;
  pipeline.bloom.strength = m.bloom.strength;
  pipeline.bloom.threshold = m.bloom.threshold;
  // Contraste/vignette restent aux valeurs statiques de la config : seuls saturation/lift varient
  // par ambiance (`MoodConfig.grade`, `mood.ts`) — `setGrade` (`pipeline.ts`) est le seul point
  // d'entrée typé désormais, plus besoin du cast local que `pipeline.grade` imposait auparavant.
  pipeline.setGrade({
    saturation: m.grade.saturation,
    contrast: ctx.config.postfx.grade.contrast,
    lift: m.grade.lift,
    vignette: ctx.config.postfx.grade.vignette,
  });
  // Sous-exposer fait « nuit » bien plus franchement que de baisser chaque lumière une à une —
  // celles-ci ne font que la teinter.
  pipeline.renderer.toneMappingExposure = m.exposure;
  clouds.setStrength(m.clouds);
  water.colors.shallow.copy(m.water.shallow);
  water.colors.deep.copy(m.water.deep);
  water.setSparkle(m.water.sparkle);
  // The falls' pools are the same substance as the sea and must take the same ambience with it —
  // a pool that stayed daytime turquoise under a night mood would be the one thing on the island
  // that never got dark.
  for (const p of pools) {
    p.colors.shallow.copy(m.water.shallow);
    p.colors.deep.copy(m.water.deep);
    p.setSparkle(m.water.sparkle);
  }
  // Le halo du foyer suit l'ambiance : en plein jour, un feu de camp ne fait pas de flaque de
  // lumière, il n'a que sa flamme. Les deux couches pèsent le même poids : donner le dessus à la
  // petite lui rendait aussitôt son statut de tache principale, et le rond revenait.
  const feuOpacite = THREE.MathUtils.clamp(m.fire / 13, 0.16, 1);
  (props.fireGlow.material as THREE.MeshBasicMaterial).opacity = feuOpacite * 0.5;
  (props.fireHalo.material as THREE.MeshBasicMaterial).opacity = feuOpacite * 0.5;
  // La source chaude (Task 10 de l'île de neige) suit EXACTEMENT la même règle jour/nuit que le
  // foyer — même canal `m.fire`, pas un second canal de mood par source : il n'y a qu'une seule
  // horloge jour/nuit pour toute la carte (voir le commentaire d'`aurora`/`fogPulse` dans `MOODS`,
  // `settings.ts`, pour le même principe appliqué ailleurs).
  (props.springGlow.material as THREE.MeshBasicMaterial).opacity = feuOpacite * 0.5;
  (props.springHalo.material as THREE.MeshBasicMaterial).opacity = feuOpacite * 0.5;
  // La décision d'ombre (nuit ET bonne zone) est calculée dans `updateSourceShadows` — voir sa
  // JSDoc pour pourquoi ELLE seule ne suffit pas ici et doit aussi être rappelée depuis `applyZone`.
  updateSourceShadows();
  particles.apply(m);
  sky.apply(m, sun.position.clone().sub(sun.target.position));
  // `fog.color` n'est PAS recopié ici : `sky.horizon` change aussi hors fondu d'ambiance (l'aurore
  // polaire le teinte à chaque image, voir `frame()`) — le copier seulement ici le figerait entre
  // deux bascules jour/nuit. C'est `frame()` qui le fait, à chaque image, juste après `sky.update`.
}

// --- zones ------------------------------------------------------------------------------------
// La zone du héros porte son ambiance — nappe, musique et taux de souffle (voir `world/zones.ts`,
// `settings.ts`). `zoneActuelle` retient la zone en cours pour détecter le CHANGEMENT plutôt que
// de le redéclencher à chaque image : comparée par IDENTITÉ (`!==`), pas par nom, exactement comme
// `Zone` le documente — un fondu qui repart de zéro soixante fois par seconde ne monte jamais (voir
// `core/audio.ts`, `MUSIQUE_BASCULE`). `null` au départ pour que la toute première image déclenche
// bien `setAmbience` une fois, même si le héros démarre déjà dans la zone par défaut.
let zoneActuelle: Zone | null = null;

/** À appeler chaque image avec la zone déterminée pour cette image. N'agit qu'au changement. */
function applyZone(zone: Zone): void {
  if (zone === zoneActuelle) return;
  zoneActuelle = zone;
  // La musique obéit à la zone (`zone.musique`, `null` = silence) et la nappe lui obéit aussi
  // séparément (`zone.nappe`) — les deux noms diffèrent pour la polaire ("neige" contre
  // "polaire"), d'où deux appels distincts plutôt qu'un seul nom partagé (voir `core/audio.ts`,
  // `setZoneMusic` vs `setAmbience`).
  setZoneMusic(zone.musique);
  // `ZONE_LARGE` est la zone qui DÉLÈGUE au cycle jour/nuit (voir `applyMood` plus bas) : sa
  // `nappe` figée à "jour" dans `settings.ts` ne serait correcte qu'en plein jour. En y revenant,
  // on lit donc l'ambiance courante du mood plutôt que ce champ statique — sinon rentrer du pôle
  // de nuit écraserait silencieusement une nuit choisie à la main par un "jour" en dur.
  setAmbience(zone === ZONE_LARGE ? (mood.name === "day" ? "jour" : "nuit") : zone.nappe);
  // Revue post-Task 10 : le pôle et le camp du sud ne sont JAMAIS covisibles (une trentaine
  // d'unités séparent les deux îles), donc chaque source n'a besoin de projeter que dans SA zone —
  // voir `updateSourceShadows` juste en dessous. Appelée ICI, au changement de zone, pas seulement
  // depuis `pushMood` (bascules jour/nuit) : `enPolaire` change au FIL DE LA MARCHE du héros, pas à
  // une bascule d'ambiance, et `pushMood` ne tourne pas à chaque image.
  updateSourceShadows();
}

/**
 * Décide, pour CHAQUE source ponctuelle, si elle doit projeter une ombre — six rendus de scène
 * chacune, d'où la règle « seulement si ça peut se voir ». Deux conditions, comme avant : la nuit
 * (`mood.value.fire` au-delà du seuil, inchangé) ET, nouveau depuis la revue, être dans la zone où
 * cette source est visible. Le foyer du sud (`fireLight`) n'a besoin de projeter que HORS de la
 * zone polaire ; la source chaude du nord (`springLight`), seulement DEDANS — les deux îles ne sont
 * jamais covisibles, donc jamais besoin des deux ombres à la fois.
 *
 * Piège à ne pas réintroduire : un naïf `castShadow = ... && enPolaire` écrit directement dans
 * `pushMood` ne marche PAS. `pushMood` ne tourne qu'aux transitions d'ambiance (l'amorçage et
 * chaque bascule jour/nuit), jamais à chaque image — alors que la zone du héros change en marchant,
 * sans aucune bascule jour/nuit. Entrer en zone polaire de nuit ne redéclencherait donc aucun
 * `pushMood`, et l'ombre resterait éteinte exactement là où on la regarde. D'où les DEUX points
 * d'appel : `pushMood` (la nuit tombe/se lève, la zone ne change pas) et `applyZone` (le héros
 * change de zone, l'ambiance ne change pas) — chacun couvre l'axe que l'autre ne peut pas voir
 * bouger. Aucun des deux n'appelle cette fonction à chaque image : `pushMood` ne tourne que pendant
 * un fondu jour/nuit (rare), et `applyZone` n'agit que sur un changement RÉEL de zone (comparaison
 * d'identité, voir plus haut) — donc PAS une écriture three.js par frame, seulement sur les
 * transitions elles-mêmes, exactement comme le reste du câblage de zone.
 */
function updateSourceShadows(): void {
  const nuit = mood.value.fire > 2.2;
  const enPolaire = zoneActuelle === ZONE_POLAIRE;
  props.fireLight.castShadow = nuit && !enPolaire;
  props.springLight.castShadow = nuit && enPolaire;
}

const moodLabel = document.getElementById("mood");
const benchEl = document.getElementById("bench");
let benchTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Reprend la méthode du CLAUDE.md du PoC (voir `bench.ts`, `measure`) : un `readPixels` force la
 * synchro GPU, donc l'appel BLOQUE quelques dizaines de ms — acceptable ici puisqu'il ne tourne
 * qu'au chargement et à chaque bascule jour/nuit, jamais à chaque frame.
 *
 * Round 3 de revue : avant de mesurer, on vérifie que le héros n'a pas marché et que la caméra n'a
 * pas zoomé depuis `Bench.populate()` (`benchStillValid`, `bench.ts`) — sans ce garde-fou, une
 * mesure prise après une bascule jour/nuit tardive (le héros a eu le temps de marcher entre-temps)
 * porte sur une scène dont le peuplement est en grande partie hors cadre, et le HUD l'affichait
 * jusqu'ici exactement comme une mesure valide.
 */
async function runBenchMeasure(): Promise<void> {
  if (benchLevel === "off" || !benchEl) return;
  if (
    !benchStillValid(
      { heroX: hero.position.x, heroZ: hero.position.z, cameraDistance: distance },
      benchPopulatedAt,
    )
  ) {
    benchEl.textContent = `⚙ ${benchLevel} mesure invalide : déplacé/zoomé depuis le peuplement`;
    return;
  }
  // Trois.js n'accepte plus que WebGL2 depuis longtemps (three ^0.185) : le cast est sûr.
  const gl = pipeline.renderer.getContext() as WebGL2RenderingContext;
  const ms = await bench.measure(pipeline.render, gl);
  benchEl.textContent = `⚙ ${benchLevel} ${ms.toFixed(2)} ms/frame`;
}

/** Ne mesure qu'une fois l'ambiance stabilisée : mesurer en pleine transition jour/nuit lirait un
 *  état intermédiaire, ni jour ni nuit, qui ne raconte rien du budget GPU réel de l'un ou l'autre. */
function scheduleBenchMeasure(): void {
  if (benchLevel === "off") return;
  if (benchTimer !== undefined) clearTimeout(benchTimer);
  benchTimer = setTimeout(
    () => {
      void runBenchMeasure();
    },
    MOOD_FADE * 1000 + 200,
  );
}

function applyMood(name: "day" | "night"): void {
  mood.goTo(name);
  // La nappe jour/nuit n'appartient au mood que dans `ZONE_LARGE` — une zone (la polaire, par
  // exemple) qui a pris la main sur `setAmbience` doit la garder tant qu'on y reste, sinon "N"
  // pressé au pôle écraserait la nappe polaire par la boucle de nuit. `applyZone` (plus haut)
  // rattrape l'ambiance correcte tout seul dès qu'on REVIENT dans `ZONE_LARGE`, en relisant
  // `mood.name` à ce moment-là — ce n'est donc pas un choix perdu, seulement différé.
  if (zoneActuelle === ZONE_LARGE) setAmbience(name === "day" ? "jour" : "nuit");
  if (moodLabel) moodLabel.textContent = name === "day" ? "☀︎ jour" : "☾ nuit";
  scheduleBenchMeasure();
}

// --- dialogue ---------------------------------------------------------------------------------
// Le son est passé en paramètre : le bandeau ne connaît ni les fichiers ni le contexte audio, il
// sait seulement qu'une réplique se dit, se coupe, et qu'un passage se ponctue.
const dialog = createDialog({ say: sayLine, stop: stopLine, next: ding });
const prompt = createPrompt();

const GROTA_DIT = [
  "Hm. Un chevalier. Et qui a fait la traversée à la nage, en plus.",
  "Personne ne vient jamais ici. Ce caillou n’a rien : un mamelon, trois brins d’herbe, et moi.",
  "De là-haut on voit tout le reste — les paliers, le troupeau, ton feu de camp qui fume.",
  "Repars avant la nuit. Elle tombe pour de bon, ici. Au large, on ne voit plus sa propre main.",
];

// Nanuq, l'habitant de la banquise (Task 12 de l'île de neige) : il parle du FROID et de ce qu'il
// fait là — le registre à tenir est celui de Grota (terse, sec, jamais explicatif).
//
// Il en disait DEUX de plus, un tutoriel déguisé sur la glace fine : elle grince avant de céder,
// et ce qui a cédé regèle. Cette mécanique a été retirée, et les deux répliques avec elle plutôt
// que de laisser un PNJ enseigner une règle qui n'existe plus. Ses prises `habitant-3`/`habitant-4`
// (`public/voice/`) attendent donc d'être ré-écrites, pas de disparaître : `sayLine` les jouera
// dès que ce tableau reprendra quatre entrées.
const HABITANT_DIT = [
  "Tiens. Un chevalier qui a nagé jusqu’ici. Tu ne dois plus sentir tes doigts.",
  "Je pose mes lignes où le poisson remonte respirer. Le reste du temps, je répare ce que le vent défait.",
];

const fondu = document.getElementById("fade");
let enTransition = false;

/** Coupe l'image le temps de déplacer le héros : sans ça on verrait la carte défiler d'un bout à
 *  l'autre du monde. */
function transition(action: () => void): void {
  if (enTransition) return;
  enTransition = true;
  fondu?.classList.add("on");
  setTimeout(() => {
    action();
    fondu?.classList.remove("on");
    setTimeout(() => {
      enTransition = false;
    }, 280);
  }, 280);
}

function entrerMaison(): void {
  transition(() => {
    interior.group.visible = true;
    hero.setRoom(interior.bounds, interior.spawn);
    openDoor();
  });
}

function sortirMaison(): void {
  transition(() => {
    interior.group.visible = false;
    if (!house) return;
    const s = house.seuil;
    hero.setRoom(null, new THREE.Vector3(s.x, s.y, s.z + 0.9));
    closeDoor();
  });
}

const hudEl = document.getElementById("hud");
let hudMasque = false;

function parler(action: boolean, cancel: boolean): void {
  const porteeGrota = grota.inReach(hero.position) && !hero.swimming;
  // Nanuq (Task 12 de l'île de neige) : même garde `!hero.swimming` que Grota — les deux zones
  // de portée sont à des dizaines d'unités l'une de l'autre (îles différentes), donc jamais
  // vraies en même temps ; `portee` peut donc les combiner sans jamais devoir arbitrer entre les
  // deux PNJ.
  const porteeNanuq = nanuq.inReach(hero.position) && !hero.swimming;
  const portee = porteeGrota || porteeNanuq;
  // S'éloigner referme la conversation : rester à l'écoute d'un PNJ qu'on ne voit plus n'aurait
  // aucun sens, et ça évite un bandeau orphelin à l'écran.
  if (dialog.open && (!portee || cancel)) dialog.close();
  else if (action) {
    if (dialog.open) dialog.advance();
    else if (porteeGrota) dialog.start("Grota", GROTA_DIT, "/ui/grota.png", "grota");
    else if (porteeNanuq) dialog.start("Nanuq", HABITANT_DIT, "/ui/habitant.png", "habitant");
  }
  // Une seule invite pour toute la scène : les PNJ et le coffre s'y partagent la même pastille.
  const surSeuil = hero.indoors
    ? interior.nearExit(hero.position)
    : !!house && house.atDoor(hero.position);
  prompt.shown = (portee || chest.canInteract || surSeuil) && !dialog.open;
  // Les deux occupent le même bas d'écran : l'aide s'efface le temps de parler.
  if (dialog.open !== hudMasque) {
    hudMasque = dialog.open;
    hudEl?.classList.toggle("parle", hudMasque);
  }
}

const input = createInput(canvas, {
  onToggleMood: () => applyMood(mood.name === "day" ? "night" : "day"),
  onToggleHud: () => {
    document.getElementById("hud")?.classList.toggle("hidden");
  },
  onInteract: () => {
    // Une seule touche pour tout : ce qui est sous la main l'emporte.
    if (hero.indoors) {
      if (interior.nearExit(hero.position)) sortirMaison();
    } else if (house?.atDoor(hero.position)) {
      entrerMaison();
    } else {
      chest.toggle();
    }
  },
  onToggleMusic: () => {
    const actif = toggleMusic();
    const soundLabel = document.getElementById("sound");
    if (soundLabel)
      soundLabel.textContent = actif === null ? "♪ aucune piste" : actif ? "♪ musique" : "";
  },
  onToggleDebug: () => {
    const debugLabel = document.getElementById("debug");
    if (debugLabel) debugLabel.textContent = debugView.toggle() ? "▣ collisions" : "";
  },
});

// --- clic sur un mouton -----------------------------------------------------------------------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const soundLabel = document.getElementById("sound");
if (soundLabel) soundLabel.textContent = musicEnabled() ? "♪ musique" : "";

/** Coordonnées normalisées du pointeur, pour le raycast. */
function viserAvec(e: PointerEvent): void {
  const r = canvas.getBoundingClientRect();
  pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
}

// Le curseur passe à la main au survol d'un mouton : c'est la seule chose cliquable de la scène,
// autant que ça se voie.
canvas.addEventListener("pointermove", (e) => {
  viserAvec(e);
  const survol = raycaster.intersectObjects([...props.flock.meshes], false).length > 0;
  canvas.classList.toggle("pointe", survol);
});

canvas.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return; // le bouton droit fait tourner la caméra
  viserAvec(e);
  const hit = raycaster.intersectObjects([...props.flock.meshes], false)[0];
  if (hit) props.flock.hit(hit.object);
});

// --- caméra -----------------------------------------------------------------------------------
let distance = CAMERA.distance;
let yaw = 0;
const camTarget = new THREE.Vector3(
  hero.position.x,
  hero.position.y + CAMERA.height,
  hero.position.z,
);
// Le point visé devance le héros dans sa direction de course : la caméra respire au lieu de le
// coller au centre du cadre.
const avance = new THREE.Vector3();
const wanted = new THREE.Vector3();
const astre = new THREE.Vector3();

// Secousse : une réception sans à-coup, ou une détonation, n'ont aucun poids.
let secousse = 0;
const shake = (a: number) => {
  secousse = Math.max(secousse, a);
};
props.flock.onExplode = () => shake(0.26);

// Aurore et pulse de blizzard (Task 9 de l'île de neige) : deux canaux `MoodConfig`
// (`aurora`/`fogPulse`) qui valent 0 dans les deux ambiances du labo (voir `MOODS`,
// `settings.ts`) — c'est ICI, en zone polaire, que `frame()` les allume, avec leur PROPRE fondu
// (`AURORE.fade`/`BLIZZARD.fade`) indépendant de celui du jour/nuit (`MOOD_FADE`), qui ignore la
// position du héros.
let auroraAmount = 0;
let fogPulseAmount = 0;
// The falls zone's own low fog, on its own fade — a second contribution to the same `fog.far`
// multiplier the blizzard drives, never a second mechanism.
let fallsFogAmount = 0;

// Son de rafale (Correction 1 de la revue de cette task) : `rafalePrec` retient la valeur du signal
// visuel calculée à l'image précédente, pour repérer son FRANCHISSEMENT ASCENDANT du seuil
// (`BLIZZARD.seuilSon`, `settings.ts`) — c'est ce franchissement qui marque le DÉBUT d'une
// bourrasque, pas chaque image où le signal reste fort. `null` tant qu'aucune image n'a encore été
// mesurée EN ZONE POLAIRE (et remis à `null` dès qu'on en sort) : sans ce garde, entrer dans la zone
// au milieu d'une bourrasque déjà haute lirait un "franchissement" dès la première image, comme si
// elle venait tout juste de commencer. `dernierGustAt` est le filet de sécurité demandé en revue :
// un intervalle plancher (`BLIZZARD.intervalleSonMin`) au cas où un futur réglage ferait se
// redéclencher le seuil trop vite pour rester "une bourrasque, un son".
let rafalePrec: number | null = null;
let dernierGustAt = -Infinity;

function updateCamera(
  dt: number,
  cmd: InputSample,
  move: { x: number; z: number },
  t: number,
  zone: Zone,
): void {
  // Derived here rather than passed in as a flag per zone: the signature stopped growing a boolean
  // every time the lab gained an ambience. The falls need no flag of their own here — their fog
  // rides `fallsFogAmount`, which the frame loop already fades by zone.
  const enPolaire = zone === ZONE_POLAIRE;
  distance = THREE.MathUtils.clamp(distance + cmd.zoom, CAMERA.zoom.min, CAMERA.zoom.max);
  // La rotation n'est qu'un coup d'oeil : elle revient d'elle-même une fois le bouton relâché,
  // pour que l'axe des commandes reste celui qu'on connaît.
  yaw = cmd.orbiting
    ? THREE.MathUtils.clamp(yaw + cmd.yaw, -CAMERA.yawRange, CAMERA.yawRange)
    : yaw * Math.exp(-CAMERA.yawReturn * dt);
  // Les sprites sont des plans : sans ça on finirait par les voir par la tranche.
  ctx.setYaw(yaw);

  avance.lerp(
    wanted.set(move.x * CAMERA.lookAhead, 0, move.z * CAMERA.lookAhead),
    1 - Math.exp(-CAMERA.lookAheadLag * dt),
  );
  wanted.set(
    hero.position.x + avance.x,
    hero.position.y + CAMERA.height,
    hero.position.z + avance.z,
  );
  // Amorti exponentiel : indépendant du framerate, contrairement à un lerp fixe.
  camTarget.lerp(wanted, 1 - Math.exp(-CAMERA.follow * dt));

  const horizontal = Math.cos(CAMERA.pitch) * distance;
  camera.position.set(
    camTarget.x + Math.sin(yaw) * horizontal,
    camTarget.y + Math.sin(CAMERA.pitch) * distance,
    camTarget.z + Math.cos(yaw) * horizontal,
  );
  camera.lookAt(camTarget);

  // Décalée APRÈS le cadrage : la caméra tremble sans changer de cible.
  if (secousse > 5e-4) {
    const f = t * CAMERA.shake.frequency;
    camera.position.x += Math.sin(f) * secousse;
    camera.position.y += Math.sin(f * 1.37 + 1.1) * secousse;
    secousse *= Math.exp(-CAMERA.shake.decay * dt);
  } else secousse = 0;

  // L'azimut du soleil oscille lentement : les ombres balaient l'île, et c'est la démonstration
  // la plus directe que la lumière est calculée, pas peinte. Le débattement reste dans le
  // quadrant d'origine — de l'autre côté, les ombres partiraient vers la caméra et toute la scène
  // basculerait.
  const [sx, sy, sz] = mood.value.sun.position;
  const a = SUN_DRIFT.amplitude * Math.sin((t / SUN_DRIFT.period) * Math.PI * 2);
  astre.set(sx * Math.cos(a) + sz * Math.sin(a), sy, -sx * Math.sin(a) + sz * Math.cos(a));
  sun.target.position.copy(camTarget);
  sun.position.copy(camTarget).add(astre);

  // Le contre-jour suit la même dérive, en miroir : il doit rester en face.
  rim.target.position.copy(camTarget);
  astre.set(...mood.value.rim.position).applyAxisAngle(THREE.Object3D.DEFAULT_UP, a);
  rim.position.copy(camTarget).add(astre);

  // Le brouillard suit le zoom, mais pas des deux côtés à la même vitesse : le plan proche reste
  // proportionnel — le héros garde sa netteté quel que soit le zoom — pendant que le plan
  // lointain grandit moins vite. Reculer resserre donc la bande, et l'île se dissout par les
  // bords au lieu d'être simplement la même image en plus petit.
  const k = distance / CAMERA.distance;
  fog.near = mood.value.fog.near * k;
  // Le pulse de blizzard (Task 9) resserre la portée par rafales qui TRAVERSENT la zone : la phase
  // se déduit de la position du héros (`windPhase`, `world/props.ts`, réutilisée telle quelle —
  // c'est la même bourrasque que celle qui balaie les arbres), pas d'une horloge globale, sinon la
  // rafale pulserait partout à la fois au lieu de balayer l'île. `mood.value.fogPulse` reste à 0
  // dans les deux ambiances du labo ; `fogPulseAmount` porte la contribution de la zone polaire.
  const rafale =
    0.5 +
    0.5 * Math.sin((windPhase(camTarget.x, camTarget.z, 1) - t / BLIZZARD.periode) * Math.PI * 2);
  // Bornée à 1 : les deux termes valent 0 dans les ambiances du labo aujourd'hui, donc sans effet
  // observable, mais `fogPulse`/`aurora` existent précisément pour qu'une AUTRE ambiance future s'en
  // serve aussi — une somme non bornée pourrait alors dépasser 1 et faire déborder le `lerp` de
  // teinte plus bas (`sky.update`) ou ici la resserre du brouillard au-delà de ce que `intensite`
  // prévoit.
  const pulse = Math.min(1, mood.value.fogPulse + fogPulseAmount) * rafale * BLIZZARD.intensite;
  // The falls' own slow breath, on its own period. MULTIPLIED with the blizzard's rather than
  // summed into it, so neither zone can push `fog.far` negative however the two are retuned — and
  // the two are never non-zero at once anyway, being dozens of units apart.
  const respire = 0.5 + 0.5 * Math.sin(((t / FALLS_FOG.periode) % 1) * Math.PI * 2);
  const pulseFalls = fallsFogAmount * respire * FALLS_FOG.intensite;
  fog.far = mood.value.fog.far * k ** CAMERA.fogFar * (1 - pulse) * (1 - pulseFalls);
  // Reculer doit renforcer l'effet maquette, pas l'aplatir.
  pipeline.setTiltShiftZoom(k);

  // Son de rafale (Correction 1 de la revue) : uniquement en zone polaire — `hd2d` ne sait pas qu'un
  // biome de neige existe, ce gating reste donc entièrement ici, côté labo, jamais dans le package.
  // `rafale` ci-dessus EST déjà le signal visuel (même formule que le pulse de brouillard) : on le
  // relit tel quel plutôt que d'en dériver un second, pour que le son et l'image ne puissent jamais
  // diverger. Un franchissement ASCENDANT du seuil = le début d'une bourrasque ; le plancher
  // `intervalleSonMin` est un filet de sécurité, pas le mécanisme principal (voir la déclaration de
  // `rafalePrec` plus haut pour le raisonnement complet, notamment le cas d'une entrée en zone en
  // pleine bourrasque).
  if (enPolaire) {
    if (
      rafalePrec !== null &&
      rafalePrec < BLIZZARD.seuilSon &&
      rafale >= BLIZZARD.seuilSon &&
      t - dernierGustAt >= BLIZZARD.intervalleSonMin
    ) {
      gust();
      dernierGustAt = t;
    }
    rafalePrec = rafale;
  } else {
    rafalePrec = null;
  }
}

// --- amorçage -----------------------------------------------------------------------------------
// Un premier cadrage à vide avant de pousser l'ambiance : `pushMood` a besoin de la direction du
// soleil, que c'est la caméra qui place.
updateCamera(
  0.016,
  {
    x: 0,
    z: 0,
    zoom: 0,
    jump: false,
    attack: false,
    action: false,
    cancel: false,
    yaw: 0,
    orbiting: false,
  },
  { x: 0, z: 0 },
  0,
  // The spawn is in neither special zone, so this empty first framing triggers no gust sound and
  // no zone fog. Passing the zone itself rather than a flag is what stopped this call growing a
  // boolean every time the lab gained an ambience.
  ZONE_LARGE,
);
pushMood();
applyMood("day");

// --- boucle -----------------------------------------------------------------------------------
const breathEl = document.getElementById("breath");
const breathBarEl = document.getElementById("breath-bar");
const fpsEl = document.getElementById("fps");

let last = performance.now();
let elapsed = 0;
let fpsAcc = 0;
let fpsFrames = 0;

// Marge d'1 ms : sur un écran 60 Hz, la gigue du rAF ferait sinon rater une frame sur deux et on
// tomberait à 30.
const MIN_FRAME_MS = TARGET_FPS ? 1000 / TARGET_FPS - 1 : 0;

// --- appoint de lumière, plusieurs sources (Task 10 de l'île de neige) ------------------------
// Même distance plancher que `fill-light.ts` (non exportée de hd2d — `DISTANCE_MIN`) : un sprite
// au contact d'une source ne doit pas diviser par zéro.
const APPOINT_DISTANCE_MIN = 0.6;

/**
 * `applyFillFromPointLight` (hd2d) ÉCRASE l'émissif de chaque sprite éclairé à chaque appel — un
 * choix correct tant qu'une seule source existe dans la scène. La source chaude en ajoute une
 * seconde, permanente : appeler la fonction de hd2d deux fois de suite (une par source) ferait
 * perdre le résultat du premier appel au second, quelle que soit sa distance — un héros au feu du
 * sud verrait son appoint écrasé par la source du nord (à ~30 unités, donc quasi nulle) si elle
 * est appliquée en second, et réciproquement pour un héros à la source. Piège n°3 du brief, sous
 * une forme que le feu seul ne pouvait pas révéler.
 *
 * hd2d exporte `fillAmount` — la brique PURE, séparée de la boucle qui l'applique — précisément
 * pour ce genre de composition : on somme sa contribution pour chaque source ICI, dans le labo,
 * sans qu'`@lindocara/hd2d` ait à connaître ni une seconde source ni l'existence d'une île de
 * neige.
 */
function applyFillFromPointLights(
  ctx: Hd2dContext,
  sources: readonly { position: THREE.Vector3; color: THREE.Color; intensity: number }[],
): void {
  const yaw = ctx.yaw();
  const nSprite = new THREE.Vector3(Math.sin(yaw) * 0.86, 0.42, Math.cos(yaw) * 0.86).normalize();
  const versSource = new THREE.Vector3();
  const somme = new THREE.Color();
  for (const { mesh, material, mid } of ctx.litBillboards()) {
    somme.setRGB(0, 0, 0);
    for (const source of sources) {
      if (source.intensity <= 0) continue;
      versSource.set(
        source.position.x - mesh.position.x,
        source.position.y - (mesh.position.y + mid),
        source.position.z - mesh.position.z,
      );
      const distance = Math.max(versSource.length(), APPOINT_DISTANCE_MIN);
      versSource.divideScalar(distance);
      const dot = versSource.dot(nSprite);
      const k = fillAmount({ dot, intensity: source.intensity, distance });
      somme.r += source.color.r * k;
      somme.g += source.color.g * k;
      somme.b += source.color.b * k;
    }
    material.emissive.copy(somme);
  }
}

function frame(now = performance.now()): void {
  requestAnimationFrame(frame);
  if (now - last < MIN_FRAME_MS) return;
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  elapsed += dt;

  const cmd = input.sample();
  // Les commandes sont relatives à l'écran : on les tourne avec la caméra pour que "vers le haut"
  // reste "vers le fond" quelle que soit son orientation.
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const move = { x: cmd.x * cy + cmd.z * sy, z: cmd.z * cy - cmd.x * sy };
  // Pendant qu'on parle, le héros est spectateur : ni pas, ni saut, ni coup. Les commandes sont
  // neutralisées ICI et non dans `hero.ts` — c'est la scène qui sait qu'une conversation est en
  // cours, pas le personnage. Le zoom et la rotation de caméra, eux, restent libres.
  const fige = dialog.open;
  // La zone se lit sur la position d'ENTRÉE de l'image, avant que `hero.update` ne la déplace —
  // même principe que tout le reste de la boucle, qui lit `hero.position` avant de la faire
  // avancer. `applyZone` ne fait rien si la zone n'a pas changé (voir plus haut) ; `zone.souffle`,
  // lui, est lu à CHAQUE image, changée ou non, pour que le héros n'ait jamais une constante figée.
  const zone = zoneAt(ZONES, hero.position.x, hero.position.z);
  applyZone(zone);
  // Île de neige (Task 8) : aucun des trois effets d'ambiance (flocons, souffle, traces) ne doit
  // tourner hors de la zone polaire — comparaison d'IDENTITÉ, comme le reste du câblage de zone
  // (`applyZone`, `applyMood`) plutôt qu'un nom. Les traces se gèrent d'elles-mêmes (elles ne se
  // posent que sur la matière "neige", géographiquement confinée à cette même île — voir
  // `world/island.ts`) ; le souffle et les flocons ont besoin de ce drapeau explicite.
  const enPolaire = zone === ZONE_POLAIRE;
  const enCascade = zone === ZONE_FALLS;
  // Aurore et pulse de blizzard suivent la zone avec leur propre fondu — voir la déclaration de
  // `auroraAmount`/`fogPulseAmount` plus haut. L'aurore, en plus, exige la NUIT (un ruban vert dans
  // un ciel de plein jour serait absurde) ; le blizzard, lui, souffle à toute heure.
  const auroraCible = enPolaire && mood.name === "night" ? 1 : 0;
  auroraAmount += (auroraCible - auroraAmount) * (1 - Math.exp(-dt / AURORE.fade));
  const fogPulseCible = enPolaire ? 1 : 0;
  fogPulseAmount += (fogPulseCible - fogPulseAmount) * (1 - Math.exp(-dt / BLIZZARD.fade));
  const fallsFogCible = enCascade ? 1 : 0;
  fallsFogAmount += (fallsFogCible - fallsFogAmount) * (1 - Math.exp(-dt / FALLS_FOG.fade));
  hero.update(dt, {
    x: fige ? 0 : move.x,
    z: fige ? 0 : move.z,
    jump: !fige && cmd.jump,
    attack: !fige && cmd.attack,
    souffleTaux: zone.souffle,
    haleineVisible: enPolaire,
  });
  const choc = hero.takeImpact();
  if (choc) shake(CAMERA.shake.land * choc);

  props.update(dt, elapsed);
  grota.update(dt, hero.position);
  nanuq.update(dt, hero.position);
  parler(cmd.action, cmd.cancel);
  dialog.update(dt);
  water.update(dt);
  for (const w of waterfalls) w.update(dt);
  for (const p of pools) p.update(dt);
  foam.update(dt);
  clouds.update(dt);
  particles.update(dt);
  // Ne coûte et ne tourne que dans la zone polaire (voir `enPolaire` ci-dessus) : ni mise à jour
  // ni visibilité en dehors.
  neige.group.visible = enPolaire;
  if (enPolaire) {
    neigeCentre.set(hero.position.x, hero.position.y + 1, hero.position.z);
    neige.update(dt);
  }
  // Mist, spray and the rainbow (Tasks 6-7). Gated on the zone like the snowfall above: outside
  // the falls the pools neither update nor draw. The daylight term is the rainbow's own gate,
  // times the sun's drift — `SUN_DRIFT` already swings the azimuth ±22° over 96 s, and an arc that
  // ignored where the sun stands would betray that nothing is being computed.
  const solaire = 0.5 + 0.5 * Math.sin((elapsed / SUN_DRIFT.period) * Math.PI * 2);
  const daylight = mood.name === "day" ? 1 - RAINBOW.sunSwing + RAINBOW.sunSwing * solaire : 0;
  waterfallFx.update(dt, enCascade, daylight);
  debugView.update(hero);
  chest.update(hero.position);
  interior.update(dt, elapsed);
  sakura?.petales.update(dt);
  // `mood.value.aurora` reste à 0 dans les deux ambiances du labo (voir `MOODS`) ; `auroraAmount`
  // porte la contribution de la zone polaire — la somme documente que les deux s'additionnent,
  // même si l'un des deux termes vaut toujours 0 aujourd'hui. Bornée à 1 pour la même raison que
  // `pulse` dans `updateCamera` : sans effet aujourd'hui, mais `aurora` existe pour qu'une autre
  // ambiance future s'y ajoute, et `sky.update`/`update` (mood.ts) lerpent tous deux sur `[0, 1]`.
  sky.update(dt, camera, Math.min(1, mood.value.aurora + auroraAmount));
  // Recopié à CHAQUE image, pas seulement au fondu d'ambiance : `sky.horizon` change aussi avec
  // l'aurore, qui suit son propre fondu (`AURORE.fade`) indépendant de celui du jour/nuit.
  fog.color.copy(sky.horizon);
  updateCamera(dt, cmd, move, elapsed, zone);
  // L'ambiance se fond : tant qu'elle bouge, il faut la repousser partout.
  if (mood.update(dt)) pushMood();

  // Jauge de souffle : visible seulement quand le héros est dans l'eau.
  if (breathEl) breathEl.style.display = hero.swimming ? "block" : "none";
  if (hero.swimming && breathBarEl) breathBarEl.style.width = `${Math.max(0, hero.breath) * 100}%`;

  // Le foyer s'entend d'autant plus qu'on en est près.
  setFireDistance(hero.position.distanceTo(props.firePosition));
  // The falls are heard from the NEAREST drop, not from the island's centre: walking up the
  // terraces should keep the roar close rather than fading it as you leave the middle.
  let nearestFall = Number.POSITIVE_INFINITY;
  for (const w of waterfalls)
    nearestFall = Math.min(nearestFall, hero.position.distanceTo(w.impact));
  setCascadeDistance(nearestFall);

  props.fireLight.intensity = mood.value.fire * ((props.fireLight.userData.flicker as number) ?? 1);
  props.springLight.intensity =
    mood.value.fire * ((props.springLight.userData.flicker as number) ?? 1);
  // Appoint sur les sprites : un plan face caméra ne peut rien recevoir d'une source placée
  // derrière lui, alors qu'on s'attend à voir le héros éclairé dès qu'il est près d'une source
  // chaude — feu ou source. On complète donc exactement ce que la vraie lumière rate, en fonction
  // de la distance et de l'orientation, pour les DEUX sources à la fois (piège n°3 : sans ça, un
  // héros dos à la source devient noir à deux pas d'elle).
  applyFillFromPointLights(ctx, [
    {
      position: props.fireLight.position,
      color: props.fireLight.color,
      intensity: props.fireLight.intensity,
    },
    {
      position: props.springLight.position,
      color: props.springLight.color,
      intensity: props.springLight.intensity,
    },
  ]);

  // La bande nette suit le héros à l'écran : il reste toujours net.
  const p = hero.position.clone().project(camera);
  const focusY = THREE.MathUtils.clamp(1 - (p.y * 0.5 + 0.5), 0.25, 0.8);
  pipeline.setFocusY(focusY);

  pipeline.render();

  fpsAcc += dt;
  fpsFrames++;
  if (fpsAcc > 0.5) {
    if (fpsEl) fpsEl.textContent = `${Math.round(fpsFrames / fpsAcc)} fps`;
    fpsAcc = 0;
    fpsFrames = 0;
  }
}
// La scène tourne DERRIÈRE l'écran de chargement : le premier plan est déjà cadré, les shaders
// déjà compilés, et le voile se lève sur une image vivante plutôt que sur une frame noire.
frame();

// --- lancement --------------------------------------------------------------------------------
// Un navigateur n'autorise le son qu'après un geste, et il n'y en a aucun au chargement d'une
// page. Sans bouton, la scène démarrait donc muette jusqu'à ce qu'on touche une touche par hasard
// — et souvent on ne remarquait même pas qu'il manquait quelque chose.
const ecran = document.getElementById("loading");
const bouton = document.getElementById("play");
bouton?.classList.add("on");
bouton?.addEventListener("click", () => {
  unlockAudio();
  ecran?.classList.add("hidden");
  canvas.focus();
});

// Repère pour les scripts de capture.
(window as unknown as { __ready?: boolean }).__ready = true;

// Pratique pour bidouiller les réglages depuis la console du navigateur.
(window as unknown as { lab?: unknown }).lab = {
  THREE,
  scene,
  camera,
  renderer: pipeline.renderer,
  render: pipeline.render,
  field,
  query,
  // La grille de colliders : sans elle, impossible de répondre depuis la console à « pourquoi ce
  // prop est-il posé là », qui est exactement le genre de question que ce labo existe pour trancher.
  colliders,
  hero,
  chest,
  house,
  sakura,
  grota,
  nanuq,
  dialog,
  props,
  sun,
  hemi,
  rim,
  sky,
  clouds,
  particles,
  neige,
  mood,
  applyMood,
  bench,
  benchLevel,
  // La zone en cours (voir `world/zones.ts`) : pratique pour vérifier depuis la console qu'entrer
  // dans la zone polaire change bien la nappe, sans avoir à nager jusque là à chaque fois.
  zone: () => zoneActuelle,
};
