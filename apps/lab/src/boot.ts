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
  MOOD_FADE,
  MOODS,
  NEIGE_CHUTE,
  NORD,
  SPAWN,
  SUN_DRIFT,
  TARGET_FPS,
  TEXTURE_URLS,
  WATER,
  WORLD,
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
import { createCampTestNpc } from "./world/camp-test-npc.js";
import { createGrota } from "./world/npc.js";
import { populate, windPhase } from "./world/props.js";
import { createSnowNpc } from "./world/snow-npc.js";
import { type Zone, zoneAt } from "./world/zones.js";

// Task 10 : l'Ã®le n'est plus gÃ©nÃ©rÃ©e au dÃ©marrage, elle est CHARGÃ‰E â€” `world/island.ts`
// (`generateIsland`) reste le seul outil qui sait la produire, mais devient un outil de
// PRODUCTION de donnÃ©es (`scripts/build-map.ts`), plus une dÃ©pendance d'exÃ©cution du labo. La
// carte rejoint donc les textures et les sons dans la barre de chargement, pondÃ©rÃ©e en octets
// comme le reste (voir `avancement` plus bas).
const MAP_URL = "/maps/ile.json";

// --- chargement -------------------------------------------------------------------------------
// Tout est chargÃ© AVANT de construire quoi que ce soit : la scÃ¨ne naÃ®t complÃ¨te, et aucun sprite
// ne se clone sur une image encore vide.
//
// Le pourcentage se rÃ©partit sur deux temps. Le tÃ©lÃ©chargement pÃ¨se 85 % : il est suivi en
// octets, seule mesure honnÃªte quand deux fichiers de musique pÃ¨sent plus que les soixante
// autres rÃ©unis. Le dÃ©codage â€” images vers textures, OGG vers tampons audio â€” prend les 15
// derniers, et les deux dÃ©codages tournent de front (chacun compte pour sa moitiÃ©).
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
// La carte remplace `generateIsland` comme source de vÃ©ritÃ© (Task 10) : `decodeMap` ne jette
// jamais, mais une carte absente ou corrompue laisserait le labo dÃ©marrer sur un monde vide sans
// rien dire â€” un Ã©chec bruyant ici vaut mieux qu'une Ã®le silencieusement plate.
const carteBlob = blobs.get(MAP_URL);
if (!carteBlob) throw new Error(`Carte introuvable au chargement : ${MAP_URL}`);
const carte = decodeMap(await carteBlob.text());
if (!carte)
  throw new Error(`Carte invalide : ${MAP_URL} (relancer "npm run build:map -w @lindocara/lab")`);

const field = mapToHeightField(carte);
const query = createTerrainQuery(mapToQuerySource(carte));

// Un atlas par clÃ© de matiÃ¨re (voir `HeightField.materialAt`, `island.ts`). `TerrainAtlas.block`
// dit quel bloc 4x4 l'image contient (voir `atlas.ts`) : dans le tileset du Free Pack, le palier 0
// borde toujours l'EAU directement (une case de palier 0 ne porte jamais de paroi face Ã  la mer,
// voir `wallDrop` â€” c'est l'herbe qui touche la mer, pas une falaise), donc son atlas ("lvl0") est
// le bloc Ã  liserÃ© d'Ã©cume. Les paliers 1 et 2 bordent forcÃ©ment un VIDE (ils dominent un voisin
// plus bas, jamais l'eau elle-mÃªme) : leur atlas prend le bloc Ã  bordure touffue, celui qui se
// raccorde Ã  la paroi. Le sable n'existe qu'au palier 0 lui aussi (jamais de paroi), mais son
// image (Update 010, `Tilemap_Flat.png`) rÃ©utilise la MÃŠME disposition de colonnes que le bloc Ã 
// bordure touffue pour son propre liserÃ© sable-contre-herbe â€” colonne 5, comme `CLIFF_EDGE_COL`.
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
  // Jamais de paroi pour le sable (toujours au palier 0) : `wallRow` n'est ici jamais lu, gardÃ© Ã 
  // 4 par cohÃ©rence avec les autres atlas plutÃ´t que par nÃ©cessitÃ©.
  sable: {
    texture: textures.get("/tex/tileset-sand.png"),
    cols: 10,
    rows: 4,
    block: "cliff-edge",
    wallRow: 4,
    tilePx: 64,
  },
  // Task 2 : surfaces gÃ©nÃ©rÃ©es sur la gÃ©omÃ©trie d'origine (voir `scripts/compose-tileset.py`).
  // MÃªme bloc/mÃªmes colonnes que `lvl0`/`lvl1` : seul le remplissage a changÃ©, la dÃ©coupe et les
  // raccords viennent toujours du mÃªme bloc 4x4. `"glace-fine"` (voir `island.ts`, `materialAt`)
  // se dessine avec CET atlas `glace` : c'est une matiÃ¨re de rÃ¨gle, pas encore d'apparence.
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
};

const terrainMesh = meshTerrain(ctx, field, { atlases, levelHeight: WORLD.levelHeight });
scene.add(terrainMesh.group);

// Un plan trois fois plus large que la grille : assez pour que la mer se perde dans le brouillard
// avant sa propre bordure, Ã  tous les zooms.
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

// `colliders` est crÃ©Ã© ICI, dans le composition root, parce que le hÃ©ros â€” crÃ©Ã© juste aprÃ¨s
// Grota â€” doit voir la MÃŠME instance que celle que Grota/Nanuq peuplent ensuite : contrairement au
// PoC, oÃ¹ `props.js` fabriquait et possÃ©dait ses propres colliders, l'architecture du labo (Task
// 11) fait de `main.ts` le propriÃ©taire de `colliders`.
//
// Task 10 : les colliders des PROPS (arbres, rochers, feu, source chaude) ne sont plus dÃ©clarÃ©s
// par `populate` â€” ils viennent de la carte, chargÃ©e une fois pour toutes. `populate` continue de
// crÃ©er les billboards (mÃªmes positions, mÃªme graine â€” voir `world/props.ts`, `decidePlacements`),
// mais n'Ã©crit plus dans `colliders`.
const colliders = createColliderIndex();
for (const c of carte.colliders) colliders.add(c);

const props = populate(ctx, textures, field, query, SPAWN);
scene.add(props.group);

// Grota AVANT le hÃ©ros : il dÃ©clare son collider, que le hÃ©ros doit connaÃ®tre.
const grota = createGrota(ctx, textures, query, colliders);
scene.add(grota.object);

// Nanuq, l'habitant de la banquise (Task 12 de l'Ã®le de neige) : mÃªme raison, mÃªme ordre â€” son
// collider doit exister avant que le hÃ©ros ne soit construit.
const nanuq = createSnowNpc(ctx, textures, query, colliders);
scene.add(nanuq.object);

const voyageur = createCampTestNpc(ctx, textures, query, colliders);
scene.add(voyageur.object);

const hero = createHero(ctx, textures, query, colliders, SPAWN);
scene.add(hero.object);
scene.add(hero.effects);

// Couverture nuageuse : dÃ©rive et multiplie l'albÃ©do du dÃ©cor ET des sprites, sans passe d'ombre
// supplÃ©mentaire.
const clouds = createCloudCover(ctx);

