import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { TexturePass } from "three/addons/postprocessing/TexturePass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import type { Hd2dContext } from "./context.js";
import { GradeShader, TiltShiftShader } from "./shaders.js";

// `ShaderPass.uniforms` est typé côté three comme un index signature (`{ [name: string]:
// { value: any } }`), donc `noUncheckedIndexedAccess` marque chaque accès comme possiblement
// `undefined` — alors que ce sont les uniformes déclarés juste au-dessus, dans ce même fichier.
// Un cast local restaure la forme exacte sans semer des `!` partout.
interface TiltShiftUniforms {
  uResolution: { value: THREE.Vector2 };
  uDirection: { value: THREE.Vector2 };
  uFocusY: { value: number };
  uFocusRange: { value: number };
  uFalloff: { value: number };
  uRadius: { value: number };
}

interface GradeUniforms {
  uResolution: { value: THREE.Vector2 };
  uSaturation: { value: number };
  uContrast: { value: number };
  uLift: { value: number };
  uVignette: { value: number };
}

function tiltShiftUniforms(pass: ShaderPass): TiltShiftUniforms {
  return pass.uniforms as unknown as TiltShiftUniforms;
}

function gradeUniforms(pass: ShaderPass): GradeUniforms {
  return pass.uniforms as unknown as GradeUniforms;
}

/** Réglages de l'étalonnage final (`GradeShader`, `shaders.ts`), poussés par `setGrade`. */
export interface GradeSettings {
  saturation: number;
  contrast: number;
  lift: number;
  vignette: number;
}

export interface Pipeline {
  renderer: THREE.WebGLRenderer;
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  render(): void;
  resize(): void;
  setTiltShiftZoom(k: number): void;
  setFocusY(y: number): void;
  /**
   * Pousse une ambiance dans la passe d'étalonnage. Sort `grade: ShaderPass` du package évitait
   * d'exposer un accesseur typé pour SES uniformes — `noUncheckedIndexedAccess` marque
   * `ShaderPass.uniforms` (un index signature côté three) comme possiblement `undefined`, donc
   * chaque appelant devait reproduire son propre cast local. `apps/lab/src/main.ts` en portait un
   * exemplaire ; S3 et S5 en auraient chacun ajouté un troisième. Ce setter est le seul point
   * d'entrée typé désormais.
   */
  setGrade(settings: GradeSettings): void;
  dispose(): void;
}

/**
 * Rayon du flou tilt-shift à un facteur de zoom `k` donné. Pure et exportée : c'est
 * l'arithmétique qui décide de la signature visuelle, et elle se casse sans rien signaler —
 * d'où le test dédié plutôt qu'une vérification uniquement à l'écran.
 *
 * Plafonnée à zéro par le bas : un rayon négatif ferait un flou à taps inversés, l'image
 * partirait en miroir par bandes.
 */
export function tiltShiftRadius(base: number, zoomBoost: number, k: number): number {
  return Math.max(0, base * (1 + (k - 1) * zoomBoost));
}

export interface PipelineViewportInput {
  clientWidth: number;
  clientHeight: number;
  fallbackWidth: number;
  fallbackHeight: number;
  devicePixelRatio: number;
}

/** Resolve the render size from the canvas, never from the global viewport. The fallback only
 * covers a canvas before layout; an embedded editor canvas must retain its panel dimensions. */
export function pipelineViewport(input: PipelineViewportInput): {
  width: number;
  height: number;
  pixelRatio: number;
} {
  const finitePositive = (value: number): number | null =>
    Number.isFinite(value) && value > 0 ? value : null;
  return {
    width: Math.max(1, Math.round(finitePositive(input.clientWidth) ?? input.fallbackWidth ?? 1)),
    height: Math.max(1, Math.round(finitePositive(input.clientHeight) ?? input.fallbackHeight ?? 1)),
    pixelRatio: Math.min(2, Math.max(1, finitePositive(input.devicePixelRatio) ?? 1)),
  };
}

