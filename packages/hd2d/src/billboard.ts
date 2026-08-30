import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import { applyCloudShadow } from "./clouds.js";
import type { Hd2dContext } from "./context.js";
import { sheetUv } from "./sheet.js";

// Calque réservé au contre-jour : en three, une lumière n'éclaire un objet que si leurs calques se
// croisent. Le liseré est fait pour détacher les sprites du décor — appliqué au décor aussi, il ne
// faisait que le délaver, donc seuls les sprites éclairés s'y inscrivent (voir `makeBillboard`).
export const RIM_LAYER = 1;

/**
 * Greffe la couverture nuageuse sur un matériau (Task 6, `applyCloudShadow`). Par défaut,
 * `makeBillboard`/`makeFlatSprite` branchent la vraie greffe, liée au contexte reçu en paramètre —
 * exposée ici comme paramètre plutôt que câblée en dur pour rester substituable (un test qui veut
 * vérifier la géométrie ou le matériau sans patcher de shader peut passer un no-op).
 * `opts.atOrigin` distingue un sprite vertical (échantillonné à l'origine du monde, pas à sa
 * position) d'un décalque posé à plat (échantillonné dans le plan du sol, sans étirement).
 */
export type CloudShadowGraft = (material: THREE.Material, opts: { atOrigin: boolean }) => void;

export type Facing = "east" | "west" | "north" | "south";

export interface Sprite {
  mesh: THREE.Mesh;
  setFrame(i: number): void;
  setFlip(v: boolean): void;
  dispose(): void;
}

export interface Billboard extends Sprite {
  setFacing(f: Facing): void;
  placeAt(x: number, y: number, z: number): void;
  readonly footOffset: number;
}

export interface CardVolume extends Sprite {
  placeAt(x: number, y: number, z: number): void;
  readonly footOffset: number;
}

export interface Clip {
  row: number;
  frames: number;
  fps: number;
}

export interface Animator {
  play(next: Clip): void;
  update(dt: number): void;
  setPhase(v: number): void;
}

/**
 * `east`/`west` n'existent pas dans le PoC : son unique personnage ne se retourne jamais. Ici
 * l'orientation est une donnée dès S1 — les unités Tiny Swords restent de PROFIL seul (aucune
 * frame de face, aucune de dos), donc `north`/`south` laissent le profil courant inchangé :
 * remettre le sprite d'aplomb serait un saut visible, et il n'y a de toute façon rien d'autre à
 * jouer. Le jour où des feuilles 4-directions arrivent, seul ce corps de fonction change.
 */
export function facingToFlip(facing: Facing, current: boolean): boolean {
  if (facing === "east") return false;
  if (facing === "west") return true;
  return current;
}

/**
 * Hauteur compensée d'un billboard. Une caméra qui plonge écrase un plan vertical d'un facteur
 * cos(pitch) ; on compense en ÉTIRANT le sprite (jamais en le penchant vers la caméra — pencher
 * revient à le coucher en arrière, et son sommet entre alors dans ce qu'il y a derrière : un héros
 * au pied d'une falaise disparaissait dedans). `stretch` va de 0 (aucune compensation) à 1 (totale).
 */
export function billboardHeight({
  height,
  pitch,
  stretch,
}: {
  height: number;
  pitch: number;
  stretch: number;
}): number {
  return height * (1 + (1 / Math.cos(pitch) - 1) * stretch);
}

/**
 * Découpe une feuille de sprites en frames et pilote offset/repeat de la texture. Le flip se fait
 * par un repeat négatif ; les UV restent dans [0,1] donc un wrap ClampToEdge suffit.
 */
export interface TextureUvRect {
  offsetX: number;
  offsetY: number;
  repeatX: number;
  repeatY: number;
}

function bindSheet(
  map: THREE.Texture,
  cols: number,
  rows: number,
  base: TextureUvRect = { offsetX: 0, offsetY: 0, repeatX: 1, repeatY: 1 },
) {
  const uv = sheetUv({ cols, rows });
  let frame = -1;
  let flipped = false;

  function apply() {
    const rect = uv.frame(frame, { flipped });
    map.offset.set(
      base.offsetX + rect.offsetX * base.repeatX,
      base.offsetY + rect.offsetY * base.repeatY,
    );
    map.repeat.set(rect.repeatX * base.repeatX, rect.repeatY * base.repeatY);
  }

  const binding = {
    setFrame(i: number) {
      if (i === frame) return;
      frame = i;
      apply();
    },
    setFlip(v: boolean) {
      if (v === flipped) return;
      flipped = v;
      apply();
    },
    isFlipped: () => flipped,
  };
  binding.setFrame(0);
  return binding;
}