// Braises du foyer, lucioles de nuit, pollen de jour : rien n'Ã©claire, c'est du mouvement dans le
// vide entre les sprites â€” la Task 11 avait laissÃ© ce cÃ¢blage en attente du foyer, posÃ© ici par
// `populate`.
const particles = createParticleField(ctx, { firePosition: props.firePosition, worldRadius: 22 });
scene.add(particles.group);

// Chutes de neige (Task 8 de l'Ã®le de neige) : la mÃªme mÃ©canique de chute que le cerisier
// (`createPetalFall`), recolorÃ©e/redensifiÃ©e pour lire comme des flocons plutÃ´t que des pÃ©tales â€”
// `PetalFallOptions.color`/`count`/`size` (voir `packages/hd2d/src/particles.ts`, dont le rapport
// de cette task explique le touchÃ©). `neigeCentre` est un `THREE.Vector3` MUTÃ‰ chaque image dans
// la boucle (voir plus bas) pour suivre le hÃ©ros, x/y/z compris â€” `createPetalFall` relit
// `centre.x`/`centre.y`/`centre.z` Ã  chaque respawn de grain (correction du round 1 de revue :
// `y` Ã©tait lu une seule fois Ã  la construction, donc figÃ© sur l'altitude du spawn, alors que la
// banquise a du relief â€” un flocon pouvait traverser le sol ou flotter au-dessus dÃ¨s qu'on
// s'Ã©loignait du point de dÃ©part), donc rien d'autre n'est nÃ©cessaire pour que le champ suive sans
// jamais rÃ©allouer. AmbiguÃ¯tÃ© 5 du brief : un rayon autour du hÃ©ros, pas toute la zone â€” en
// couvrir toute l'Ã®le serait invisible (hors cadre la plupart du temps) et cher.
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
// N'apparaÃ®t qu'en entrant dans la zone polaire â€” la boucle plus bas bascule cette visibilitÃ© et
// ne relance `neige.update()` que lÃ , exactement comme pour le souffle du hÃ©ros (`haleineVisible`).
neige.group.visible = false;

const sky = createSky(ctx);
scene.add(sky.mesh);

// La maison sur l'Ã®le de l'est : posÃ©e au centre d'une zone plate cherchÃ©e par anneaux, et son
// empreinte entre dans la grille de collision comme n'importe quel prop. La recherche elle-mÃªme
// vit dans `world/house.ts` (`decideHousePlacement`), pas ici : `scripts/build-map.ts` doit
// trouver EXACTEMENT la mÃªme position pour sÃ©rialiser le collider de la maison dans la carte.
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
  // Rectangle centrÃ©, de cÃ´tÃ© 2r : mÃªme rayon qu'avant Task 8, en rectangle.
  colliders.add({
    x: house.footprint.x - house.footprint.r,
    z: house.footprint.z - house.footprint.r,
    w: 2 * house.footprint.r,
    h: 2 * house.footprint.r,
  });
}

// L'intÃ©rieur vit trÃ¨s loin de la carte, cachÃ© tant qu'on n'y est pas entrÃ©.
const interior = createInterior(ctx, textures);
scene.add(interior.group);

// Le cerisier devant la maison. 7.5 unitÃ©s : Ã  l'Ã©chelle du hÃ©ros, qui fait 1.3 unitÃ© pour
// environ 1m75, Ã§a vaut la dizaine de mÃ¨tres demandÃ©e. Le dÃ©calage vers l'est et le refus de
// palier vivent dans `world/house.ts` (`decideSakuraPlacement`), pour la mÃªme raison que
// `placeMaison` ci-dessus : `build-map.ts` doit trouver la mÃªme position.
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
  // Rectangle centrÃ©, cÃ´tÃ© 2*SAKURA_RADIUS : mÃªme rayon (0.42) qu'avant Task 8, en rectangle.
  colliders.add({
    x: x - SAKURA_RADIUS,
    z: z - SAKURA_RADIUS,
    w: 2 * SAKURA_RADIUS,
    h: 2 * SAKURA_RADIUS,
  });
  // La ramure culmine vers 2.9 : les pÃ©tales tombent de lÃ .
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
// `?bench=game` / `?bench=heavy` peuplent la scÃ¨ne au niveau du JEU (quatre joueurs, monstres,
// gardes, butin, corps, projectiles, effets de combat, sources ponctuelles projetant â€” voir
// `bench.ts`) pour mesurer le coÃ»t de rendu rÃ©el avant de rÃ©Ã©crire tout le renderer en S3. `off`,
// ou l'absence du paramÃ¨tre, laisse la scÃ¨ne du PoC inchangÃ©e : c'est le comportement par dÃ©faut.
//
// Round 1 de revue : peupler n'importe oÃ¹ sur la carte mesurait une scÃ¨ne partiellement CULLÃ‰E â€”
// hors du tronc de vue camÃ©ra et hors de la passe d'ombre du soleil, une part de la population
// coÃ»tait zÃ©ro, et le chiffre annoncÃ© Ã©tait rassurant et FAUX. `bench.ts` circonscrit dÃ©sormais le
// peuplement Ã  `BENCH_RADIUS` autour d'un centre explicite.
//
// Round 2 de revue : ce centre n'est PAS le hÃ©ros. L'empreinte au sol rÃ©ellement visible n'est pas
// symÃ©trique autour de lui â€” une camÃ©ra qui plonge voit plus loin qu'elle ne voit prÃ¨s â€” donc un
// disque centrÃ© sur le hÃ©ros dÃ©bordait encore du cadre cÃ´tÃ© camÃ©ra (`cameraGroundFootprint` dans
// `bench.ts` : proche â‰ˆ9.07, lointain â‰ˆ19.17). Le centre est donc dÃ©calÃ© de `BENCH_CENTER_OFFSET`
// (le milieu de cette empreinte) le long de l'axe de visÃ©e, dans le sens OPPOSÃ‰ Ã  la camÃ©ra.
//
// yaw=0 est le SEUL yaw possible au premier peuplement â€” il a lieu avant la premiÃ¨re image, donc
// avant toute rotation de camÃ©ra (`yaw` n'est mÃªme pas encore dÃ©clarÃ© Ã  ce point du fichier) â€” et
// Ã  yaw=0, `updateCamera` place la camÃ©ra Ã  `camTarget.z + horizontal` : la camÃ©ra est du cÃ´tÃ© +Z,
// donc l'opposÃ© de la camÃ©ra est -Z. La mÃªme hypothÃ¨se reste la bonne approximation pour un
// rÃ©armement ultÃ©rieur (voir round 4 ci-dessous) : hors orbite active, `yaw` revient tout seul vers
// 0 par amortissement exponentiel (`updateCamera`), donc -Z reste la direction correcte dÃ¨s que le
// joueur n'est pas activement en train de faire tourner la camÃ©ra pile au moment du rÃ©armement.
//
// Round 4 de revue : ce calcul Ã©tait fait UNE fois ici et figÃ© dans `benchCenter`, que `bench.ts`
// fermait ensuite pour toujours â€” peupler la charge lourde restait donc ancrÃ© au spawn mÃªme si le
// hÃ©ros marchait ensuite jusqu'Ã  l'Ã®le polaire et qu'on rappelait `bench.populate()` depuis la
// console : la population, hors cadre, se faisait culler et le chiffre relevÃ© au pÃ´le Ã©tait plus
// bas qu'au spawn alors que trois effets de particules tournent en plus. `benchCenter` devient donc
// un ACCESSEUR, relu par `bench.ts` Ã  CHAQUE `populate()` plutÃ´t qu'une seule fois Ã  la
// construction â€” au tout premier appel (avant la boucle), `hero.position` est encore celle du
// spawn, donc une mesure prise lÃ  reste identique Ã  avant ce correctif ; un rÃ©armement plus tard
// (dÃ©placement/tÃ©lÃ©portation suivi d'un nouvel appel Ã  `populate()`) recentre alors rÃ©ellement sur
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
// Round 3 de revue : `scheduleBenchMeasure` se redÃ©clenche Ã  CHAQUE bascule jour/nuit, longtemps
// aprÃ¨s ce peuplement â€” instantanÃ© de l'Ã©tat qui a servi Ã  peupler, comparÃ© plus tard dans
// `runBenchMeasure` (`benchStillValid`, `bench.ts`) avant d'afficher un chiffre au HUD.
//
// Round 5 de revue : cet instantanÃ© Ã©tait un `const` pris une seule fois, alors que le round 4
// venait de rendre `benchCenter` relisable Ã  chaque peuplement. Le correctif n'Ã©tait donc appliquÃ©
// qu'Ã  moitiÃ© : rÃ©armer au pÃ´le recentrait bien la charge, puis `benchStillValid` comparait la
// position courante Ã  celle du SPAWN, concluait Â« dÃ©placÃ© depuis le peuplement Â» et affichait
// Â« mesure invalide Â» Ã  jamais dÃ¨s qu'on quittait le spawn â€” rÃ©armÃ© ou non. Il doit donc se
// rafraÃ®chir avec la charge, ce qui n'est garanti qu'en passant par un point d'entrÃ©e unique.
let benchPopulatedAt: BenchSnapshot = {
  heroX: hero.position.x,
  heroZ: hero.position.z,
  cameraDistance: CAMERA.distance,
};

