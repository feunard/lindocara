import { makeBillboard, RIM_LAYER } from "@lindocara/hd2d/billboard.js";
import { createCloudCover } from "@lindocara/hd2d/clouds.js";
import { createHd2dContext } from "@lindocara/hd2d/context.js";
import { applyFillFromPointLight } from "@lindocara/hd2d/fill-light.js";
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
  CAMERA,
  MOOD_FADE,
  MOODS,
  NEIGE_CHUTE,
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
import { createColliders } from "./world/colliders.js";
import { createDebugView } from "./world/debug.js";
import { createHero } from "./world/hero.js";
import { createHouse } from "./world/house.js";
import { createInterior } from "./world/interior.js";
import { generateIsland } from "./world/island.js";
import { createGrota } from "./world/npc.js";
import { populate } from "./world/props.js";
import { type Zone, zoneAt } from "./world/zones.js";

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

const blobs = await fetchAll([...TEXTURE_URLS.map((t) => t.url), ...AUDIO_URLS], (p) => {
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
const { field, query } = generateIsland({ size: WORLD.size, seed: WORLD.seed });

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
  // raccords viennent toujours du même bloc 4x4. `"glace-fine"` (voir `island.ts`, `materialAt`)
  // se dessine avec CET atlas `glace` : c'est une matière de règle, pas encore d'apparence.
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

// Les props d'abord : ce sont eux qui déclarent les colliders (arbres, rochers, feu) que le héros
// et Grota testent. `colliders` est créé ICI, dans le composition root, parce que le héros — créé
// juste après Grota — doit voir la MÊME instance que celle que `populate`/`createGrota` peuplent :
// contrairement au PoC, où `props.js` fabrique et possède ses colliders, l'architecture du labo
// (Task 11) fait déjà de `main.ts` le propriétaire de `colliders`.
const colliders = createColliders();

const SPAWN = [-2, 4] as const;
const props = populate(ctx, textures, field, query, colliders, SPAWN);
scene.add(props.group);

// Grota AVANT le héros : il déclare son collider, que le héros doit connaître.
const grota = createGrota(ctx, textures, query, colliders);
scene.add(grota.object);

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
// empreinte entre dans la grille de collision comme n'importe quel prop.
const placeMaison = ((): readonly [number, number] | null => {
  for (let r = 0; r < 6; r++) {
    for (const [ox, oz] of [
      [0, 0],
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [-1, -1],
    ] as const) {
      const x = 25 + ox * r;
      const z = -2 + oz * r;
      if (query.levelAt(x, z) !== 0) continue;
      let plat = true;
      for (let dx = -2; dx <= 2 && plat; dx++)
        for (let dz = -2; dz <= 2 && plat; dz++)
          if (query.levelAt(x + dx, z + dz) !== 0) plat = false;
      if (plat) return [x, z];
    }
  }
  return null;
})();

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
  colliders.add(house.footprint.x, house.footprint.z, house.footprint.r);
}

// L'intérieur vit très loin de la carte, caché tant qu'on n'y est pas entré.
const interior = createInterior(ctx, textures);
scene.add(interior.group);

// Le cerisier devant la maison. 7.5 unités : à l'échelle du héros, qui fait 1.3 unité pour
// environ 1m75, ça vaut la dizaine de mètres demandée.
//
// Décalé de 2.5 unités vers l'est : au point pile devant la maison, le tronc se plantait dans un
// buisson. Les buissons et les décors au sol ne posent PAS de collider (voir `props.ts`) — ils sont
// traversables à dessein — donc aucune recherche de place ne peut les éviter, et le seul recours
// est de choisir le décalage à l'oeil.
const SAKURA_DECALAGE_X = 2.5;
const sakura = ((): {
  petales: ReturnType<typeof createPetalFall>;
  position: THREE.Vector3;
} | null => {
  if (!house) return null;
  const x = house.footprint.x + SAKURA_DECALAGE_X;
  const z = house.footprint.z + 7.5;
  if (query.levelAt(x, z) !== 0) return null;
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
  colliders.add(x, z, 0.42);
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
bench.populate();
// Round 3 de revue : `scheduleBenchMeasure` se redéclenche à CHAQUE bascule jour/nuit, longtemps
// après ce peuplement — instantané de l'état qui a servi à peupler, comparé plus tard dans
// `runBenchMeasure` (`benchStillValid`, `bench.ts`) avant d'afficher un chiffre au HUD.
const benchPopulatedAt: BenchSnapshot = {
  heroX: hero.position.x,
  heroZ: hero.position.z,
  cameraDistance: CAMERA.distance,
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
  // Le halo du foyer suit l'ambiance : en plein jour, un feu de camp ne fait pas de flaque de
  // lumière, il n'a que sa flamme. Les deux couches pèsent le même poids : donner le dessus à la
  // petite lui rendait aussitôt son statut de tache principale, et le rond revenait.
  const feuOpacite = THREE.MathUtils.clamp(m.fire / 13, 0.16, 1);
  (props.fireGlow.material as THREE.MeshBasicMaterial).opacity = feuOpacite * 0.5;
  (props.fireHalo.material as THREE.MeshBasicMaterial).opacity = feuOpacite * 0.5;
  // Six rendus de la scène pour une ombre qu'on ne distingue pas en plein jour : le foyer ne
  // projette qu'une fois la nuit tombée.
  props.fireLight.castShadow = m.fire > 2.2;
  particles.apply(m);
  sky.apply(m, sun.position.clone().sub(sun.target.position));
  // Le brouillard prend la couleur d'horizon du ciel : deux teintes voisines mais distinctes
  // dessinaient une ligne franche là où la mer lointaine rencontre la voûte.
  fog.color.copy(sky.horizon);
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
  const portee = grota.inReach(hero.position) && !hero.swimming;
  // S'éloigner referme la conversation : rester à l'écoute d'un panda qu'on ne voit plus n'aurait
  // aucun sens, et ça évite un bandeau orphelin à l'écran.
  if (dialog.open && (!portee || cancel)) dialog.close();
  else if (action) {
    if (dialog.open) dialog.advance();
    else if (portee) dialog.start("Grota", GROTA_DIT, "/ui/grota.png");
  }
  // Une seule invite pour toute la scène : le panda et le coffre s'y partagent la même pastille.
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

function updateCamera(
  dt: number,
  cmd: InputSample,
  move: { x: number; z: number },
  t: number,
): void {
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
  fog.far = mood.value.fog.far * k ** CAMERA.fogFar;
  // Reculer doit renforcer l'effet maquette, pas l'aplatir.
  pipeline.setTiltShiftZoom(k);
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
  parler(cmd.action, cmd.cancel);
  dialog.update(dt);
  water.update(dt);
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
  debugView.update(hero);
  chest.update(hero.position);
  interior.update(dt, elapsed);
  sakura?.petales.update(dt);
  sky.update(dt, camera);
  updateCamera(dt, cmd, move, elapsed);
  // L'ambiance se fond : tant qu'elle bouge, il faut la repousser partout.
  if (mood.update(dt)) pushMood();

  // Jauge de souffle : visible seulement quand le héros est dans l'eau.
  if (breathEl) breathEl.style.display = hero.swimming ? "block" : "none";
  if (hero.swimming && breathBarEl) breathBarEl.style.width = `${Math.max(0, hero.breath) * 100}%`;

  // Le foyer s'entend d'autant plus qu'on en est près.
  setFireDistance(hero.position.distanceTo(props.firePosition));

  props.fireLight.intensity = mood.value.fire * ((props.fireLight.userData.flicker as number) ?? 1);
  // Appoint sur les sprites : un plan face caméra ne peut rien recevoir d'une source placée
  // derrière lui, alors qu'on s'attend à voir le héros éclairé dès qu'il est près du feu. On
  // complète donc exactement ce que la vraie lumière rate, en fonction de la distance et de
  // l'orientation.
  applyFillFromPointLight(
    ctx,
    props.fireLight.position,
    props.fireLight.color,
    props.fireLight.intensity,
  );

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