/** Clone la texture (partage la Source : pas de second upload GPU, seuls offset/repeat deviennent
 *  propres au sprite) et cadre son repeat sur une frame de la feuille. */
function cloneSheetMap(texture: THREE.Texture, cols: number, rows: number): THREE.Texture {
  const map = texture.clone();
  map.repeat.set(1 / cols, 1 / rows);
  return map;
}

// 0=HG 1=HD 2=BG 3=BD dans PlaneGeometry (un plan 1x1 segment a exactement ces quatre sommets).
function bombNormals(geo: THREE.PlaneGeometry): void {
  const n = geo.attributes.normal;
  if (!n) throw new Error("PlaneGeometry sans attribut normal");
  const set = (i: number, x: number, y: number, z: number) => {
    const v = new THREE.Vector3(x, y, z).normalize();
    n.setXYZ(i, v.x, v.y, v.z);
  };
  set(0, -0.35, 0.6, 0.8);
  set(1, 0.35, 0.6, 0.8);
  set(2, -0.35, 0.25, 0.9);
  set(3, 0.35, 0.25, 0.9);
  n.needsUpdate = true;
}

function makeLitMaterial(
  map: THREE.Texture,
  graftCloudShadow: CloudShadowGraft,
): THREE.MeshLambertMaterial {
  const material = new THREE.MeshLambertMaterial({
    map,
    // 0.5 : un alphaTest est binaire, il ne restitue pas la semi-transparence, il la force à
    // plein. Plus bas (0.25), l'ombre douce peinte au pied de chaque sprite devenait une tache
    // opaque à bord franc — d'où deux ombres sous le héros, celle-là et le décalque au sol. Le
    // seuil haut la supprime, et c'est le décalque qui pose le personnage.
    alphaTest: 0.5,
    side: THREE.FrontSide,
    // Par défaut three rend les faces ARRIÈRE dans la shadow map (anti-acné). Un quad n'en a pas :
    // sans ça, aucun sprite ne projette d'ombre.
    shadowSide: THREE.DoubleSide,
  });

  // Un sprite qui ne reçoit pas d'ombre traverse celle d'un arbre ou d'un nuage sans jamais
  // s'assombrir : c'est précisément ce qui trahit le décalque plaqué sur une scène 3D, alors que
  // tout le reste est fait pour l'y planter.
  graftCloudShadow(material, { atOrigin: true });

  // L'émissif sert ici d'appoint de lumière (voir le contexte, `fillFromPointLight`), pas de
  // matière qui brille : il doit donc être MODULÉ par la texture. Ajouté tel quel, il déposerait un
  // aplat orange uniforme sur le sprite — un halo, pas une surface éclairée.
  const nuages = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    nuages(shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <emissivemap_fragment>",
      `#include <emissivemap_fragment>
       totalEmissiveRadiance *= diffuseColor.rgb;`,
    );
  };
  // Revue finale (point G1) : ÉCRASER `customProgramCacheKey` ici effaçait la clé que
  // `graftCloudShadow(material, { atOrigin: true })` venait de poser juste au-dessus
  // (`applyCloudShadow`, `clouds.ts`) — puisque `graftCloudShadow` est un point d'injection
  // DOCUMENTÉ (`BillboardOptions.graftCloudShadow`), deux sprites éclairés construits avec des
  // greffes différentes se retrouvaient avec la MÊME clé constante : three réutilisait le
  // programme du premier pour le second, et sa greffe s'évaporait — la panne exacte que
  // `clouds.ts` (`applyCloudShadow`) documente déjà pour le cas général. On COMPOSE les deux clés
  // au lieu d'écraser : `cloudKey` capture ce que la greffe a posé (le neutre par défaut de three
  // si `graftCloudShadow` n'en a posé aucune, par ex. un no-op de test).
  const cloudKey = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = () => `sprite-eclaire:${cloudKey()}`;
  return material;
}

function makeUnlitMaterial(map: THREE.Texture): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    map,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
  });
}