/**
 * Le SEUL point d'entrÃ©e du peuplement du harnais : il recentre la charge sur la position courante
 * et rÃ©aligne l'instantanÃ© de validitÃ© dans le mÃªme geste. Appeler `bench.populate()` directement
 * peuple sans rafraÃ®chir l'instantanÃ©, ce qui est exactement le demi-correctif dÃ©crit ci-dessus.
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

// Mesurer ailleurs qu'au spawn suppose de rÃ©armer SUR PLACE, et jusqu'ici cela n'Ã©tait possible
// qu'en bricolant depuis la console ou en Ã©ditant `SPAWN` avant de recharger. Trois mesures fausses
// de suite sur ce chantier ont eu pour cause une charge mal ancrÃ©e : autant rendre le geste correct
// explicite plutÃ´t que de compter sur la ruse de celui qui mesure.
if (benchLevel !== "off") {
  (globalThis as unknown as { labBench?: { armer: () => void } }).labBench = {
    armer: armerBench,
  };
}

// TÃ©lÃ©portation de DEBUG (aucune mÃ©canique de jeu ne s'en sert) : trois implÃ©menteurs successifs
// de la Task 5 (glace fine) n'ont pas pu vÃ©rifier leur travail sur l'Ã®le du nord â€” la traversÃ©e se
// fait Ã  la nage, le souffle y est calibrÃ© juste (doublement consommÃ© dans le couloir polaire,
// `ZONE_POLAIRE.souffle`), et chacun s'est noyÃ© avant d'accoster. Sans poignÃ©e, le seul recours
// Ã©tait de bricoler `SPAWN` puis de recharger toute la scÃ¨ne. `versIleDuNord` Ã©vite Ã  quiconque
// d'avoir Ã  retrouver les coordonnÃ©es de `NORD` (`settings.ts`) : elle pose le hÃ©ros au centre du
// lac gelÃ© â€” solide (matiÃ¨re "glace", pas "glace-fine"), Ã  quelques pas seulement de la couronne
// de glace fine Ã  tester. ExposÃ©e INCONDITIONNELLEMENT (pas seulement sous `?bench=`) : contrairement
// au harnais de mesure, ce n'est pas une charge coÃ»teuse, et c'est utile dans toute session de dev.
(
  globalThis as unknown as {
    labHero?: { teleporter: (x: number, z: number) => void; versIleDuNord: () => void };
  }
).labHero = {
  teleporter: (x, z) => hero.teleport(x, z),
  versIleDuNord: () => hero.teleport(NORD.x, NORD.z),
};

// --- lumiÃ¨res -----------------------------------------------------------------------------------
const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xffffff, 1);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
// Ã‰tendue fixe, et non proportionnelle Ã  la carte : la shadow map suit le hÃ©ros, l'Ã©taler sur
// toute l'Ã®le ne ferait que gÃ¢cher sa dÃ©finition.
const OMBRE = 26;
sun.shadow.camera.left = -OMBRE;
sun.shadow.camera.right = OMBRE;
sun.shadow.camera.top = OMBRE;
sun.shadow.camera.bottom = -OMBRE;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 90;
sun.shadow.bias = -0.0006;
// Les sprites reÃ§oivent dÃ©sormais les ombres, et leur propre quad figure dans la shadow map
// (shadowSide DoubleSide, sans quoi ils n'en projetteraient aucune) : sans un biais le long de la
// normale, chacun s'auto-ombrerait.
sun.shadow.normalBias = 0.09;
scene.add(sun);
scene.add(sun.target);

// Contre-jour, pris du cÃ´tÃ© OPPOSÃ‰ au soleil. Les normales des sprites sont bombÃ©es vers la
// gauche et vers la droite : une lumiÃ¨re latÃ©rale n'allume donc qu'une de leurs deux arÃªtes â€”
// c'est exactement le liserÃ© qui les dÃ©tache du dÃ©cor.
const rim = new THREE.DirectionalLight(0xffffff, 0);
// CantonnÃ© au calque des sprites : appliquÃ© au sol et aux falaises, ce contre-jour sans ombre
// n'Ã©tait plus un liserÃ© mais un voile qui dÃ©lavait le dÃ©cor.
rim.layers.set(RIM_LAYER);
scene.add(rim);
scene.add(rim.target);

// --- rendu ----------------------------------------------------------------------------------
const pipeline = createPipeline(canvas, scene, camera, ctx);
// `resize()` ne s'abonne plus lui-mÃªme : c'est l'appelant qui le fait, pour que `dispose()`
// puisse se dÃ©sabonner proprement.
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
  // par ambiance (`MoodConfig.grade`, `mood.ts`) â€” `setGrade` (`pipeline.ts`) est le seul point
  // d'entrÃ©e typÃ© dÃ©sormais, plus besoin du cast local que `pipeline.grade` imposait auparavant.
  pipeline.setGrade({
    saturation: m.grade.saturation,
    contrast: ctx.config.postfx.grade.contrast,
    lift: m.grade.lift,
    vignette: ctx.config.postfx.grade.vignette,
  });
  // Sous-exposer fait Â« nuit Â» bien plus franchement que de baisser chaque lumiÃ¨re une Ã  une â€”
  // celles-ci ne font que la teinter.
  pipeline.renderer.toneMappingExposure = m.exposure;
  clouds.setStrength(m.clouds);
  water.colors.shallow.copy(m.water.shallow);
  water.colors.deep.copy(m.water.deep);
  water.setSparkle(m.water.sparkle);
  // Le halo du foyer suit l'ambiance : en plein jour, un feu de camp ne fait pas de flaque de
  // lumiÃ¨re, il n'a que sa flamme. Les deux couches pÃ¨sent le mÃªme poids : donner le dessus Ã  la
  // petite lui rendait aussitÃ´t son statut de tache principale, et le rond revenait.
  const feuOpacite = THREE.MathUtils.clamp(m.fire / 13, 0.16, 1);
  (props.fireGlow.material as THREE.MeshBasicMaterial).opacity = feuOpacite * 0.5;
  (props.fireHalo.material as THREE.MeshBasicMaterial).opacity = feuOpacite * 0.5;
  // La source chaude (Task 10 de l'Ã®le de neige) suit EXACTEMENT la mÃªme rÃ¨gle jour/nuit que le
  // foyer â€” mÃªme canal `m.fire`, pas un second canal de mood par source : il n'y a qu'une seule
  // horloge jour/nuit pour toute la carte (voir le commentaire d'`aurora`/`fogPulse` dans `MOODS`,
  // `settings.ts`, pour le mÃªme principe appliquÃ© ailleurs).
  (props.springGlow.material as THREE.MeshBasicMaterial).opacity = feuOpacite * 0.5;
  (props.springHalo.material as THREE.MeshBasicMaterial).opacity = feuOpacite * 0.5;
  // La dÃ©cision d'ombre (nuit ET bonne zone) est calculÃ©e dans `updateSourceShadows` â€” voir sa
  // JSDoc pour pourquoi ELLE seule ne suffit pas ici et doit aussi Ãªtre rappelÃ©e depuis `applyZone`.
  updateSourceShadows();
  particles.apply(m);
  sky.apply(m, sun.position.clone().sub(sun.target.position));
  // `fog.color` n'est PAS recopiÃ© ici : `sky.horizon` change aussi hors fondu d'ambiance (l'aurore
  // polaire le teinte Ã  chaque image, voir `frame()`) â€” le copier seulement ici le figerait entre
  // deux bascules jour/nuit. C'est `frame()` qui le fait, Ã  chaque image, juste aprÃ¨s `sky.update`.
}

// --- zones ------------------------------------------------------------------------------------
// La zone du hÃ©ros porte son ambiance â€” nappe, musique et taux de souffle (voir `world/zones.ts`,
// `settings.ts`). `zoneActuelle` retient la zone en cours pour dÃ©tecter le CHANGEMENT plutÃ´t que
// de le redÃ©clencher Ã  chaque image : comparÃ©e par IDENTITÃ‰ (`!==`), pas par nom, exactement comme
// `Zone` le documente â€” un fondu qui repart de zÃ©ro soixante fois par seconde ne monte jamais (voir
// `core/audio.ts`, `MUSIQUE_BASCULE`). `null` au dÃ©part pour que la toute premiÃ¨re image dÃ©clenche
// bien `setAmbience` une fois, mÃªme si le hÃ©ros dÃ©marre dÃ©jÃ  dans la zone par dÃ©faut.
let zoneActuelle: Zone | null = null;

/** Ã€ appeler chaque image avec la zone dÃ©terminÃ©e pour cette image. N'agit qu'au changement. */
function applyZone(zone: Zone): void {
  if (zone === zoneActuelle) return;
  zoneActuelle = zone;
  // La musique obÃ©it Ã  la zone (`zone.musique`, `null` = silence) et la nappe lui obÃ©it aussi
  // sÃ©parÃ©ment (`zone.nappe`) â€” les deux noms diffÃ¨rent pour la polaire ("neige" contre
  // "polaire"), d'oÃ¹ deux appels distincts plutÃ´t qu'un seul nom partagÃ© (voir `core/audio.ts`,
  // `setZoneMusic` vs `setAmbience`).
  setZoneMusic(zone.musique);
  // `ZONE_LARGE` est la zone qui DÃ‰LÃˆGUE au cycle jour/nuit (voir `applyMood` plus bas) : sa
  // `nappe` figÃ©e Ã  "jour" dans `settings.ts` ne serait correcte qu'en plein jour. En y revenant,
  // on lit donc l'ambiance courante du mood plutÃ´t que ce champ statique â€” sinon rentrer du pÃ´le
  // de nuit Ã©craserait silencieusement une nuit choisie Ã  la main par un "jour" en dur.
  setAmbience(zone === ZONE_LARGE ? (mood.name === "day" ? "jour" : "nuit") : zone.nappe);
  // Revue post-Task 10 : le pÃ´le et le camp du sud ne sont JAMAIS covisibles (une trentaine
  // d'unitÃ©s sÃ©parent les deux Ã®les), donc chaque source n'a besoin de projeter que dans SA zone â€”
  // voir `updateSourceShadows` juste en dessous. AppelÃ©e ICI, au changement de zone, pas seulement
  // depuis `pushMood` (bascules jour/nuit) : `enPolaire` change au FIL DE LA MARCHE du hÃ©ros, pas Ã 
  // une bascule d'ambiance, et `pushMood` ne tourne pas Ã  chaque image.
  updateSourceShadows();
}

