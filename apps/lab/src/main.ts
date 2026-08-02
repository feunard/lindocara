import { RIM_LAYER } from "@lindocara/hd2d/billboard.js";
import { createCloudCover } from "@lindocara/hd2d/clouds.js";
import { createHd2dContext } from "@lindocara/hd2d/context.js";
import { fetchAll } from "@lindocara/hd2d/loader.js";
import { createMoodMixer } from "@lindocara/hd2d/mood.js";
import { createPipeline } from "@lindocara/hd2d/pipeline.js";
import { createSky } from "@lindocara/hd2d/sky.js";
import type { TerrainAtlas } from "@lindocara/hd2d/terrain/atlas.js";
import { createFoam, FOAM_SPREAD } from "@lindocara/hd2d/terrain/foam.js";
import { meshTerrain } from "@lindocara/hd2d/terrain/mesh.js";
import { createWater } from "@lindocara/hd2d/terrain/water.js";
import { createTextureRegistry } from "@lindocara/hd2d/textures.js";
import * as THREE from "three";
import type { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { createInput, type InputSample } from "./core/input.js";
import {
  CAMERA,
  MOOD_FADE,
  MOODS,
  SUN_DRIFT,
  TARGET_FPS,
  TEXTURE_URLS,
  WATER,
  WORLD,
} from "./settings.js";
import { createColliders } from "./world/colliders.js";
import { createHero } from "./world/hero.js";
import { generateIsland } from "./world/island.js";

// --- chargement -------------------------------------------------------------------------------
// Tout est chargé AVANT de construire quoi que ce soit : la scène naît complète, et aucun sprite
// ne se clone sur une image encore vide.
//
// Le pourcentage se répartit sur deux temps. Le téléchargement pèse 85 % : il est suivi en
// octets, seule mesure honnête quand un fichier pèse bien plus que les autres réunis. Le
// décodage — images vers textures — prend les 15 derniers (l'audio, Task 12, s'y ajoutera).
const texteChargement = document.getElementById("load-text");
const barreChargement = document.getElementById("load-fill");
let partTelechargee = 0;
let partDecodee = 0;

function avancement(): void {
  const p = Math.round((partTelechargee * 0.85 + partDecodee * 0.15) * 100);
  if (texteChargement) texteChargement.textContent = `CHARGEMENT ${p} %`;
  if (barreChargement) barreChargement.style.width = `${p}%`;
}

const blobs = await fetchAll(
  TEXTURE_URLS.map((t) => t.url),
  (p) => {
    partTelechargee = p;
    avancement();
  },
);

const textures = createTextureRegistry(TEXTURE_URLS);
await textures.decode(blobs, (p) => {
  partDecodee = p;
  avancement();
});

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

// Aucun prop n'existe encore (Task 12) : le héros n'a rien à heurter que le relief.
const colliders = createColliders();

const SPAWN = [-2, 4] as const;
const hero = createHero(ctx, textures, query, colliders, SPAWN);
scene.add(hero.object);
scene.add(hero.effects);

// Couverture nuageuse : dérive et multiplie l'albédo du décor ET des sprites, sans passe d'ombre
// supplémentaire.
const clouds = createCloudCover(ctx);

const sky = createSky(ctx);
scene.add(sky.mesh);

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

// `ShaderPass.uniforms` est typé côté three comme un index signature, donc `noUncheckedIndexedAccess`
// marque chaque accès comme possiblement `undefined` — le même problème que `pipeline.ts` documente
// pour ses propres passes internes, mais sans exposer d'aide typée pour CELLES-CI : `pipeline.grade`
// sort du package en `ShaderPass` nu, donc l'appelant doit reproduire le même cast local pour
// pousser l'ambiance dedans (voir `pushMood`).
interface GradeUniforms {
  uSaturation: { value: number };
  uLift: { value: number };
}
function gradeUniforms(pass: ShaderPass): GradeUniforms {
  return pass.uniforms as unknown as GradeUniforms;
}

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
  const grade = gradeUniforms(pipeline.grade);
  grade.uSaturation.value = m.grade.saturation;
  grade.uLift.value = m.grade.lift;
  // Sous-exposer fait « nuit » bien plus franchement que de baisser chaque lumière une à une —
  // celles-ci ne font que la teinter.
  pipeline.renderer.toneMappingExposure = m.exposure;
  clouds.setStrength(m.clouds);
  water.colors.shallow.copy(m.water.shallow);
  water.colors.deep.copy(m.water.deep);
  water.setSparkle(m.water.sparkle);
  sky.apply(m, sun.position.clone().sub(sun.target.position));
  // Le brouillard prend la couleur d'horizon du ciel : deux teintes voisines mais distinctes
  // dessinaient une ligne franche là où la mer lointaine rencontre la voûte.
  fog.color.copy(sky.horizon);
}

const moodLabel = document.getElementById("mood");
function applyMood(name: "day" | "night"): void {
  mood.goTo(name);
  if (moodLabel) moodLabel.textContent = name === "day" ? "☀︎ jour" : "☾ nuit";
}

const input = createInput(canvas, {
  onToggleMood: () => applyMood(mood.name === "day" ? "night" : "day"),
  onToggleHud: () => {
    document.getElementById("hud")?.classList.toggle("hidden");
  },
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

// Secousse : une réception sans à-coup n'a aucun poids.
let secousse = 0;
const shake = (a: number) => {
  secousse = Math.max(secousse, a);
};

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
  { x: 0, z: 0, zoom: 0, jump: false, attack: false, yaw: 0, orbiting: false },
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
  hero.update(dt, { x: move.x, z: move.z, jump: cmd.jump, attack: cmd.attack });
  const choc = hero.takeImpact();
  if (choc) shake(CAMERA.shake.land * choc);

  water.update(dt);
  foam.update(dt);
  clouds.update(dt);
  sky.update(dt, camera);
  updateCamera(dt, cmd, move, elapsed);
  // L'ambiance se fond : tant qu'elle bouge, il faut la repousser partout.
  if (mood.update(dt)) pushMood();

  // Jauge de souffle : visible seulement quand le héros est dans l'eau.
  if (breathEl) breathEl.style.display = hero.swimming ? "block" : "none";
  if (hero.swimming && breathBarEl) breathBarEl.style.width = `${Math.max(0, hero.breath) * 100}%`;

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
// L'audio arrive à la Task 12 : pour l'instant, JOUER ne fait que lever l'écran de chargement et
// donner le focus au canvas.
const ecran = document.getElementById("loading");
const bouton = document.getElementById("play");
bouton?.classList.add("on");
bouton?.addEventListener("click", () => {
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
  hero,
  sun,
  hemi,
  rim,
  sky,
  clouds,
  mood,
  applyMood,
};