function finishBillboard(
  ctx: Hd2dContext,
  mesh: THREE.Mesh,
  material: THREE.Material,
  map: THREE.Texture,
  cols: number,
  rows: number,
  placement: { footOffset: number; groundY: number | null },
  uvRect?: TextureUvRect,
): Billboard {
  const sheet = bindSheet(map, cols, rows, uvRect);

  return {
    mesh,
    setFrame: sheet.setFrame,
    setFlip: sheet.setFlip,
    setFacing(f) {
      sheet.setFlip(facingToFlip(f, sheet.isFlipped()));
    },
    // Pose le sprite au sol : les pieds tombent pile sur la hauteur donnée.
    placeAt(x, y, z) {
      placement.groundY = y;
      mesh.position.set(x, y - placement.footOffset, z);
    },
    get footOffset() {
      return placement.footOffset;
    },
    dispose() {
      // Sans ce retrait, un billboard disposé reste dans les registres du contexte pour toujours :
      // `setYaw` continuerait de tourner un mesh détruit à chaque rotation de caméra, et un futur
      // lecteur de `litBillboards()` toucherait le `.emissive` d'un matériau déjà libéré.
      ctx.unregisterBillboard(mesh);
      mesh.geometry.dispose();
      material.dispose();
      map.dispose();
    },
  };
}

export interface BillboardOptions {
  texture: THREE.Texture;
  cols?: number;
  rows?: number;
  /** Hauteur monde d'une frame. */
  height: number;
  /** Largeur / hauteur d'une frame, en pixels. */
  aspect?: number;
  /** Hauteur des "pieds" dans la frame, depuis le bas (0..1). */
  foot?: number;
  lit?: boolean;
  stretch?: number;
  /** Plongée de la caméra, pour calculer l'étirement. */
  pitch?: number;
  graftCloudShadow?: CloudShadowGraft;
  /** Optional crop inside the source texture, expressed in normalized bottom-origin UVs. */
  uvRect?: TextureUvRect;
}

/**
 * Un sprite = un plan strictement vertical, pivoté sur ses pieds, étiré pour annuler l'écrasement
 * dû à la plongée de la caméra — jamais penché vers la caméra (voir `billboardHeight`). Les
 * normales sont bombées (gauche/droite/haut) pour que le plan réagisse à la lumière comme un
 * volume au lieu de s'éteindre d'un coup.
 */