/**
 * DÃ©cide, pour CHAQUE source ponctuelle, si elle doit projeter une ombre â€” six rendus de scÃ¨ne
 * chacune, d'oÃ¹ la rÃ¨gle Â« seulement si Ã§a peut se voir Â». Deux conditions, comme avant : la nuit
 * (`mood.value.fire` au-delÃ  du seuil, inchangÃ©) ET, nouveau depuis la revue, Ãªtre dans la zone oÃ¹
 * cette source est visible. Le foyer du sud (`fireLight`) n'a besoin de projeter que HORS de la
 * zone polaire ; la source chaude du nord (`springLight`), seulement DEDANS â€” les deux Ã®les ne sont
 * jamais covisibles, donc jamais besoin des deux ombres Ã  la fois.
 *
 * PiÃ¨ge Ã  ne pas rÃ©introduire : un naÃ¯f `castShadow = ... && enPolaire` Ã©crit directement dans
 * `pushMood` ne marche PAS. `pushMood` ne tourne qu'aux transitions d'ambiance (l'amorÃ§age et
 * chaque bascule jour/nuit), jamais Ã  chaque image â€” alors que la zone du hÃ©ros change en marchant,
 * sans aucune bascule jour/nuit. Entrer en zone polaire de nuit ne redÃ©clencherait donc aucun
 * `pushMood`, et l'ombre resterait Ã©teinte exactement lÃ  oÃ¹ on la regarde. D'oÃ¹ les DEUX points
 * d'appel : `pushMood` (la nuit tombe/se lÃ¨ve, la zone ne change pas) et `applyZone` (le hÃ©ros
 * change de zone, l'ambiance ne change pas) â€” chacun couvre l'axe que l'autre ne peut pas voir
 * bouger. Aucun des deux n'appelle cette fonction Ã  chaque image : `pushMood` ne tourne que pendant
 * un fondu jour/nuit (rare), et `applyZone` n'agit que sur un changement RÃ‰EL de zone (comparaison
 * d'identitÃ©, voir plus haut) â€” donc PAS une Ã©criture three.js par frame, seulement sur les
 * transitions elles-mÃªmes, exactement comme le reste du cÃ¢blage de zone.
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
 * Reprend la mÃ©thode du CLAUDE.md du PoC (voir `bench.ts`, `measure`) : un `readPixels` force la
 * synchro GPU, donc l'appel BLOQUE quelques dizaines de ms â€” acceptable ici puisqu'il ne tourne
 * qu'au chargement et Ã  chaque bascule jour/nuit, jamais Ã  chaque frame.
 *
 * Round 3 de revue : avant de mesurer, on vÃ©rifie que le hÃ©ros n'a pas marchÃ© et que la camÃ©ra n'a
 * pas zoomÃ© depuis `Bench.populate()` (`benchStillValid`, `bench.ts`) â€” sans ce garde-fou, une
 * mesure prise aprÃ¨s une bascule jour/nuit tardive (le hÃ©ros a eu le temps de marcher entre-temps)
 * porte sur une scÃ¨ne dont le peuplement est en grande partie hors cadre, et le HUD l'affichait
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
    benchEl.textContent = `âš™ ${benchLevel} mesure invalide : dÃ©placÃ©/zoomÃ© depuis le peuplement`;
    return;
  }
  // Trois.js n'accepte plus que WebGL2 depuis longtemps (three ^0.185) : le cast est sÃ»r.
  const gl = pipeline.renderer.getContext() as WebGL2RenderingContext;
  const ms = await bench.measure(pipeline.render, gl);
  benchEl.textContent = `âš™ ${benchLevel} ${ms.toFixed(2)} ms/frame`;
}

/** Ne mesure qu'une fois l'ambiance stabilisÃ©e : mesurer en pleine transition jour/nuit lirait un
 *  Ã©tat intermÃ©diaire, ni jour ni nuit, qui ne raconte rien du budget GPU rÃ©el de l'un ou l'autre. */
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
  // La nappe jour/nuit n'appartient au mood que dans `ZONE_LARGE` â€” une zone (la polaire, par
  // exemple) qui a pris la main sur `setAmbience` doit la garder tant qu'on y reste, sinon "N"
  // pressÃ© au pÃ´le Ã©craserait la nappe polaire par la boucle de nuit. `applyZone` (plus haut)
  // rattrape l'ambiance correcte tout seul dÃ¨s qu'on REVIENT dans `ZONE_LARGE`, en relisant
  // `mood.name` Ã  ce moment-lÃ  â€” ce n'est donc pas un choix perdu, seulement diffÃ©rÃ©.
  if (zoneActuelle === ZONE_LARGE) setAmbience(name === "day" ? "jour" : "nuit");
  if (moodLabel) moodLabel.textContent = name === "day" ? "â˜€ï¸Ž jour" : "â˜¾ nuit";
  scheduleBenchMeasure();
}