export function createPipeline(
  canvas: HTMLCanvasElement,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  ctx: Hd2dContext,
): Pipeline {
  const RENDER = ctx.config.render;
  const POSTFX = ctx.config.postfx;

  const measureViewport = () => {
    const view = canvas.ownerDocument.defaultView;
    return pipelineViewport({
      clientWidth: canvas.clientWidth,
      clientHeight: canvas.clientHeight,
      fallbackWidth: view?.innerWidth ?? canvas.width,
      fallbackHeight: view?.innerHeight ?? canvas.height,
      devicePixelRatio: view?.devicePixelRatio ?? 1,
    });
  };

  const renderer = new THREE.WebGLRenderer({ canvas });
  renderer.setPixelRatio(measureViewport().pixelRatio * RENDER.pixelScale);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // PCFSoft est déprécié depuis r18x
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  // En dessous de la pleine résolution, c'est le navigateur qui remonte l'image :
  // sans ça il la lisse, et on perd justement le grain qu'on cherchait.
  //
  // Le canvas appartient à l'APPELANT, pas au pipeline : sa valeur d'origine est donc mémorisée
  // pour être rendue telle quelle au `dispose()`. Sans ça, un canvas partagé (celui du jeu, celui
  // d'un futur éditeur) garde un `pixelated` que plus personne n'a demandé une fois la scène HD-2D
  // démontée.
  const imageRenderingAvant = canvas.style.imageRendering;
  canvas.style.imageRendering = RENDER.pixelScale < 1 ? "pixelated" : "auto";

  // L'EffectComposer fabrique ses cibles internes sans multiéchantillonnage, et
  // le `antialias` du renderer ne concerne que le framebuffer par défaut — où
  // l'on ne dessine qu'un quad plein écran. Résultat : rien n'était lissé, et
  // toutes les arêtes de géométrie (silhouettes de falaise, ligne de rivage)
  // étaient en escalier.
  //
  // Le réflexe — donner une cible MSAA au composer — coûte très cher : il la
  // clone pour son ping-pong, et CHAQUE passe plein écran (bloom, les deux
  // flous, l'étalonnage) se met alors à écrire 4 échantillons par pixel pour
  // rien. Mesuré à +5 ms la frame. Le multiéchantillonnage n'a de sens que là
  // où il y a de la géométrie : on rend donc la scène dans SA cible MSAA, et
  // toute la chaîne d'après travaille sur des cibles simples.
  const sceneTarget = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    samples: RENDER.msaa,
  });
  const composer = new EffectComposer(renderer);
  // Lire `sceneTarget.texture` suffit : three résout le multiéchantillonnage.
  const source = new TexturePass(sceneTarget.texture);
  source.clear = true;
  composer.addPass(source);

  const bloom = new UnrealBloomPass(
    new THREE.Vector2(1, 1),
    POSTFX.bloom.strength,
    POSTFX.bloom.radius,
    POSTFX.bloom.threshold,
  );
  composer.addPass(bloom);

  // Le flou séparable coûte deux passes, mais un flou 2D en une passe serait
  // en O(n²) de taps pour le même rayon. Il travaille en linéaire, avant le
  // tone mapping : c'est là qu'un flou est physiquement juste.
  const blurH = new ShaderPass(TiltShiftShader);
  const blurV = new ShaderPass(TiltShiftShader);
  tiltShiftUniforms(blurV).uDirection.value = new THREE.Vector2(0, 1);
  for (const p of [blurH, blurV]) {
    const u = tiltShiftUniforms(p);
    u.uRadius.value = POSTFX.tiltShift.radius;
    u.uFocusY.value = POSTFX.tiltShift.focusY;
    u.uFocusRange.value = POSTFX.tiltShift.focusRange;
    u.uFalloff.value = POSTFX.tiltShift.falloff;
    composer.addPass(p);
  }

  // OutputPass applique ACES et l'encodage sRGB : tant qu'on est avant lui, on
  // manipule des valeurs LINÉAIRES et non bornées.
  const outputPass = new OutputPass();
  composer.addPass(outputPass);

  // ...donc l'étalonnage vient APRÈS. Il pivotait son contraste autour de 0.5,
  // ce qui en linéaire correspond à 0.73 à l'écran : le « contraste 1.06 »
  // écrasait les ombres bien plus qu'il n'ouvrait les hautes lumières, et le
  // lift de la nuit délavait les noirs sans commune mesure avec sa valeur.
  // Ici, 0.5 veut enfin dire le gris moyen qu'on voit.
  const grade = new ShaderPass(GradeShader);
  const gradeU = gradeUniforms(grade);
  gradeU.uVignette.value = POSTFX.grade.vignette;
  gradeU.uSaturation.value = POSTFX.grade.saturation;
  gradeU.uContrast.value = POSTFX.grade.contrast;
  gradeU.uLift.value = POSTFX.grade.lift;
  composer.addPass(grade);

  // Amorti vers la cible : évite le saut visible d'un focus qui changerait d'un coup
  // (ex. une nouvelle scène qui n'a pas encore convergé).
  let focusYCourant = POSTFX.tiltShift.focusY;

  function resize() {
    const viewport = measureViewport();
    const w = viewport.width;
    const h = viewport.height;
    renderer.setPixelRatio(viewport.pixelRatio * RENDER.pixelScale);
    // `false` preserves the caller-owned CSS dimensions. The editor embeds this canvas in a
    // resizable panel; writing an inline viewport-sized width here would make it escape that pane.
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    const dpr = renderer.getPixelRatio();
    sceneTarget.setSize(w * dpr, h * dpr);
    // Le bloom est par nature basse fréquence : le calculer en demi-résolution
    // ne se voit pas et rend la moitié de son coût.
    bloom.setSize(w * 0.5, h * 0.5);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    for (const p of [blurH, blurV]) tiltShiftUniforms(p).uResolution.value.set(w * dpr, h * dpr);
    gradeU.uResolution.value.set(w * dpr, h * dpr);
  }
  resize();
  const ResizeObserverCtor = canvas.ownerDocument.defaultView?.ResizeObserver;
  const resizeObserver = ResizeObserverCtor ? new ResizeObserverCtor(resize) : null;
  resizeObserver?.observe(canvas);

  /** La scène va dans sa cible MSAA ; le composer enchaîne à partir de là. */
  function render() {
    renderer.setRenderTarget(sceneTarget);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    composer.render();
  }

  /** Rayon du flou : plus la caméra recule, plus la maquette doit se lire. */
  function setTiltShiftZoom(k: number) {
    const r = tiltShiftRadius(POSTFX.tiltShift.radius, POSTFX.tiltShift.zoomBoost, k);
    for (const p of [blurH, blurV]) tiltShiftUniforms(p).uRadius.value = r;
  }

  /**
   * Le PoC laissait `main.js` fouiller `composer.passes` à chaque frame en cherchant un
   * uniforme `uFocusY` — le pipeline tient déjà ses deux passes de flou, il n'y a aucune
   * raison que l'appelant les redécouvre par introspection.
   */
  function setFocusY(y: number) {
    focusYCourant += (y - focusYCourant) * 0.08;
    for (const p of [blurH, blurV]) tiltShiftUniforms(p).uFocusY.value = focusYCourant;
  }

  function setGrade(settings: GradeSettings) {
    gradeU.uSaturation.value = settings.saturation;
    gradeU.uContrast.value = settings.contrast;
    gradeU.uLift.value = settings.lift;
    gradeU.uVignette.value = settings.vignette;
  }

  // `EffectComposer.dispose()` ne libère QUE `renderTarget1`/`renderTarget2`/`copyPass` — il ne
  // cascade pas vers les passes ajoutées par `addPass`. Or `bloom` possède sa propre chaîne de
  // mips (N niveaux × 2 cibles), et chaque `ShaderPass`/`TexturePass` possède son matériau et son
  // `FullScreenQuad`. Sans ce disposal explicite, chaque démontage/reconstruction du pipeline
  // (l'éditeur qui change de carte) fuit toute la chaîne de mips du bloom et les matériaux de
  // shaders — silencieusement, rien ne le signale à l'écran avant que la mémoire GPU s'épuise.
  // `outputPass` suivait ce même sort avant la revue finale : ajouté en ligne, sans variable
  // locale, il restait le seul des six à ne jamais être disposé.
  //
  // Le `image-rendering` est en revanche RENDU tel qu'il a été trouvé : le canvas appartient à
  // l'appelant, et un canvas partagé (le `#stage` du jeu) garderait sinon un `pixelated` que plus
  // personne n'a demandé.
  //
  // Ce qui n'est PAS rendu, et ne peut pas l'être : le contexte WebGL. `renderer.dispose()` libère
  // les ressources de three, jamais le contexte lui-même, qui reste attaché au canvas jusqu'à la
  // fin de la page. `renderer.forceContextLoss()` NE RÉPARE PAS ça — mesuré, pas supposé : il perd
  // le contexte via `WEBGL_lose_context` sans le détacher, si bien qu'un `canvas.getContext()`
  // ultérieur rend ce même contexte, PERDU. Essayé sur le `#stage` du jeu (S3, task 6) : PixiJS
  // s'initialisait alors sur un contexte mort et la page se figeait — plus un seul `eval` ne
  // répondait. Sans cet appel, le moteur suivant hérite d'un contexte VIVANT et fonctionne (à ses
  // attributs près : celui-ci n'a pas de stencil buffer). Ne pas le rajouter.
  function dispose() {
    resizeObserver?.disconnect();
    source.dispose();
    bloom.dispose();
    blurH.dispose();
    blurV.dispose();
    outputPass.dispose();
    grade.dispose();
    composer.dispose();
    sceneTarget.dispose();
    renderer.dispose();
    canvas.style.imageRendering = imageRenderingAvant;
  }

  return {
    renderer,
    composer,
    bloom,
    render,
    resize,
    setTiltShiftZoom,
    setFocusY,
    setGrade,
    dispose,
  };
}