export function makeBillboard(ctx: Hd2dContext, opts: BillboardOptions): Billboard {
  const {
    texture,
    cols = 1,
    rows = 1,
    height,
    aspect = 1,
    foot = 0.1,
    lit = true,
    stretch = ctx.config.spriteStretch,
    pitch = ctx.pitch() ?? 0,
    graftCloudShadow = (material, graftOpts) => applyCloudShadow(ctx, material, graftOpts),
    uvRect,
  } = opts;

  const w = height * aspect;
  const initialHeight = billboardHeight({ height, pitch, stretch });
  const geo = new THREE.PlaneGeometry(w, 1);
  geo.translate(0, 0.5, 0); // pivot au bas du plan
  const positions = geo.getAttribute("position");
  const normalizedY = Array.from({ length: positions.count }, (_, index) => positions.getY(index));

  if (lit) bombNormals(geo);

  const map = cloneSheetMap(texture, cols, rows);
  const placement = { footOffset: foot * initialHeight, groundY: null as number | null };
  let drawnHeight = initialHeight;
  let mesh: THREE.Mesh;
  const applyPitch = (nextPitch: number): void => {
    drawnHeight = billboardHeight({ height, pitch: nextPitch, stretch });
    for (let index = 0; index < positions.count; index += 1) {
      positions.setY(index, (normalizedY[index] ?? 0) * drawnHeight);
    }
    positions.needsUpdate = true;
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    placement.footOffset = foot * drawnHeight;
    if (placement.groundY !== null) mesh.position.y = placement.groundY - placement.footOffset;
  };
  applyPitch(pitch);

  if (lit) {
    const material = makeLitMaterial(map, graftCloudShadow);
    mesh = new THREE.Mesh(geo, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.layers.enable(RIM_LAYER);
    ctx.registerBillboard(mesh, {
      lit: true,
      material,
      mid: () => drawnHeight * 0.5,
      onPitch: applyPitch,
    });
    return finishBillboard(ctx, mesh, material, map, cols, rows, placement, uvRect);
  }

  const material = makeUnlitMaterial(map);
  mesh = new THREE.Mesh(geo, material);
  ctx.registerBillboard(mesh, { lit: false, onPitch: applyPitch });
  return finishBillboard(ctx, mesh, material, map, cols, rows, placement, uvRect);
}

export interface FlatSpriteOptions {
  texture: THREE.Texture;
  cols?: number;
  rows?: number;
  size: number;
  aspect?: number;
  opacity?: number;
  alphaTest?: number;
  graftCloudShadow?: CloudShadowGraft;
}

/**
 * Quad horizontal posé à plat, pour ce qui se dessine SUR une surface plutôt que debout dedans :
 * l'écume du rivage, et tout décalque de sol à venir. Ni pieds ni orientation : il n'entre donc pas
 * dans le registre de billboards du contexte, qui ne concerne que ce qui pivote avec la caméra —
 * `ctx` sert uniquement à lier la greffe de nuages par défaut à SES uniformes.
 */
export function makeFlatSprite(ctx: Hd2dContext, opts: FlatSpriteOptions): Sprite {
  const {
    texture,
    cols = 1,
    rows = 1,
    size,
    aspect = 1,
    opacity = 1,
    alphaTest = 0,
    graftCloudShadow = (material, graftOpts) => applyCloudShadow(ctx, material, graftOpts),
  } = opts;

  const geo = new THREE.PlaneGeometry(size, size * aspect);
  geo.rotateX(-Math.PI / 2);

  const map = cloneSheetMap(texture, cols, rows);

  // En découpe (alphaTest) plutôt qu'en fondu : des quads coplanaires qui se chevauchent en
  // semi-transparence cumuleraient leur opacité et feraient des taches claires à chaque
  // recouvrement.
  const cutout = alphaTest > 0;
  // Éclairé, pas "basic" : un décalque non éclairé garderait sa luminosité de plein jour la nuit
  // venue et se mettrait à briller sous le bloom.
  const material = new THREE.MeshLambertMaterial({
    map,
    alphaTest,
    transparent: !cutout,
    opacity,
    depthWrite: cutout,
    side: THREE.FrontSide,
  });
  // Posé à plat, donc échantillonné par fragment : la carte de nuages se lit dans le plan du sol,
  // sans étirement.
  graftCloudShadow(material, { atOrigin: false });

  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = true;

  const sheet = bindSheet(map, cols, rows);
  return {
    mesh,
    setFrame: sheet.setFrame,
    setFlip: sheet.setFlip,
    dispose() {
      mesh.geometry.dispose();
      material.dispose();
      map.dispose();
    },
  };
}

export interface CardVolumeOptions {
  texture: THREE.Texture;
  cols?: number;
  rows?: number;
  height: number;
  aspect?: number;
  foot?: number;
  mode: "cloud" | "vertical" | "wall";
  graftCloudShadow?: CloudShadowGraft;
}

/**
 * Plusieurs cartes FIXES fusionnées en un seul mesh : le décor garde le pixel art officiel mais
 * ne dépend plus du yaw des billboards. Le croisement vertical évite la tranche de papier à 90° ;
 * le nuage ajoute un dessus horizontal et une épaisseur courte, visible pendant tout l’orbite.
 */
export function makeCardVolume(ctx: Hd2dContext, opts: CardVolumeOptions): CardVolume {
  const {
    texture,
    cols = 1,
    rows = 1,
    height,
    aspect = 1,
    foot = 0,
    mode,
    graftCloudShadow = (material, graftOpts) => applyCloudShadow(ctx, material, graftOpts),
  } = opts;
  const width = height * aspect;
  const parts: THREE.BufferGeometry[] = [];

  if (mode === "cloud") {
    const thickness = Math.max(0.18, Math.min(width, height) * 0.32);
    const top = new THREE.PlaneGeometry(width, height);
    top.rotateX(-Math.PI / 2);
    top.translate(0, thickness / 2, 0);
    parts.push(top);

    const front = new THREE.PlaneGeometry(width, thickness);
    parts.push(front);
    const side = new THREE.PlaneGeometry(height, thickness);
    side.rotateY(Math.PI / 2);
    parts.push(side);
  } else if (mode === "vertical") {
    const front = new THREE.PlaneGeometry(width, height);
    front.translate(0, height / 2, 0);
    parts.push(front);
    const side = new THREE.PlaneGeometry(Math.min(width, height * 0.58), height);
    side.rotateY(Math.PI / 2);
    side.translate(0, height / 2, 0);
    parts.push(side);
  } else {
    // Une porte ou une tapisserie appartient au mur : une seule carte orientée garde sa face dans
    // le plan du mur, alors que le croisement des volumes libres inventerait une seconde porte à 90°.
    const front = new THREE.PlaneGeometry(width, height);
    front.translate(0, height / 2, 0);
    parts.push(front);
  }

  const geometry = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (!geometry) throw new Error("Fusion impossible pour le volume de cartes");

  const map = cloneSheetMap(texture, cols, rows);
  const material = new THREE.MeshLambertMaterial({
    map,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
    shadowSide: THREE.DoubleSide,
  });
  graftCloudShadow(material, { atOrigin: mode !== "cloud" });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = mode === "vertical";
  mesh.receiveShadow = true;
  const sheet = bindSheet(map, cols, rows);
  const footOffset = foot * height;

  return {
    mesh,
    setFrame: sheet.setFrame,
    setFlip: sheet.setFlip,
    placeAt(x, y, z) {
      mesh.position.set(x, y - footOffset, z);
    },
    footOffset,
    dispose() {
      geometry.dispose();
      material.dispose();
      map.dispose();
    },
  };
}

// --- ombre de contact, halos, ondes -----------------------------------------
// Ces textures sont des caches de MODULE, pas de contexte : ce sont des images immuables,
// identiques pour toute la page, sans état de scène (contrairement au yaw et aux registres de
// billboards, qui sont propres à chaque contexte). Les dupliquer par contexte gâcherait de la
// mémoire GPU pour rien. Elles restent en revanche PARESSEUSES — construites à la première demande,
// jamais à l'import — car elles appellent `document.createElement("canvas")`, qui casse le projet
// vitest `node` si on l'atteint au chargement du module.

function canvas2d(size: number): { canvas: HTMLCanvasElement; cx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const cx = canvas.getContext("2d");
  if (!cx) throw new Error("Contexte 2D indisponible");
  return { canvas, cx };
}

/**
 * Ombre de contact : une tache noire posée à plat sous un personnage. Indispensable depuis que les
 * sprites sont verticaux — l'ombre peinte dans la feuille se retrouve elle aussi à la verticale,
 * écrasée derrière les pieds, et ne pose plus le personnage au sol.
 */
let discTexture: THREE.CanvasTexture | undefined;
function radialDisc(): THREE.CanvasTexture {
  if (discTexture) return discTexture;
  const S = 128;
  const { canvas, cx } = canvas2d(S);
  const g = cx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, "rgba(8,26,38,0.6)");
  g.addColorStop(0.6, "rgba(8,26,38,0.34)");
  g.addColorStop(1, "rgba(8,26,38,0)");
  cx.fillStyle = g;
  cx.fillRect(0, 0, S, S);
  discTexture = new THREE.CanvasTexture(canvas);
  discTexture.colorSpace = THREE.SRGBColorSpace;
  return discTexture;
}