// --- dialogue ---------------------------------------------------------------------------------
// Le son est passÃ© en paramÃ¨tre : le bandeau ne connaÃ®t ni les fichiers ni le contexte audio, il
// sait seulement qu'une rÃ©plique se dit, se coupe, et qu'un passage se ponctue.
const dialog = createDialog({ say: sayLine, stop: stopLine, next: ding });
const prompt = createPrompt();

const GROTA_DIT = [
  "Hm. Un chevalier. Et qui a fait la traversÃ©e Ã  la nage, en plus.",
  "Personne ne vient jamais ici. Ce caillou nâ€™a rien : un mamelon, trois brins dâ€™herbe, et moi.",
  "De lÃ -haut on voit tout le reste â€” les paliers, le troupeau, ton feu de camp qui fume.",
  "Repars avant la nuit. Elle tombe pour de bon, ici. Au large, on ne voit plus sa propre main.",
];

// Nanuq, l'habitant de la banquise (Task 12 de l'Ã®le de neige) : quatre rÃ©pliques, comme Grota,
// mais qui parlent du FROID, de la glace qui ne tient pas partout, et de ce qu'il fait lÃ  â€” le
// registre Ã  tenir est celui de Grota (terse, sec, jamais explicatif), pas un cahier des charges.
// La 3e rÃ©plique est un tutoriel dÃ©guisÃ© : elle dÃ©crit la VRAIE mÃ©canique de la glace fine
// (`@lindocara/engine/hd2d/thin-ice.js`, `GLACE_FINE` dans `settings.ts`) â€” elle craque, PUIS elle cÃ¨de.
const VOYAGEUR_DIT = [
  "Bonjour, voyageur. J'ai monté ce camp pour voir qui passe.",
  "Le feu éclaire plus que ça : approche, ça déclenche la discussion.",
  "Tu as déjà vu le nord ? Le terrain change vite après la zone des brumes."
];
const HABITANT_DIT = [
  "Tiens. Un chevalier qui a nagÃ© jusquâ€™ici. Tu ne dois plus sentir tes doigts.",
  "Je pose mes lignes oÃ¹ le poisson remonte respirer. Le reste du temps, je rÃ©pare ce que le vent dÃ©fait.",
  "La glace grince avant de cÃ©der, un vrai avertissement, pas un bruit de rien. Si tu lâ€™entends sous tes pas, bouge.",
  "Elle ne tient pas partout pareil. Ce qui a cÃ©dÃ© regÃ¨le, avec le temps, mais pas ce jour-lÃ . Choisis oÃ¹ tu marches.",
];

const fondu = document.getElementById("fade");
let enTransition = false;

/** Coupe l'image le temps de dÃ©placer le hÃ©ros : sans Ã§a on verrait la carte dÃ©filer d'un bout Ã 
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
  // Nanuq (Task 12 de l'Ã®le de neige) : mÃªme garde `!hero.swimming` que Grota â€” les deux zones
  // de portÃ©e sont Ã  des dizaines d'unitÃ©s l'une de l'autre (Ã®les diffÃ©rentes), donc jamais
  // vraies en mÃªme temps ; `portee` peut donc les combiner sans jamais devoir arbitrer entre les
  // deux PNJ.
  const porteeNanuq = nanuq.inReach(hero.position) && !hero.swimming;
  const porteeVoyageur = voyageur.inReach(hero.position) && !hero.swimming;
  const portee = porteeGrota || porteeNanuq || porteeVoyageur;
  // S'Ã©loigner referme la conversation : rester Ã  l'Ã©coute d'un PNJ qu'on ne voit plus n'aurait
  // aucun sens, et Ã§a Ã©vite un bandeau orphelin Ã  l'Ã©cran.
  if (dialog.open && (!portee || cancel)) dialog.close();
  else if (action) {
    if (dialog.open) dialog.advance();
    else if (porteeVoyageur)
      dialog.start("Voyageur", VOYAGEUR_DIT);
    else if (porteeGrota) dialog.start("Grota", GROTA_DIT, "/ui/grota.png", "grota");
    else if (porteeNanuq) dialog.start("Nanuq", HABITANT_DIT, "/ui/habitant.png", "habitant");
  }
  // Une seule invite pour toute la scÃ¨ne : les PNJ et le coffre s'y partagent la mÃªme pastille.
  const surSeuil = hero.indoors
    ? interior.nearExit(hero.position)
    : !!house && house.atDoor(hero.position);
  prompt.shown = (portee || chest.canInteract || surSeuil) && !dialog.open;
  // Les deux occupent le mÃªme bas d'Ã©cran : l'aide s'efface le temps de parler.
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
      soundLabel.textContent = actif === null ? "â™ª aucune piste" : actif ? "â™ª musique" : "";
  },
  onToggleDebug: () => {
    const debugLabel = document.getElementById("debug");
    if (debugLabel) debugLabel.textContent = debugView.toggle() ? "â–£ collisions" : "";
  },
});

// --- clic sur un mouton -----------------------------------------------------------------------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const soundLabel = document.getElementById("sound");
if (soundLabel) soundLabel.textContent = musicEnabled() ? "â™ª musique" : "";

/** CoordonnÃ©es normalisÃ©es du pointeur, pour le raycast. */
function viserAvec(e: PointerEvent): void {
  const r = canvas.getBoundingClientRect();
  pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
}

// Le curseur passe Ã  la main au survol d'un mouton : c'est la seule chose cliquable de la scÃ¨ne,
// autant que Ã§a se voie.
canvas.addEventListener("pointermove", (e) => {
  viserAvec(e);
  const survol = raycaster.intersectObjects([...props.flock.meshes], false).length > 0;
  canvas.classList.toggle("pointe", survol);
});

canvas.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return; // le bouton droit fait tourner la camÃ©ra
  viserAvec(e);
  const hit = raycaster.intersectObjects([...props.flock.meshes], false)[0];
  if (hit) props.flock.hit(hit.object);
});

// --- camÃ©ra -----------------------------------------------------------------------------------
let distance = CAMERA.distance;
let yaw = 0;
const camTarget = new THREE.Vector3(
  hero.position.x,
  hero.position.y + CAMERA.height,
  hero.position.z,
);
// Le point visÃ© devance le hÃ©ros dans sa direction de course : la camÃ©ra respire au lieu de le
// coller au centre du cadre.
const avance = new THREE.Vector3();
const wanted = new THREE.Vector3();
const astre = new THREE.Vector3();

// Secousse : une rÃ©ception sans Ã -coup, ou une dÃ©tonation, n'ont aucun poids.
let secousse = 0;
const shake = (a: number) => {
  secousse = Math.max(secousse, a);
};
props.flock.onExplode = () => shake(0.26);

// Aurore et pulse de blizzard (Task 9 de l'Ã®le de neige) : deux canaux `MoodConfig`
// (`aurora`/`fogPulse`) qui valent 0 dans les deux ambiances du labo (voir `MOODS`,
// `settings.ts`) â€” c'est ICI, en zone polaire, que `frame()` les allume, avec leur PROPRE fondu
// (`AURORE.fade`/`BLIZZARD.fade`) indÃ©pendant de celui du jour/nuit (`MOOD_FADE`), qui ignore la
// position du hÃ©ros.
let auroraAmount = 0;
let fogPulseAmount = 0;

// Son de rafale (Correction 1 de la revue de cette task) : `rafalePrec` retient la valeur du signal
// visuel calculÃ©e Ã  l'image prÃ©cÃ©dente, pour repÃ©rer son FRANCHISSEMENT ASCENDANT du seuil
// (`BLIZZARD.seuilSon`, `settings.ts`) â€” c'est ce franchissement qui marque le DÃ‰BUT d'une
// bourrasque, pas chaque image oÃ¹ le signal reste fort. `null` tant qu'aucune image n'a encore Ã©tÃ©
// mesurÃ©e EN ZONE POLAIRE (et remis Ã  `null` dÃ¨s qu'on en sort) : sans ce garde, entrer dans la zone
// au milieu d'une bourrasque dÃ©jÃ  haute lirait un "franchissement" dÃ¨s la premiÃ¨re image, comme si
// elle venait tout juste de commencer. `dernierGustAt` est le filet de sÃ©curitÃ© demandÃ© en revue :
// un intervalle plancher (`BLIZZARD.intervalleSonMin`) au cas oÃ¹ un futur rÃ©glage ferait se
// redÃ©clencher le seuil trop vite pour rester "une bourrasque, un son".
let rafalePrec: number | null = null;
let dernierGustAt = -Infinity;