/**
 * Tache de lumière diffuse, en blanc : elle se teinte par la couleur du matériau et se mélange en
 * additif.
 *
 * Un `createRadialGradient` ne pouvait donner qu'un disque — bord parfaitement circulaire, centre
 * franc — et c'est ce qui faisait lire la lumière du foyer comme « un gros rond » posé sur l'herbe.
 * Deux choses le corrigent, et il faut les deux :
 *
 * - une longue traîne : l'alpha décroît en puissance ~3, donc il n'y a plus de rayon où la tache
 *   « s'arrête ». Un dégradé linéaire, lui, a une pente constante que l'oeil lit comme un contour ;
 * - un rayon qui ondule avec l'angle, sur trois harmoniques. Le contour n'est plus un cercle mais
 *   une flaque, et deux couches de phases différentes ne se superposent jamais en un bord net.
 */
const glowCache = new Map<number, THREE.CanvasTexture>();
function diffuseGlow(seed = 0): THREE.CanvasTexture {
  const cached = glowCache.get(seed);
  if (cached) return cached;
  const S = 160;
  const { canvas, cx } = canvas2d(S);
  const img = cx.createImageData(S, S);
  const d = img.data;
  const p1 = seed * 1.7;
  const p2 = seed * 3.1 + 2.2;
  const p3 = seed * 5.3 + 4.7;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (x + 0.5) / S - 0.5;
      const dy = (y + 0.5) / S - 0.5;
      const a = Math.atan2(dy, dx);
      // Le rayon respire avec l'angle : trois harmoniques suffisent à casser le cercle sans que la
      // forme devienne une étoile.
      const wob =
        1 + 0.2 * Math.sin(a * 3 + p1) + 0.13 * Math.sin(a * 5 + p2) + 0.07 * Math.sin(a * 7 + p3);
      const r = (Math.hypot(dx, dy) * 2) / wob;
      const k = r >= 1 ? 0 : (1 - r) ** 3;
      const i = (y * S + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = 255;
      d[i + 3] = Math.round(k * 255);
    }
  }
  cx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  glowCache.set(seed, tex);
  return tex;
}