function updateCamera(
  dt: number,
  cmd: InputSample,
  move: { x: number; z: number },
  t: number,
  enPolaire: boolean,
): void {
  distance = THREE.MathUtils.clamp(distance + cmd.zoom, CAMERA.zoom.min, CAMERA.zoom.max);
  // La rotation n'est qu'un coup d'oeil : elle revient d'elle-mÃªme une fois le bouton relÃ¢chÃ©,
  // pour que l'axe des commandes reste celui qu'on connaÃ®t.
  yaw = cmd.orbiting
    ? THREE.MathUtils.clamp(yaw + cmd.yaw, -CAMERA.yawRange, CAMERA.yawRange)
    : yaw * Math.exp(-CAMERA.yawReturn * dt);
  // Les sprites sont des plans : sans Ã§a on finirait par les voir par la tranche.
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
  // Amorti exponentiel : indÃ©pendant du framerate, contrairement Ã  un lerp fixe.
  camTarget.lerp(wanted, 1 - Math.exp(-CAMERA.follow * dt));

  const horizontal = Math.cos(CAMERA.pitch) * distance;
  camera.position.set(
    camTarget.x + Math.sin(yaw) * horizontal,
    camTarget.y + Math.sin(CAMERA.pitch) * distance,
    camTarget.z + Math.cos(yaw) * horizontal,
  );
  camera.lookAt(camTarget);

  // DÃ©calÃ©e APRÃˆS le cadrage : la camÃ©ra tremble sans changer de cible.
  if (secousse > 5e-4) {
    const f = t * CAMERA.shake.frequency;
    camera.position.x += Math.sin(f) * secousse;
    camera.position.y += Math.sin(f * 1.37 + 1.1) * secousse;
    secousse *= Math.exp(-CAMERA.shake.decay * dt);
  } else secousse = 0;

  // L'azimut du soleil oscille lentement : les ombres balaient l'Ã®le, et c'est la dÃ©monstration
  // la plus directe que la lumiÃ¨re est calculÃ©e, pas peinte. Le dÃ©battement reste dans le
  // quadrant d'origine â€” de l'autre cÃ´tÃ©, les ombres partiraient vers la camÃ©ra et toute la scÃ¨ne
  // basculerait.
  const [sx, sy, sz] = mood.value.sun.position;
  const a = SUN_DRIFT.amplitude * Math.sin((t / SUN_DRIFT.period) * Math.PI * 2);
  astre.set(sx * Math.cos(a) + sz * Math.sin(a), sy, -sx * Math.sin(a) + sz * Math.cos(a));
  sun.target.position.copy(camTarget);
  sun.position.copy(camTarget).add(astre);

  // Le contre-jour suit la mÃªme dÃ©rive, en miroir : il doit rester en face.
  rim.target.position.copy(camTarget);
  astre.set(...mood.value.rim.position).applyAxisAngle(THREE.Object3D.DEFAULT_UP, a);
  rim.position.copy(camTarget).add(astre);

  // Le brouillard suit le zoom, mais pas des deux cÃ´tÃ©s Ã  la mÃªme vitesse : le plan proche reste
  // proportionnel â€” le hÃ©ros garde sa nettetÃ© quel que soit le zoom â€” pendant que le plan
  // lointain grandit moins vite. Reculer resserre donc la bande, et l'Ã®le se dissout par les
  // bords au lieu d'Ãªtre simplement la mÃªme image en plus petit.
  const k = distance / CAMERA.distance;
  fog.near = mood.value.fog.near * k;
  // Le pulse de blizzard (Task 9) resserre la portÃ©e par rafales qui TRAVERSENT la zone : la phase
  // se dÃ©duit de la position du hÃ©ros (`windPhase`, `world/props.ts`, rÃ©utilisÃ©e telle quelle â€”
  // c'est la mÃªme bourrasque que celle qui balaie les arbres), pas d'une horloge globale, sinon la
  // rafale pulserait partout Ã  la fois au lieu de balayer l'Ã®le. `mood.value.fogPulse` reste Ã  0
  // dans les deux ambiances du labo ; `fogPulseAmount` porte la contribution de la zone polaire.
  const rafale =
    0.5 +
    0.5 * Math.sin((windPhase(camTarget.x, camTarget.z, 1) - t / BLIZZARD.periode) * Math.PI * 2);
  // BornÃ©e Ã  1 : les deux termes valent 0 dans les ambiances du labo aujourd'hui, donc sans effet
  // observable, mais `fogPulse`/`aurora` existent prÃ©cisÃ©ment pour qu'une AUTRE ambiance future s'en
  // serve aussi â€” une somme non bornÃ©e pourrait alors dÃ©passer 1 et faire dÃ©border le `lerp` de
  // teinte plus bas (`sky.update`) ou ici la resserre du brouillard au-delÃ  de ce que `intensite`
  // prÃ©voit.
  const pulse = Math.min(1, mood.value.fogPulse + fogPulseAmount) * rafale * BLIZZARD.intensite;
  fog.far = mood.value.fog.far * k ** CAMERA.fogFar * (1 - pulse);
  // Reculer doit renforcer l'effet maquette, pas l'aplatir.
  pipeline.setTiltShiftZoom(k);

  // Son de rafale (Correction 1 de la revue) : uniquement en zone polaire â€” `hd2d` ne sait pas qu'un
  // biome de neige existe, ce gating reste donc entiÃ¨rement ici, cÃ´tÃ© labo, jamais dans le package.
  // `rafale` ci-dessus EST dÃ©jÃ  le signal visuel (mÃªme formule que le pulse de brouillard) : on le
  // relit tel quel plutÃ´t que d'en dÃ©river un second, pour que le son et l'image ne puissent jamais
  // diverger. Un franchissement ASCENDANT du seuil = le dÃ©but d'une bourrasque ; le plancher
  // `intervalleSonMin` est un filet de sÃ©curitÃ©, pas le mÃ©canisme principal (voir la dÃ©claration de
  // `rafalePrec` plus haut pour le raisonnement complet, notamment le cas d'une entrÃ©e en zone en
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

// --- amorÃ§age -----------------------------------------------------------------------------------
// Un premier cadrage Ã  vide avant de pousser l'ambiance : `pushMood` a besoin de la direction du
// soleil, que c'est la camÃ©ra qui place.
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
  // Pas encore en zone polaire Ã  cet instant (le spawn ne l'est pas) : aucun son de rafale Ã  ce
  // premier cadrage Ã  vide.
  false,
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

// Marge d'1 ms : sur un Ã©cran 60 Hz, la gigue du rAF ferait sinon rater une frame sur deux et on
// tomberait Ã  30.
const MIN_FRAME_MS = TARGET_FPS ? 1000 / TARGET_FPS - 1 : 0;

// --- appoint de lumiÃ¨re, plusieurs sources (Task 10 de l'Ã®le de neige) ------------------------
// MÃªme distance plancher que `fill-light.ts` (non exportÃ©e de hd2d â€” `DISTANCE_MIN`) : un sprite
// au contact d'une source ne doit pas diviser par zÃ©ro.
const APPOINT_DISTANCE_MIN = 0.6;

/**
 * `applyFillFromPointLight` (hd2d) Ã‰CRASE l'Ã©missif de chaque sprite Ã©clairÃ© Ã  chaque appel â€” un
 * choix correct tant qu'une seule source existe dans la scÃ¨ne. La source chaude en ajoute une
 * seconde, permanente : appeler la fonction de hd2d deux fois de suite (une par source) ferait
 * perdre le rÃ©sultat du premier appel au second, quelle que soit sa distance â€” un hÃ©ros au feu du
 * sud verrait son appoint Ã©crasÃ© par la source du nord (Ã  ~30 unitÃ©s, donc quasi nulle) si elle
 * est appliquÃ©e en second, et rÃ©ciproquement pour un hÃ©ros Ã  la source. PiÃ¨ge nÂ°3 du brief, sous
 * une forme que le feu seul ne pouvait pas rÃ©vÃ©ler.
 *
 * hd2d exporte `fillAmount` â€” la brique PURE, sÃ©parÃ©e de la boucle qui l'applique â€” prÃ©cisÃ©ment
 * pour ce genre de composition : on somme sa contribution pour chaque source ICI, dans le labo,
 * sans qu'`@lindocara/hd2d` ait Ã  connaÃ®tre ni une seconde source ni l'existence d'une Ã®le de
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
  // Les commandes sont relatives Ã  l'Ã©cran : on les tourne avec la camÃ©ra pour que "vers le haut"
  // reste "vers le fond" quelle que soit son orientation.
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const move = { x: cmd.x * cy + cmd.z * sy, z: cmd.z * cy - cmd.x * sy };
  // Pendant qu'on parle, le hÃ©ros est spectateur : ni pas, ni saut, ni coup. Les commandes sont
  // neutralisÃ©es ICI et non dans `hero.ts` â€” c'est la scÃ¨ne qui sait qu'une conversation est en
  // cours, pas le personnage. Le zoom et la rotation de camÃ©ra, eux, restent libres.
  const fige = dialog.open;
  // La zone se lit sur la position d'ENTRÃ‰E de l'image, avant que `hero.update` ne la dÃ©place â€”
  // mÃªme principe que tout le reste de la boucle, qui lit `hero.position` avant de la faire
  // avancer. `applyZone` ne fait rien si la zone n'a pas changÃ© (voir plus haut) ; `zone.souffle`,
  // lui, est lu Ã  CHAQUE image, changÃ©e ou non, pour que le hÃ©ros n'ait jamais une constante figÃ©e.
  const zone = zoneAt(ZONES, hero.position.x, hero.position.z);
  applyZone(zone);
  // ÃŽle de neige (Task 8) : aucun des trois effets d'ambiance (flocons, souffle, traces) ne doit
  // tourner hors de la zone polaire â€” comparaison d'IDENTITÃ‰, comme le reste du cÃ¢blage de zone
  // (`applyZone`, `applyMood`) plutÃ´t qu'un nom. Les traces se gÃ¨rent d'elles-mÃªmes (elles ne se
  // posent que sur la matiÃ¨re "neige", gÃ©ographiquement confinÃ©e Ã  cette mÃªme Ã®le â€” voir
  // `world/island.ts`) ; le souffle et les flocons ont besoin de ce drapeau explicite.
  const enPolaire = zone === ZONE_POLAIRE;
  // Aurore et pulse de blizzard suivent la zone avec leur propre fondu â€” voir la dÃ©claration de
  // `auroraAmount`/`fogPulseAmount` plus haut. L'aurore, en plus, exige la NUIT (un ruban vert dans
  // un ciel de plein jour serait absurde) ; le blizzard, lui, souffle Ã  toute heure.
  const auroraCible = enPolaire && mood.name === "night" ? 1 : 0;
  auroraAmount += (auroraCible - auroraAmount) * (1 - Math.exp(-dt / AURORE.fade));
  const fogPulseCible = enPolaire ? 1 : 0;
  fogPulseAmount += (fogPulseCible - fogPulseAmount) * (1 - Math.exp(-dt / BLIZZARD.fade));
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
  voyageur.update(dt, hero.position);
  parler(cmd.action, cmd.cancel);
  dialog.update(dt);
  water.update(dt);
  foam.update(dt);
  clouds.update(dt);
  particles.update(dt);
  // Ne coÃ»te et ne tourne que dans la zone polaire (voir `enPolaire` ci-dessus) : ni mise Ã  jour
  // ni visibilitÃ© en dehors.
  neige.group.visible = enPolaire;
  if (enPolaire) {
    neigeCentre.set(hero.position.x, hero.position.y + 1, hero.position.z);
    neige.update(dt);
  }
  debugView.update(hero);
  chest.update(hero.position);
  interior.update(dt, elapsed);
  sakura?.petales.update(dt);
  // `mood.value.aurora` reste Ã  0 dans les deux ambiances du labo (voir `MOODS`) ; `auroraAmount`
  // porte la contribution de la zone polaire â€” la somme documente que les deux s'additionnent,
  // mÃªme si l'un des deux termes vaut toujours 0 aujourd'hui. BornÃ©e Ã  1 pour la mÃªme raison que
  // `pulse` dans `updateCamera` : sans effet aujourd'hui, mais `aurora` existe pour qu'une autre
  // ambiance future s'y ajoute, et `sky.update`/`update` (mood.ts) lerpent tous deux sur `[0, 1]`.
  sky.update(dt, camera, Math.min(1, mood.value.aurora + auroraAmount));
  // RecopiÃ© Ã  CHAQUE image, pas seulement au fondu d'ambiance : `sky.horizon` change aussi avec
  // l'aurore, qui suit son propre fondu (`AURORE.fade`) indÃ©pendant de celui du jour/nuit.
  fog.color.copy(sky.horizon);
  updateCamera(dt, cmd, move, elapsed, enPolaire);
  // L'ambiance se fond : tant qu'elle bouge, il faut la repousser partout.
  if (mood.update(dt)) pushMood();

  // Jauge de souffle : visible seulement quand le hÃ©ros est dans l'eau.
  if (breathEl) breathEl.style.display = hero.swimming ? "block" : "none";
  if (hero.swimming && breathBarEl) breathBarEl.style.width = `${Math.max(0, hero.breath) * 100}%`;

  // Le foyer s'entend d'autant plus qu'on en est prÃ¨s.
  setFireDistance(hero.position.distanceTo(props.firePosition));

  props.fireLight.intensity = mood.value.fire * ((props.fireLight.userData.flicker as number) ?? 1);
  props.springLight.intensity =
    mood.value.fire * ((props.springLight.userData.flicker as number) ?? 1);
  // Appoint sur les sprites : un plan face camÃ©ra ne peut rien recevoir d'une source placÃ©e
  // derriÃ¨re lui, alors qu'on s'attend Ã  voir le hÃ©ros Ã©clairÃ© dÃ¨s qu'il est prÃ¨s d'une source
  // chaude â€” feu ou source. On complÃ¨te donc exactement ce que la vraie lumiÃ¨re rate, en fonction
  // de la distance et de l'orientation, pour les DEUX sources Ã  la fois (piÃ¨ge nÂ°3 : sans Ã§a, un
  // hÃ©ros dos Ã  la source devient noir Ã  deux pas d'elle).
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

  // La bande nette suit le hÃ©ros Ã  l'Ã©cran : il reste toujours net.
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
// La scÃ¨ne tourne DERRIÃˆRE l'Ã©cran de chargement : le premier plan est dÃ©jÃ  cadrÃ©, les shaders
// dÃ©jÃ  compilÃ©s, et le voile se lÃ¨ve sur une image vivante plutÃ´t que sur une frame noire.
frame();

// --- lancement --------------------------------------------------------------------------------
// Un navigateur n'autorise le son qu'aprÃ¨s un geste, et il n'y en a aucun au chargement d'une
// page. Sans bouton, la scÃ¨ne dÃ©marrait donc muette jusqu'Ã  ce qu'on touche une touche par hasard
// â€” et souvent on ne remarquait mÃªme pas qu'il manquait quelque chose.
const ecran = document.getElementById("loading");
const bouton = document.getElementById("play");
bouton?.classList.add("on");
bouton?.addEventListener("click", () => {
  unlockAudio();
  ecran?.classList.add("hidden");
  canvas.focus();
});

// RepÃ¨re pour les scripts de capture.
(window as unknown as { __ready?: boolean }).__ready = true;

// Pratique pour bidouiller les rÃ©glages depuis la console du navigateur.
(window as unknown as { lab?: unknown }).lab = {
  THREE,
  scene,
  camera,
  renderer: pipeline.renderer,
  render: pipeline.render,
  field,
  query,
  // La grille de colliders : sans elle, impossible de rÃ©pondre depuis la console Ã  Â« pourquoi ce
  // prop est-il posÃ© lÃ  Â», qui est exactement le genre de question que ce labo existe pour trancher.
  colliders,
  hero,
  chest,
  house,
  sakura,
  grota,
  nanuq,
  voyageur,
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
  // La zone en cours (voir `world/zones.ts`) : pratique pour vÃ©rifier depuis la console qu'entrer
  // dans la zone polaire change bien la nappe, sans avoir Ã  nager jusque lÃ  Ã  chaque fois.
  zone: () => zoneActuelle,
};