/**
 * Halo additif posé À PLAT sur le sol. Le bloom fait déjà rayonner la flamme, mais il ne rayonne que
 * ce qui est peint : sans enveloppe, la lumière du foyer est un sprite lumineux posé sur du noir
 * plutôt qu'une source dans un volume d'air.
 *
 * À la verticale, en billboard, ça ne marche pas : le sol coupe le quad net à mi-hauteur, en plein
 * dans le coeur du dégradé, et le halo se termine par un trait horizontal parfaitement droit. À
 * plat, il n'y a rien à couper — et une flaque de lumière au sol est de toute façon ce qu'un feu de
 * camp produit.
 */
export function makeGlow(size: number, color: THREE.ColorRepresentation, seed = 0): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(size, size);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({
      map: diffuseGlow(seed),
      color: new THREE.Color(color),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    }),
  );
  mesh.renderOrder = 3;
  // Chaque couche est tournée différemment : deux exemplaires de la même tache superposés se
  // reconnaîtraient tout de suite.
  mesh.rotation.y = seed * 1.9;
  return mesh;
}

// Anneau clair : la crête d'une onde qui s'écarte.
let rippleTexture: THREE.CanvasTexture | undefined;
function ringTexture(): THREE.CanvasTexture {
  if (rippleTexture) return rippleTexture;
  const S = 128;
  const { canvas, cx } = canvas2d(S);
  const g = cx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  // Bande large plutôt que trait fin : un anneau net se lit comme un cercle dessiné, pas comme une
  // crête d'eau.
  g.addColorStop(0, "rgba(255,255,255,0)");
  g.addColorStop(0.52, "rgba(255,255,255,0)");
  g.addColorStop(0.82, "rgba(206,244,255,0.7)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  cx.fillStyle = g;
  cx.fillRect(0, 0, S, S);
  rippleTexture = new THREE.CanvasTexture(canvas);
  return rippleTexture;
}

/**
 * Onde concentrique posée à la surface. Le disque sombre disait où se trouvait le nageur ; il ne
 * disait pas qu'il bougeait — un personnage sous l'eau qui traverse un plan parfaitement lisse ne
 * déplace rien.
 */
export function makeRipple(): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({
      map: ringTexture(),
      transparent: true,
      depthWrite: false,
      fog: false,
    }),
  );
  mesh.renderOrder = 3;
  return mesh;
}

export function makeSurfaceDisc(size: number): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(size, size);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({ map: radialDisc(), transparent: true, depthWrite: false }),
  );
  mesh.renderOrder = 2;
  mesh.visible = false;
  return mesh;
}

/** Petit lecteur d'animation pour une feuille de sprites. */
export function createAnimator(sprite: Billboard, clip: Clip, cols: number): Animator {
  let current = clip;
  // Phase de départ aléatoire : sans ça, deux sprites qui partagent le même clip démarrent
  // strictement synchronisés — un groupe de monstres qui respire à l'unisson trahit immédiatement
  // le sprite cloné.
  let t = Math.random() * 10;

  return {
    play(next) {
      // Revue finale (point G2) : `fps` manquait à cette comparaison — deux clips de même ligne et
      // même longueur mais de vitesses différentes ne changeaient jamais de cadence, le second
      // `play()` étant pris pour une redemande du même clip. Inatteignable avec le contenu actuel
      // (aucun couple de clips du labo ne partage `row`/`frames` avec un `fps` différent), mais
      // systématique dès que S3/S5 ajoutent des variantes de vitesse sur un même feuillet.
      if (next.row === current.row && next.frames === current.frames && next.fps === current.fps)
        return;
      current = next;
      t = 0;
    },
    update(dt) {
      t += dt * current.fps;
      sprite.setFrame(current.row * cols + (Math.floor(t) % current.frames));
    },
    setPhase(v) {
      t = v;
    },
  };
}
