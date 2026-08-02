# S1 — `@lindocara/hd2d` + `apps/lab` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extraire le PoC HD-2D (`~/git/poc-hd-2d`) en un package `@lindocara/hd2d` pur Three.js, en TypeScript, sans état de module, et le prouver dans `apps/lab` qui reproduit le PoC à l'identique — plus un harnais de charge qui mesure les fps au niveau de peuplement du vrai jeu.

**Architecture:** `@lindocara/hd2d` ne connaît ni lindocara ni son protocole : il reçoit une description de terrain, des billboards, des lumières, une ambiance, une caméra. `apps/lab` ne dépend que de `hd2d` (et de `engine` à partir de S2) — pas de React, pas de serveur, pas de réseau. Le PoC est un **port**, pas une réécriture : son code est connu-bon et documenté ; les tests écrits ici épinglent le comportement qu'on préserve.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), Three.js ^0.185, Vite 8, Vitest 4 (projet **node**), Biome.

**Source de vérité du port :** `~/git/poc-hd-2d`. Son `README.md` (33 ko) explique *ce qui fait le style* et recense une quinzaine de pièges déjà rencontrés ; son `CLAUDE.md` donne la méthode de mesure GPU. **Les lire avant la Task 1.**

**Comment lire les étapes de port.** Ce plan écrit le code en entier pour tout ce qui est **nouveau** (le contexte, les fonctions pures extraites, tous les tests). Pour ce qui est **porté**, il nomme le fichier source exact, énumère les changements à appliquer un par un, et liste les décisions à ne pas défaire — mais il ne recopie pas les 4 800 lignes du PoC. Les recopier ici en ferait une seconde source de vérité qui divergerait dès la première correction ; le fichier d'origine est meilleur que sa transcription. Une étape « porter X » se lit donc : ouvrir `~/git/poc-hd-2d/src/X`, appliquer les changements listés, traduire en TypeScript strict, garder les commentaires en français.

## Global Constraints

- **60 fps, contrainte dure.** Toute modification du rendu se vérifie au compteur. Mesure précise par `readPixels` forçant la synchro GPU (méthode dans `~/git/poc-hd-2d/CLAUDE.md`).
- **`@lindocara/hd2d` n'importe rien du dépôt.** Ni `@lindocara/engine`, ni `client`, ni `server`. Seule dépendance : `three`.
- **Aucun état mutable au niveau module** dans `hd2d`. Tout ce que le PoC gardait en global (`billboards`, `eclaires`, `currentYaw`, les uniformes de nuages, le cache de textures, `discTexture`, `glowCache`, `rippleTexture`) appartient à un contexte explicite. C'est la règle que ce dépôt applique déjà aux systèmes de room, pour la même raison.
- **Commentaires en français dans `hd2d` et `lab`**, portés verbatim depuis le PoC. Convention locale au package, documentée dans son `AGENTS.md`. Le reste du dépôt reste en anglais. Les commentaires disent POURQUOI : ce qui a été essayé et n'a pas marché, la mesure qui a tranché, le piège qui attend le prochain.
- **Biome** : point-virgules, guillemets doubles. `npm run lint:fix` après chaque port de fichier — le PoC est écrit sans point-virgules.
- **Le projet vitest de `hd2d` est `node`**, pas jsdom : Three.js construit géométries et matériaux hors navigateur. Ce qui touche `document.createElement("canvas")` (couverture nuageuse, halos, disques) n'est **pas** testé unitairement — il est vérifié en capture. Ces générateurs doivent donc rester **paresseux**, jamais appelés au chargement du module.
- **`@lindocara/renderer`, `client`, `editor`, `server` ne sont pas touchés par S1.** Le jeu tourne encore sur PixiJS à la fin de ce plan.

---

## Structure de fichiers

### Le package

```
packages/hd2d/
  package.json            deps: three ^0.185.1 — rien d'autre
  tsconfig.json           extends ../../tsconfig.json, lib DOM
  vitest.config.ts        name "hd2d", environment "node"
  AGENTS.md               la frontière du package + la convention de commentaires
  src/
    config.ts             DEFAULT_RENDER, DEFAULT_POSTFX, DEFAULT_CLOUD_SHADOW, SPRITE_STRETCH
    loader.ts             fetchAll — téléchargement pesé en octets
    context.ts            createHd2dContext — le porteur de l'état autrefois global
    textures.ts           createTextureRegistry — blobs → THREE.Texture, politique de filtrage
    pipeline.ts           createPipeline — cible MSAA, bloom, tilt-shift, output, étalonnage
    shaders.ts            TiltShiftShader, GradeShader, SkyShader
    sheet.ts              sheetUv — math pure frame → (offset, repeat)
    billboard.ts          makeBillboard, makeFlatSprite, makeGlow, makeSurfaceDisc, makeRipple, createAnimator
    fill-light.ts         fillAmount (pur) + applyFillFromPointLight (contexte)
    clouds.ts             createCloudCover, applyCloudShadow
    mood.ts               createMoodMixer
    sky.ts                createSky
    particles.ts          createParticleField, createPetalFall
    terrain/
      field.ts            HeightField + openEdge, autotileAxis, cornerOcclusion, wallDrop
      atlas.ts            TerrainAtlas, tileUV — UV rentrées d'un demi-texel
      mesh.ts             meshTerrain — dessus, parois, occlusion de contact
      water.ts            createWater — mer à profondeur, quatre houles
      foam.ts             foamPlacements — l'écume sous les cases de terre
  test/
    loader.test.ts
    context.test.ts
    sheet.test.ts
    billboard-geometry.test.ts
    fill-light.test.ts
    mood.test.ts
    terrain-field.test.ts
    terrain-mesh.test.ts
    foam.test.ts
```

### Le labo

```
apps/lab/
  package.json            deps: @lindocara/hd2d, three ; devDeps: vite
  tsconfig.json
  vite.config.ts
  index.html              écran de chargement, bouton JOUER, HUD, jauge de souffle, bandeau
  AGENTS.md
  scripts/sync-assets.sh  lit packages/catalog/assets — plus de copie de packs
  public/                 tex/ sfx/ ui/ voice/ — 4,8 Mo, 94 fichiers, commités
  src/
    main.ts               l'assemblage et la boucle
    settings.ts           CAMERA, HERO, GROTA, WORLD, MOODS, WATER, SUN_DRIFT
    world/
      island.ts           génération procédurale de l'île → HeightField
      colliders.ts        grille spatiale de colliders circulaires
      hero.ts             marche, saut, gravité, nage, souffle
      props.ts            arbres, buissons, décor, feu de camp, rochers
      sheep.ts            troupeau
      npc.ts              Grota
      chest.ts  house.ts  interior.ts  debug.ts
    core/
      input.ts  audio.ts  dialog.ts
    bench.ts              le harnais de charge
```

---

### Task 1: Le package, le labo et le loader pesé en octets

**Files:**
- Create: `packages/hd2d/package.json`, `packages/hd2d/tsconfig.json`, `packages/hd2d/vitest.config.ts`, `packages/hd2d/src/loader.ts`
- Create: `apps/lab/package.json`, `apps/lab/tsconfig.json`, `apps/lab/vite.config.ts`, `apps/lab/index.html`, `apps/lab/src/main.ts`
- Modify: `package.json` (scripts `lab`, `typecheck:hd2d`, `typecheck:lab`, `test:hd2d`, et la chaîne `typecheck`)
- Test: `packages/hd2d/test/loader.test.ts`

**Interfaces:**
- Produces: `fetchAll(urls: readonly string[], onProgress: (p: number) => void, options?: { fetch?: typeof globalThis.fetch }): Promise<Map<string, Blob>>`

- [ ] **Step 1: Écrire le test qui échoue**

Le loader est la première brique parce qu'il est pur, testable, et qu'il porte une décision de conception qui se perd facilement : **le pourcentage est pesé en octets, pas en fichiers**. Compter les fichiers ferait filer la barre à 96 % en une fraction de seconde puis la laisserait coincée là.

```ts
// packages/hd2d/test/loader.test.ts
import { describe, expect, it } from "vitest";
import { fetchAll } from "../src/loader.js";

/** Une réponse qui livre son corps en morceaux de tailles données, avec un content-length honnête. */
function stubFetch(chunks: Record<string, number[]>, { withLength = true } = {}) {
  return async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    const sizes = chunks[url] ?? [];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const n of sizes) controller.enqueue(new Uint8Array(n));
        controller.close();
      },
    });
    const total = sizes.reduce((a, b) => a + b, 0);
    return new Response(body, {
      headers: withLength ? { "content-length": String(total) } : {},
    });
  };
}

describe("fetchAll", () => {
  it("pèse le pourcentage en octets et non en morceaux", async () => {
    const seen: number[] = [];
    const blobs = await fetchAll(["/x"], (p) => seen.push(p), {
      fetch: stubFetch({ "/x": [200, 300, 500] }),
    });
    // Trois morceaux inégaux : un compteur de morceaux dirait 1/3, 2/3, 1.
    expect(seen).toEqual([0.2, 0.5, 1, 1]);
    expect(blobs.get("/x")?.size).toBe(1000);
  });

  it("ne recule jamais", async () => {
    const seen: number[] = [];
    await fetchAll(["/a", "/b"], (p) => seen.push(p), {
      fetch: stubFetch({ "/a": [100], "/b": [400, 500] }),
    });
    expect(seen).toEqual([...seen].sort((x, y) => x - y));
    expect(seen.at(-1)).toBe(1);
  });

  it("sans content-length, lit d'un bloc plutôt que de mentir sur le total", async () => {
    const seen: number[] = [];
    const blobs = await fetchAll(["/z"], (p) => seen.push(p), {
      fetch: stubFetch({ "/z": [64] }, { withLength: false }),
    });
    expect(blobs.get("/z")?.size).toBe(64);
    expect(seen).toEqual([1]);
  });
});
```

- [ ] **Step 2: Créer le squelette du package et lancer le test pour le voir échouer**

`packages/hd2d/package.json` :

```json
{
  "name": "@lindocara/hd2d",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    "./*": "./src/*"
  },
  "dependencies": {
    "three": "^0.185.1"
  },
  "devDependencies": {
    "@types/three": "^0.185.0",
    "vitest": "^4.1.10"
  },
  "scripts": {
    "test": "vitest run"
  }
}
```

`packages/hd2d/tsconfig.json` :

```json
{
  // Le moteur de rendu HD-2D. Navigateur (DOM), mais sans React et sans rien du dépôt : sa seule
  // dépendance est three. C'est cette ignorance qui laisse le jeu, l'éditeur et le labo partager
  // le même code de rendu.
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client"]
  },
  "include": ["src", "test"]
}
```

`packages/hd2d/vitest.config.ts` :

```ts
import { defineConfig } from "vitest/config";

// Node, pas jsdom : three construit géométries, matériaux et couleurs hors navigateur, et c'est
// tout ce que ces tests touchent. Ce qui a besoin d'un canvas (couverture nuageuse, halos) ou d'un
// contexte WebGL (pipeline) n'est pas testé ici — il se vérifie en capture.
export default defineConfig({
  test: {
    name: "hd2d",
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
```

Run: `npm install && npx vitest run --project hd2d`
Expected: FAIL — `Failed to resolve import "../src/loader.js"`

- [ ] **Step 3: Porter le loader**

Port de `~/git/poc-hd-2d/src/core/loader.js`, avec une seule différence : `fetch` devient injectable pour que le test n'ait rien à simuler globalement.

```ts
// packages/hd2d/src/loader.ts
/**
 * Téléchargement de tous les assets avec un vrai pourcentage.
 *
 * Le suivi se fait en OCTETS, pas en nombre de fichiers : deux nappes d'ambiance pèsent à elles
 * seules plus que les soixante autres fichiers réunis. Compter les fichiers ferait filer la barre
 * à 96 % en une fraction de seconde, puis la laisserait coincée là pendant tout le reste du
 * chargement — c'est exactement la barre de progression qu'on ne veut pas.
 *
 * Les en-têtes HTTP reviennent bien avant les corps : on connaît donc le total dès le départ, et le
 * pourcentage ne recule jamais.
 */
export interface FetchAllOptions {
  /** Injecté pour les tests. En production c'est le `fetch` du navigateur. */
  fetch?: typeof globalThis.fetch;
}

export async function fetchAll(
  urls: readonly string[],
  onProgress: (fraction: number) => void,
  options: FetchAllOptions = {},
): Promise<Map<string, Blob>> {
  const doFetch = options.fetch ?? globalThis.fetch;
  const reponses = await Promise.all(urls.map((u) => doFetch(u)));
  const total = reponses.reduce(
    (n, r) => n + (Number(r.headers.get("content-length")) || 0),
    0,
  );
  let recus = 0;

  const lire = async (r: Response): Promise<Blob> => {
    // Sans `content-length` (compression à la volée), on ne peut pas pondérer : on lit d'un bloc
    // et le fichier ne compte que pour son arrivée.
    if (!r.body || !total) return r.blob();
    const morceaux: Uint8Array[] = [];
    const lecteur = r.body.getReader();
    for (;;) {
      const { done, value } = await lecteur.read();
      if (done) break;
      morceaux.push(value);
      recus += value.length;
      onProgress(Math.min(1, recus / total));
    }
    return new Blob(morceaux as BlobPart[]);
  };

  const blobs = await Promise.all(reponses.map(lire));
  onProgress(1);
  return new Map(urls.map((u, i) => [u, blobs[i] as Blob]));
}
```

- [ ] **Step 4: Lancer le test pour le voir passer**

Run: `npx vitest run --project hd2d`
Expected: PASS — toute la suite du projet `hd2d`, y compris les tests des tasks précédentes.

- [ ] **Step 5: Amorcer `apps/lab` sur une scène minimale**

`apps/lab/package.json` :

```json
{
  "name": "@lindocara/lab",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "@lindocara/hd2d": "*",
    "three": "^0.185.1"
  },
  "devDependencies": {
    "vite": "^8.1.4"
  }
}
```

`apps/lab/vite.config.ts` :

```ts
import { defineConfig } from "vite";

// Le labo se sert directement des sources du package : pas d'étape de build entre une
// expérimentation et ce qu'on voit à l'écran, c'est tout l'intérêt d'un témoin.
export default defineConfig({
  server: { port: 5174 },
  // Tout ce qui traîne dans public/ part en production : Vite le recopie tel quel.
  publicDir: "public",
});
```

`apps/lab/tsconfig.json` :

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client"]
  },
  "include": ["src", "vite.config.ts"]
}
```

`apps/lab/index.html` — reprendre `~/git/poc-hd-2d/index.html` **tel quel** (écran de chargement, barre, bouton JOUER, HUD, jauge de souffle, bandeau de dialogue, fondu, curseurs). Il est déjà complet et son CSS porte des décisions documentées (le bandeau sans cadre, le curseur en `image-set` 2x, la réserve de 3.3em pour deux lignes).

`apps/lab/src/main.ts` — pour cette task, uniquement de quoi prouver que la chaîne tourne :

```ts
import * as THREE from "three";

const canvas = document.getElementById("view") as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas });
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(22, 1, 0.5, 220);
camera.position.set(0, 6, 12);
camera.lookAt(0, 0, 0);
scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1));
scene.add(new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshLambertMaterial()));

function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
resize();
addEventListener("resize", resize);

function frame() {
  requestAnimationFrame(frame);
  renderer.render(scene, camera);
}
frame();

// Repère pour les scripts de capture.
(window as unknown as { __ready?: boolean }).__ready = true;
```

- [ ] **Step 6: Câbler les scripts racine**

Dans `package.json` à la racine, ajouter :

```json
"lab": "npm run dev -w @lindocara/lab",
"typecheck:hd2d": "tsc -p packages/hd2d/tsconfig.json",
"typecheck:lab": "tsc -p apps/lab/tsconfig.json",
"test:hd2d": "vitest run --project hd2d"
```

et insérer `npm run typecheck:hd2d && npm run typecheck:lab &&` dans la chaîne `typecheck`, juste après `typecheck:engine`.

`apps/lab` est déjà couvert par le glob `apps/*` des workspaces ; `packages/hd2d` par `packages/*`. Le glob du `vitest.config.ts` racine (`packages/*/vitest.config.ts`) prend le projet `hd2d` sans modification.

- [ ] **Step 7: Vérifier**

Run: `npm run typecheck && npx vitest run --project hd2d && npm run lint`
Expected: tout passe.

Run: `npm run lab`, ouvrir http://localhost:5174 — un cube éclairé tourne dans la page, derrière l'écran de chargement du PoC (le bouton JOUER ne fait encore rien).

- [ ] **Step 8: Commit**

```bash
git add packages/hd2d apps/lab package.json package-lock.json
git commit -m "feat(hd2d): amorce le package et le labo, avec le loader pesé en octets"
```

---

### Task 2: Le contexte de scène — la fin des états de module

**Files:**
- Create: `packages/hd2d/src/context.ts`, `packages/hd2d/src/config.ts`
- Test: `packages/hd2d/test/context.test.ts`

**Interfaces:**
- Consumes: rien
- Produces:
  - `createHd2dContext(options?: Hd2dContextOptions): Hd2dContext`
  - `interface Hd2dContext { yaw(): number; setYaw(y: number): void; registerBillboard(mesh: THREE.Mesh, opts: { lit: boolean; mid: number }): void; billboards(): readonly THREE.Mesh[]; litBillboards(): readonly LitBillboard[]; dispose(): void; readonly config: Hd2dConfig }`
  - `interface LitBillboard { mesh: THREE.Mesh; material: THREE.MeshLambertMaterial; mid: number }`
  - `interface Hd2dConfig { render: RenderConfig; postfx: PostFxConfig; cloudShadow: CloudShadowConfig; spriteStretch: number }`
  - `DEFAULT_CONFIG: Hd2dConfig`

Le PoC garde `billboards`, `eclaires` et `currentYaw` en variables de module. C'est correct pour une page qui n'a qu'une scène, et faux pour un package que le jeu **et** l'éditeur instancieront côte à côte : deux stages ouverts partageraient un seul yaw et se repeindraient l'un l'autre. Ce dépôt applique déjà exactement cette règle à ses systèmes de room — « pas d'état mutable de module, les dépendances se passent en argument ».

- [ ] **Step 1: Écrire le test qui échoue**

```ts
// packages/hd2d/test/context.test.ts
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createHd2dContext } from "../src/context.js";

function fakeSprite(): { mesh: THREE.Mesh; material: THREE.MeshLambertMaterial } {
  const material = new THREE.MeshLambertMaterial();
  return { mesh: new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material), material };
}

describe("createHd2dContext", () => {
  it("garde deux contextes parfaitement indépendants", () => {
    const a = createHd2dContext();
    const b = createHd2dContext();
    const sa = fakeSprite();
    const sb = fakeSprite();
    a.registerBillboard(sa.mesh, { lit: true, mid: 1 });
    b.registerBillboard(sb.mesh, { lit: true, mid: 1 });

    a.setYaw(0.4);

    expect(sa.mesh.rotation.y).toBeCloseTo(0.4);
    expect(sb.mesh.rotation.y).toBe(0);
    expect(b.yaw()).toBe(0);
  });

  it("n'inscrit dans les éclairés que les billboards éclairés", () => {
    const ctx = createHd2dContext();
    const lit = fakeSprite();
    const flat = fakeSprite();
    ctx.registerBillboard(lit.mesh, { lit: true, mid: 1.3 });
    ctx.registerBillboard(flat.mesh, { lit: false, mid: 0 });

    expect(ctx.billboards()).toHaveLength(2);
    expect(ctx.litBillboards()).toHaveLength(1);
    expect(ctx.litBillboards()[0]?.mid).toBe(1.3);
  });

  it("adopte le yaw courant à l'inscription, pour qu'un sprite né en cours de rotation ne soit pas de travers", () => {
    const ctx = createHd2dContext();
    ctx.setYaw(-0.25);
    const late = fakeSprite();
    ctx.registerBillboard(late.mesh, { lit: true, mid: 1 });
    expect(late.mesh.rotation.y).toBeCloseTo(-0.25);
  });

  it("laisse surcharger la configuration sans muter les valeurs par défaut", () => {
    const ctx = createHd2dContext({ config: { spriteStretch: 0.5 } });
    const autre = createHd2dContext();
    expect(ctx.config.spriteStretch).toBe(0.5);
    expect(autre.config.spriteStretch).toBe(0.85);
    // Les blocs non surchargés gardent leurs valeurs.
    expect(ctx.config.postfx.bloom.strength).toBe(0.42);
  });

  it("ne partage aucun sous-objet de config entre contextes, même non surchargé", () => {
    // Un merge superficiel laisserait `postfx.bloom` être LE MÊME objet partout. Le pipeline
    // écrit `bloom.strength` à chaque changement d'ambiance : la première nuit corromprait
    // l'autre scène et tous les contextes créés ensuite, définitivement.
    const a = createHd2dContext();
    a.config.postfx.bloom.strength = 999;

    const neuf = createHd2dContext();
    expect(neuf.config.postfx.bloom.strength).toBe(0.42);
    expect(DEFAULT_CONFIG.postfx.bloom.strength).toBe(0.42);
    // `drift` est un tuple readonly : on ne peut pas l'écrire pour le prouver, mais partager sa
    // référence serait le même défaut. On compare donc les identités.
    expect(neuf.config.cloudShadow.drift).not.toBe(a.config.cloudShadow.drift);
    expect(neuf.config.postfx.bloom).not.toBe(DEFAULT_CONFIG.postfx.bloom);
  });

  it("vide ses registres au dispose", () => {
    const ctx = createHd2dContext();
    ctx.registerBillboard(fakeSprite().mesh, { lit: true, mid: 1 });
    ctx.dispose();
    expect(ctx.billboards()).toHaveLength(0);
    expect(ctx.litBillboards()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Lancer le test pour le voir échouer**

Run: `npx vitest run --project hd2d test/context.test.ts`
Expected: FAIL — `Failed to resolve import "../src/context.js"`

- [ ] **Step 3: Écrire `config.ts`**

Port de `~/git/poc-hd-2d/src/config.js`, en ne gardant **que ce qui relève du rendu**. `WORLD`, `CAMERA`, `HERO`, `GROTA`, `MOODS`, `WATER`, `SUN_DRIFT` restent au labo (`apps/lab/src/settings.ts`) : ce sont des réglages de monde, pas de moteur. Conserver les commentaires du PoC verbatim.

```ts
// packages/hd2d/src/config.ts
export interface RenderConfig {
  /** L'EffectComposer crée ses cibles internes SANS multiéchantillonnage, et le `antialias` du
   *  renderer ne concerne que le framebuffer par défaut — où l'on ne dessine qu'un quad plein
   *  écran. Sans ça, aucune arête de géométrie n'est lissée. */
  msaa: number;
  /** 1 = pleine résolution. En dessous, la scène est rendue plus petite puis remontée en nearest :
   *  grain de pixel parfaitement régulier, au prix du look « maquette ». */
  pixelScale: number;
}

export interface PostFxConfig {
  bloom: { strength: number; radius: number; threshold: number };
  tiltShift: {
    radius: number;
    focusY: number;
    focusRange: number;
    falloff: number;
    /** Dézoomer doit renforcer l'effet maquette, pas l'aplatir. */
    zoomBoost: number;
  };
  grade: { vignette: number; saturation: number; contrast: number };
}

export interface CloudShadowConfig {
  /** Fréquence spatiale, en 1/unité monde. */
  scale: number;
  /** Dérive, en UV/seconde. */
  drift: readonly [number, number];
  softness: number;
}

export interface Hd2dConfig {
  render: RenderConfig;
  postfx: PostFxConfig;
  cloudShadow: CloudShadowConfig;
  /** Une caméra qui plonge écrase un plan vertical d'un facteur cos(pitch). On compense en
   *  ÉTIRANT le sprite, pas en le penchant vers la caméra : pencher revient à le coucher en
   *  arrière, et son sommet entre alors dans ce qui se trouve derrière — un héros au pied d'une
   *  falaise disparaissait dedans. 0 = aucune compensation, 1 = totale. */
  spriteStretch: number;
}

export const DEFAULT_CONFIG: Hd2dConfig = {
  render: { msaa: 4, pixelScale: 1 },
  postfx: {
    bloom: { strength: 0.42, radius: 0.75, threshold: 0.72 },
    tiltShift: { radius: 5.5, focusY: 0.56, focusRange: 0.13, falloff: 0.34, zoomBoost: 0.7 },
    grade: { vignette: 0.85, saturation: 1.14, contrast: 1.06 },
  },
  cloudShadow: { scale: 0.011, drift: [0.0022, 0.0009], softness: 0.42 },
  spriteStretch: 0.85,
};
```

- [ ] **Step 4: Écrire `context.ts`**

```ts
// packages/hd2d/src/context.ts
import type * as THREE from "three";
import { type Hd2dConfig, DEFAULT_CONFIG } from "./config.js";

export interface LitBillboard {
  mesh: THREE.Mesh;
  material: THREE.MeshLambertMaterial;
  /** Mi-hauteur du corps : c'est de là qu'on mesure la distance à une source, et pas des pieds,
   *  sinon un arbre de 3,6 m est réputé collé au foyer. */
  mid: number;
}

export interface Hd2dContextOptions {
  /** Surcharge partielle : chaque bloc absent garde ses valeurs par défaut. */
  config?: Partial<Hd2dConfig>;
}

export interface Hd2dContext {
  readonly config: Hd2dConfig;
  yaw(): number;
  setYaw(yaw: number): void;
  registerBillboard(mesh: THREE.Mesh, opts: { lit: boolean; mid: number }): void;
  billboards(): readonly THREE.Mesh[];
  litBillboards(): readonly LitBillboard[];
  dispose(): void;
}

/**
 * Le porteur de tout ce que le PoC gardait en variables de module : le yaw courant, le registre
 * des billboards et celui des billboards éclairés.
 *
 * Un état de module marche tant qu'il n'y a qu'une scène dans la page. Le jeu et l'éditeur en
 * ouvriront deux : elles partageraient alors un seul yaw, et chaque rotation de caméra de l'une
 * tordrait les sprites de l'autre. C'est la même règle que ce dépôt applique déjà à ses systèmes
 * de room — les dépendances se passent en argument, rien ne se cache dans un singleton.
 */
export function createHd2dContext(options: Hd2dContextOptions = {}): Hd2dContext {
  // Cloné en PROFONDEUR, et pas fusionné à plat. Un merge superficiel laisse `postfx.bloom`,
  // `postfx.grade` et `cloudShadow.drift` partagés par référence entre tous les contextes ET avec
  // DEFAULT_CONFIG : le pipeline écrit `bloom.strength` à chaque changement d'ambiance, et cette
  // écriture corromprait alors l'autre scène et tous les contextes à venir, définitivement. C'est
  // exactement la contamination que ce fichier existe pour supprimer, un cran plus bas.
  const config: Hd2dConfig = {
    ...structuredClone(DEFAULT_CONFIG),
    ...options.config,
    render: { ...DEFAULT_CONFIG.render, ...options.config?.render },
    postfx: structuredClone({ ...DEFAULT_CONFIG.postfx, ...options.config?.postfx }),
    cloudShadow: structuredClone({
      ...DEFAULT_CONFIG.cloudShadow,
      ...options.config?.cloudShadow,
    }),
  };

  // Tous les sprites regardent la même direction : celle de la caméra. Dès qu'elle pivote, ils
  // doivent pivoter avec, sinon on les voit par la tranche.
  const tous: THREE.Mesh[] = [];
  const eclaires: LitBillboard[] = [];
  let courant = 0;

  return {
    config,
    yaw: () => courant,
    setYaw(yaw) {
      if (yaw === courant) return;
      courant = yaw;
      for (const m of tous) m.rotation.y = yaw;
    },
    registerBillboard(mesh, opts) {
      // Un sprite né pendant une rotation doit adopter le yaw courant, pas zéro.
      mesh.rotation.y = courant;
      tous.push(mesh);
      if (opts.lit) {
        eclaires.push({
          mesh,
          material: mesh.material as THREE.MeshLambertMaterial,
          mid: opts.mid,
        });
      }
    },
    billboards: () => tous,
    litBillboards: () => eclaires,
    dispose() {
      tous.length = 0;
      eclaires.length = 0;
    },
  };
}
```

- [ ] **Step 5: Lancer les tests pour les voir passer**

Run: `npx vitest run --project hd2d`
Expected: PASS — toute la suite du projet `hd2d`, y compris les tests des tasks précédentes.

- [ ] **Step 6: Commit**

```bash
git add packages/hd2d
git commit -m "feat(hd2d): contexte de scène explicite, plus aucun état de module"
```

---

### Task 3: Le registre de textures

**Files:**
- Create: `packages/hd2d/src/textures.ts`
- Test: `packages/hd2d/test/textures.test.ts`

**Interfaces:**
- Consumes: rien
- Produces:
  - `interface TextureSpec { url: string; atlas?: boolean }`
  - `createTextureRegistry(specs: readonly TextureSpec[]): TextureRegistry`
  - `interface TextureRegistry { decode(blobs: Map<string, Blob>, onDecoded: (p: number) => void): Promise<void>; get(url: string, opts?: { repeat?: boolean }): THREE.Texture; urls(): readonly string[]; dispose(): void }`
  - `textureFiltering(atlas: boolean): { magFilter: THREE.MagnificationTextureFilter; minFilter: THREE.MinificationTextureFilter; generateMipmaps: boolean; anisotropy: number }`

La liste des URL sort du package : `TEXTURE_URLS` est un catalogue de PoC, pas une propriété du moteur. Le labo la fournit. Ce que `hd2d` garde, c'est **la politique de filtrage** — c'est elle qui porte deux pièges coûteux.

- [ ] **Step 1: Écrire le test qui échoue**

```ts
// packages/hd2d/test/textures.test.ts
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { textureFiltering } from "../src/textures.js";

describe("textureFiltering", () => {
  it("désactive les mipmaps des atlas", () => {
    // Les atlas sont échantillonnés par sous-rectangles : leurs mipmaps mélangeraient les tuiles
    // voisines et feraient baver les bordures. L'écume relève du même cas — huit frames dans une
    // bande — et personne ne l'avait vue : les niveaux inférieurs moyennaient les huit frames
    // ENTRE ELLES, l'alpha moyenné rongeait la découpe, d'où des bavures le long du rivage.
    const a = textureFiltering(true);
    expect(a.generateMipmaps).toBe(false);
    expect(a.minFilter).toBe(THREE.LinearFilter);
    expect(a.magFilter).toBe(THREE.NearestFilter);
  });

  it("garde mipmaps et anisotropie pour les sprites", () => {
    // Pixel art en 3D : nearest en magnification (pixels francs), mipmaps en minification, sinon
    // le sprite grésille dès qu'il s'éloigne.
    const s = textureFiltering(false);
    expect(s.generateMipmaps).toBe(true);
    expect(s.minFilter).toBe(THREE.NearestMipmapLinearFilter);
    expect(s.magFilter).toBe(THREE.NearestFilter);
    expect(s.anisotropy).toBe(8);
  });
});
```

- [ ] **Step 2: Lancer le test pour le voir échouer**

Run: `npx vitest run --project hd2d test/textures.test.ts`
Expected: FAIL — module introuvable

- [ ] **Step 3: Porter `textures.ts`**

Port de `~/git/poc-hd-2d/src/core/textures.js`, avec trois changements : la liste d'URL arrive en argument, `ATLASES` devient un drapeau par spec, et le cache appartient au registre au lieu d'être un `Map` de module. `decode` reste la voie unique — on ne repasse jamais par `TextureLoader`, qui refetcherait tout sans rien dire du pourcentage. `blobToImage` reconstruit un `HTMLImageElement` : c'est exactement ce que `TextureLoader` fournit à `THREE.Texture`, donc `flipY` se comporte à l'identique (un `ImageBitmap` irait plus vite mais retourne l'image, et il faudrait reprendre toutes les UV).

`get()` lève si l'URL n'a pas été déclarée — le message doit nommer l'URL et dire quoi faire, comme dans le PoC : `Texture non préchargée : ${url} (à ajouter au catalogue du labo)`.

- [ ] **Step 4: Lancer les tests pour les voir passer**

Run: `npx vitest run --project hd2d`
Expected: PASS — toute la suite du projet `hd2d`, y compris les tests des tasks précédentes.

- [ ] **Step 5: Commit**

```bash
git add packages/hd2d
git commit -m "feat(hd2d): registre de textures, catalogue fourni par l'appelant"
```

---

### Task 4: Le pipeline de rendu et ses shaders

**Files:**
- Create: `packages/hd2d/src/shaders.ts`, `packages/hd2d/src/pipeline.ts`
- Test: `packages/hd2d/test/pipeline-math.test.ts`

**Interfaces:**
- Consumes: `Hd2dContext` (pour `config.render` et `config.postfx`)
- Produces:
  - `createPipeline(canvas: HTMLCanvasElement, scene: THREE.Scene, camera: THREE.PerspectiveCamera, ctx: Hd2dContext): Pipeline`
  - `interface Pipeline { renderer: THREE.WebGLRenderer; composer: EffectComposer; bloom: UnrealBloomPass; grade: ShaderPass; render(): void; resize(): void; setTiltShiftZoom(k: number): void; setFocusY(y: number): void; dispose(): void }`
  - `tiltShiftRadius(base: number, zoomBoost: number, k: number): number`
  - `TiltShiftShader`, `GradeShader`, `SkyShader`

Le pipeline a besoin d'un contexte WebGL : il ne se teste pas en node. Ce qui **se** teste, c'est l'arithmétique du zoom, qui décide de la signature visuelle et qui se casse sans rien signaler.

- [ ] **Step 1: Écrire le test qui échoue**

```ts
// packages/hd2d/test/pipeline-math.test.ts
import { describe, expect, it } from "vitest";
import { tiltShiftRadius } from "../src/pipeline.js";

describe("tiltShiftRadius", () => {
  it("ne change rien à la distance de référence", () => {
    // À k = 1, la vue par défaut doit être exactement inchangée : le zoom ne doit rien coûter
    // tant qu'on n'a pas zoomé.
    expect(tiltShiftRadius(5.5, 0.7, 1)).toBeCloseTo(5.5);
  });

  it("renforce l'effet maquette quand on recule", () => {
    // Reculer doit renforcer l'effet maquette, pas l'aplatir.
    expect(tiltShiftRadius(5.5, 0.7, 2)).toBeCloseTo(5.5 * 1.7);
    expect(tiltShiftRadius(5.5, 0.7, 0.5)).toBeCloseTo(5.5 * 0.65);
  });

  it("ne descend jamais sous zéro", () => {
    // Un rayon négatif ferait un flou à taps inversés — l'image part en miroir par bandes.
    expect(tiltShiftRadius(5.5, 3, 0.1)).toBe(0);
  });
});
```

- [ ] **Step 2: Lancer le test pour le voir échouer**

Run: `npx vitest run --project hd2d test/pipeline-math.test.ts`
Expected: FAIL — module introuvable

- [ ] **Step 3: Porter les shaders**

Port de `~/git/poc-hd-2d/src/render/shaders.js` **verbatim**, en typant les uniformes. `TiltShiftShader` (flou gaussien séparable piloté par la position verticale à l'écran), `GradeShader` (saturation, contraste, lift, vignette), `SkyShader` (dégradé, halo de l'astre, étoiles procédurales). Le GLSL ne change pas d'un caractère.

- [ ] **Step 4: Porter le pipeline**

Port de `~/git/poc-hd-2d/src/render/pipeline.js`, avec quatre changements :

1. `POSTFX` / `RENDER` viennent de `ctx.config`, plus d'un import de module ;
2. `tiltShiftRadius` est extraite en fonction pure exportée, et `setTiltShiftZoom` l'appelle ;
3. `setFocusY(y)` remplace la boucle que `main.js` faisait à la main sur `composer.passes` en cherchant `uniforms.uFocusY` — le pipeline tient ses deux passes de flou, il n'y a aucune raison que l'appelant les redécouvre par introspection à chaque frame. Il applique le même amorti (`+= (cible - courant) * 0.08`) ;
4. `resize()` ne s'abonne plus lui-même à `addEventListener("resize")` : c'est `dispose()` qui deviendrait impossible à écrire proprement. L'appelant s'abonne et appelle `resize()`.

`dispose()` doit libérer **les cinq passes** (`source`, `bloom`, `blurH`, `blurV`, `grade`) avant le composer, la cible MSAA et le renderer. `EffectComposer.dispose()` ne libère que ses deux cibles de ping-pong et sa passe de copie — il **ne cascade pas** vers les passes ajoutées par `addPass`, et `UnrealBloomPass` détient à lui seul une chaîne de mips complète. Un `dispose()` qui s'arrête au composer fuit donc tout le post-traitement à chaque démontage, en silence : c'est exactement la contrepartie du retrait de l'auto-abonnement qui serait perdue.

Les trois décisions qui **ne** doivent pas bouger, chacune documentée dans le fichier source et coûteuse à redécouvrir :

- **la scène va dans sa propre cible MSAA**, la chaîne d'après travaille sur des cibles simples. Donner une cible MSAA au composer lui fait la cloner pour son ping-pong, et chaque passe plein écran écrit alors 4 échantillons par pixel pour rien : mesuré à **+5 ms la frame** ;
- **l'étalonnage vient APRÈS `OutputPass`**, le flou avant. En linéaire, un contraste de 1.06 pivote autour d'un 0.5 linéaire — soit 0.73 à l'écran — et écrase les ombres bien plus qu'il n'ouvre les hautes lumières. Un flou, lui, n'est juste qu'en linéaire ;
- **le bloom est calculé en demi-résolution**. Il est basse fréquence par nature : ça ne se voit pas et ça rend la moitié de son coût.

- [ ] **Step 5: Lancer les tests et le labo**

Run: `npx vitest run --project hd2d && npm run typecheck:hd2d`
Expected: PASS

Câbler le pipeline dans `apps/lab/src/main.ts` à la place du `renderer.render()` direct. Run: `npm run lab` — le cube est maintenant bloomé, étalonné, vignetté, et flou en haut et en bas de l'écran.

- [ ] **Step 6: Commit**

```bash
git add packages/hd2d apps/lab
git commit -m "feat(hd2d): pipeline de rendu — MSAA dédié, tilt-shift, bloom, étalonnage"
```

---

### Task 5: Les feuilles de sprites, les billboards et l'animateur

**Files:**
- Create: `packages/hd2d/src/sheet.ts`, `packages/hd2d/src/billboard.ts`
- Test: `packages/hd2d/test/sheet.test.ts`, `packages/hd2d/test/billboard-geometry.test.ts`

**Interfaces:**
- Consumes: `Hd2dContext`, `applyCloudShadow` (Task 6 — jusque-là, `billboard.ts` prend une fonction de greffe en argument, `(material: THREE.Material, opts: { atOrigin: boolean }) => void`, par défaut un no-op)
- Produces:
  - `sheetUv(dims: { cols: number; rows: number }): { frame(i: number, opts?: { flipped?: boolean }): SheetRect }`
  - `interface SheetRect { offsetX: number; offsetY: number; repeatX: number; repeatY: number }`
  - `billboardHeight(opts: { height: number; pitch: number; stretch: number }): number`
  - `type Facing = "east" | "west" | "north" | "south"`
  - `interface Sprite { mesh: THREE.Mesh; setFrame(i: number): void; setFlip(v: boolean): void; dispose(): void }`
  - `interface Billboard extends Sprite { setFacing(f: Facing): void; placeAt(x: number, y: number, z: number): void; readonly footOffset: number }`
  - `makeBillboard(ctx, opts): Billboard`
  - `makeFlatSprite(ctx, opts): Sprite` — posé à plat, il n'a ni pieds ni orientation
  - `makeGlow(size: number, color: THREE.ColorRepresentation, seed?: number): THREE.Mesh`
  - `makeSurfaceDisc(size: number): THREE.Mesh`
  - `makeRipple(): THREE.Mesh`
  - `createAnimator(sprite: Billboard, clip: Clip, cols: number): Animator` avec `interface Clip { row: number; frames: number; fps: number }` et `interface Animator { play(next: Clip): void; update(dt: number): void; setPhase(v: number): void }`

- [ ] **Step 1: Écrire les tests qui échouent**

```ts
// packages/hd2d/test/sheet.test.ts
import { describe, expect, it } from "vitest";
import { sheetUv } from "../src/sheet.js";

describe("sheetUv", () => {
  const uv = sheetUv({ cols: 6, rows: 8 });

  it("place la frame dans son rectangle d'atlas", () => {
    // Frame 7 sur une grille 6x8 : colonne 1, ligne 1. L'origine UV est en bas, la feuille se lit
    // du haut : la ligne r part donc de 1 - (r + 1) / rows.
    expect(uv.frame(7)).toEqual({
      offsetX: 1 / 6,
      offsetY: 1 - 2 / 8,
      repeatX: 1 / 6,
      repeatY: 1 / 8,
    });
  });

  it("miroite par un repeat négatif, en gardant les UV dans [0,1]", () => {
    // Le flip se fait par un repeat négatif et un offset décalé d'une colonne : les UV restent
    // dans [0,1], donc un wrap ClampToEdge suffit et rien ne bave sur la frame voisine.
    expect(uv.frame(7, { flipped: true })).toEqual({
      offsetX: 2 / 6,
      offsetY: 1 - 2 / 8,
      repeatX: -1 / 6,
      repeatY: 1 / 8,
    });
  });

  it("traite la première frame comme les autres", () => {
    expect(uv.frame(0)).toEqual({ offsetX: 0, offsetY: 1 - 1 / 8, repeatX: 1 / 6, repeatY: 1 / 8 });
  });
});
```

```ts
// packages/hd2d/test/billboard-geometry.test.ts
import { describe, expect, it } from "vitest";
import { billboardHeight } from "../src/billboard.js";

const PITCH = (38 * Math.PI) / 180;

describe("billboardHeight", () => {
  it("ne compense rien à stretch 0", () => {
    expect(billboardHeight({ height: 2.6, pitch: PITCH, stretch: 0 })).toBeCloseTo(2.6);
  });

  it("annule complètement l'écrasement à stretch 1", () => {
    // Une caméra qui plonge de 38° écrase un plan vertical d'un facteur cos(38°).
    expect(billboardHeight({ height: 2.6, pitch: PITCH, stretch: 1 })).toBeCloseTo(2.6 / Math.cos(PITCH));
  });

  it("interpole entre les deux au réglage par défaut", () => {
    expect(billboardHeight({ height: 2.6, pitch: PITCH, stretch: 0.85 })).toBeCloseTo(
      2.6 * (1 + (1 / Math.cos(PITCH) - 1) * 0.85),
    );
  });

  it("ne compense rien sans plongée", () => {
    expect(billboardHeight({ height: 2.6, pitch: 0, stretch: 1 })).toBeCloseTo(2.6);
  });
});
```

- [ ] **Step 2: Lancer les tests pour les voir échouer**

Run: `npx vitest run --project hd2d test/sheet.test.ts test/billboard-geometry.test.ts`
Expected: FAIL — modules introuvables

- [ ] **Step 3: Écrire `sheet.ts`**

Extraction pure de `bindSheet` de `~/git/poc-hd-2d/src/core/billboard.js` : la même arithmétique, sortie du mesh.

```ts
// packages/hd2d/src/sheet.ts
export interface SheetRect {
  offsetX: number;
  offsetY: number;
  repeatX: number;
  repeatY: number;
}

/**
 * Découpe d'une feuille de sprites en frames.
 *
 * Le flip se fait par un repeat NÉGATIF et un offset décalé d'une colonne : les UV restent dans
 * [0,1], donc un wrap ClampToEdge suffit et le miroir ne va jamais chercher un pixel de la frame
 * voisine.
 */
export function sheetUv({ cols, rows }: { cols: number; rows: number }) {
  return {
    frame(i: number, { flipped = false }: { flipped?: boolean } = {}): SheetRect {
      const c = i % cols;
      const r = Math.floor(i / cols);
      return {
        offsetX: flipped ? (c + 1) / cols : c / cols,
        offsetY: 1 - (r + 1) / rows,
        repeatX: flipped ? -1 / cols : 1 / cols,
        repeatY: 1 / rows,
      };
    },
  };
}
```

- [ ] **Step 4: Porter `billboard.ts`**

Port de `~/git/poc-hd-2d/src/core/billboard.js`, avec ces changements :

1. `billboards` / `eclaires` / `currentYaw` disparaissent — `ctx.registerBillboard()` remplace les `push` et `setBillboardYaw` vit désormais dans le contexte ;
2. `discTexture`, `glowCache`, `rippleTexture` deviennent des paresseux **portés par le module mais purement en cache d'assets immuables** — c'est acceptable et voulu : ce sont des textures identiques pour tout le monde, sans état de scène. Elles doivent rester paresseuses (jamais appelées au chargement) pour que le projet vitest node ne touche jamais un canvas ;
3. `bindSheet` appelle `sheetUv` ;
4. `billboardHeight` est extraite en fonction pure exportée ;
5. `fillFromPointLight` part dans `fill-light.ts` (Task 6) ;
6. `makeBillboard` renvoie un objet `Billboard` au lieu d'accrocher `setFrame`/`setFlip`/`placeAt` sur le mesh — ce dépôt n'attache pas de méthodes aux objets three ;
7. **`setFacing(f: Facing)` est ajouté** — il n'existe pas dans le PoC, dont l'unique personnage ne se retourne jamais. Le spec du reboot décide que les sprites restent de **profil seul** (décision B) ; `setFacing` traduit donc pour l'instant `east`/`west` en `setFlip(false|true)` et laisse `north`/`south` sur le profil courant, sans rien changer. Il existe pour que l'orientation soit une **donnée** dès maintenant : le jour où des feuilles 4-directions arrivent, seul le corps de `setFacing` change — aucun appelant, ni dans le jeu, ni dans l'éditeur, ni au labo. C'est la clause que le spec exige explicitement de S1.

Écrire le test qui pin ce contrat, dans `test/billboard-geometry.test.ts` :

```ts
import { describe, expect, it, vi } from "vitest";
import { facingToFlip } from "../src/billboard.js";

describe("facingToFlip", () => {
  it("miroite sur l'axe est-ouest", () => {
    expect(facingToFlip("east", false)).toBe(false);
    expect(facingToFlip("west", false)).toBe(true);
  });

  it("laisse le profil courant intact au nord et au sud", () => {
    // Les unités Tiny Swords n'ont que le profil : aucune frame de face, aucune de dos. Se
    // retourner n'a donc rien à jouer, et remettre le sprite d'aplomb serait un saut visible.
    expect(facingToFlip("north", true)).toBe(true);
    expect(facingToFlip("south", false)).toBe(false);
  });
});
```

Les décisions du fichier qui ne doivent pas bouger, toutes documentées dans la source :

- **plan strictement vertical**, pivot au bas du plan, jamais penché vers la caméra ;
- **normales bombées** (gauche/droite/haut) pour que le plan réagisse comme un volume, et pour que le contre-jour latéral n'allume qu'une seule arête ;
- **`alphaTest: 0.5`** — un alphaTest est binaire, il ne restitue pas la semi-transparence, il la force à plein. À 0.25 l'ombre douce peinte au pied de chaque sprite devient une tache opaque à bord franc ;
- **`shadowSide: DoubleSide`** — three rend les faces arrière dans la shadow map (anti-acné) ; un quad n'en a pas, donc sans ça aucun sprite ne projette d'ombre ;
- **`totalEmissiveRadiance *= diffuseColor.rgb`** dans le patch de shader — un émissif qui sert de lumière doit être modulé par la texture, sinon c'est un aplat orange uniforme ;
- **le calque du contre-jour** (`RIM_LAYER`), activé sur les seuls sprites éclairés ;
- **le clone de texture partage la Source** — pas de second upload GPU, seuls offset/repeat sont propres au sprite.

- [ ] **Step 5: Lancer les tests pour les voir passer**

Run: `npx vitest run --project hd2d && npm run typecheck:hd2d && npm run lint`
Expected: PASS — toute la suite du projet `hd2d`, y compris les tests des tasks précédentes.

- [ ] **Step 6: Commit**

```bash
git add packages/hd2d
git commit -m "feat(hd2d): billboards, feuilles de sprites et animateur"
```

---

### Task 6: L'appoint de lumière et l'ombre des nuages

**Files:**
- Create: `packages/hd2d/src/fill-light.ts`, `packages/hd2d/src/clouds.ts`
- Modify: `packages/hd2d/src/billboard.ts` (brancher la vraie greffe de nuages)
- Test: `packages/hd2d/test/fill-light.test.ts`, `packages/hd2d/test/clouds.test.ts`

**Interfaces:**
- Consumes: `Hd2dContext`
- Produces:
  - `fillAmount(opts: { dot: number; intensity: number; distance: number; gain?: number }): number`
  - `applyFillFromPointLight(ctx: Hd2dContext, position: THREE.Vector3, color: THREE.Color, intensity: number, gain?: number): void`
  - `createCloudCover(ctx: Hd2dContext): CloudCover` avec `interface CloudCover { setStrength(v: number): void; update(dt: number): void; offset(): THREE.Vector2; dispose(): void }`
  - `applyCloudShadow(ctx: Hd2dContext, material: THREE.Material, opts?: { atOrigin?: boolean }): void`

- [ ] **Step 1: Écrire les tests qui échouent**

```ts
// packages/hd2d/test/fill-light.test.ts
import { describe, expect, it } from "vitest";
import { fillAmount } from "../src/fill-light.js";

describe("fillAmount", () => {
  it("ne donne rien à un sprite qui fait face à la source", () => {
    // L'appoint est proportionnel à ce que la VRAIE lumière rate. Face à la flamme, elle ne rate
    // rien : c'est la lumière ponctuelle qui joue, avec ses ombres portées.
    expect(fillAmount({ dot: 1, intensity: 13, distance: 3 })).toBe(0);
  });

  it("donne le maximum à un sprite qui lui tourne le dos", () => {
    // Un plan qui regarde la caméra ne peut rien recevoir d'une source placée derrière lui : son
    // produit scalaire vaut -0.97 et aucun réglage de lumière n'y change quoi que ce soit. C'est
    // pourtant là qu'on attend de voir le héros éclairé.
    expect(fillAmount({ dot: -1, intensity: 13, distance: 3 })).toBeCloseTo((13 / 9) * 0.42);
  });

  it("ne dépend plus que de la distance une fois les deux termes additionnés", () => {
    // dot + manque = 1 partout : le total ne dépend plus de l'orientation.
    const d = 4;
    for (const dot of [-1, -0.3, 0, 0.5, 1]) {
      const manque = 1 - Math.max(0, dot);
      expect(fillAmount({ dot, intensity: 10, distance: d })).toBeCloseTo(
        Math.min(1.6, (10 / (d * d)) * manque * 0.42),
      );
    }
  });

  it("s'éteint avec la source", () => {
    expect(fillAmount({ dot: -1, intensity: 0, distance: 2 })).toBe(0);
  });

  it("plafonne, pour qu'un sprite collé au foyer ne parte pas au blanc", () => {
    expect(fillAmount({ dot: -1, intensity: 400, distance: 0.1 })).toBe(1.6);
  });

  it("plancher de distance à 0.6 : un sprite au contact ne divise pas par zéro", () => {
    expect(fillAmount({ dot: -1, intensity: 1, distance: 0 })).toBeCloseTo(
      Math.min(1.6, (1 / 0.36) * 0.42),
    );
  });
});
```

```ts
// packages/hd2d/test/clouds.test.ts
import { describe, expect, it } from "vitest";
import { createHd2dContext } from "../src/context.js";
import { createCloudCover } from "../src/clouds.js";

describe("createCloudCover", () => {
  it("fait dériver la couverture à la vitesse configurée", () => {
    const ctx = createHd2dContext({ config: { cloudShadow: { scale: 0.011, drift: [0.002, 0.001], softness: 0.4 } } });
    const clouds = createCloudCover(ctx);
    clouds.update(2);
    expect(clouds.offset().x).toBeCloseTo(0.004);
    expect(clouds.offset().y).toBeCloseTo(0.002);
  });

  it("garde deux couvertures indépendantes", () => {
    const a = createCloudCover(createHd2dContext());
    const b = createCloudCover(createHd2dContext());
    a.update(5);
    expect(b.offset().x).toBe(0);
  });
});
```

- [ ] **Step 2: Lancer les tests pour les voir échouer**

Run: `npx vitest run --project hd2d test/fill-light.test.ts test/clouds.test.ts`
Expected: FAIL — modules introuvables

- [ ] **Step 3: Écrire `fill-light.ts`**

```ts
// packages/hd2d/src/fill-light.ts
import * as THREE from "three";
import type { Hd2dContext } from "./context.js";

/** Sous cette distance, l'appoint cesse de croître : un sprite au contact ne divise pas par zéro. */
const DISTANCE_MIN = 0.6;
/** Un sprite collé au foyer ne doit pas partir au blanc. */
const APPOINT_MAX = 1.6;

/**
 * Ce que la vraie lumière RATE, et rien de plus.
 *
 * Un sprite est un plan qui regarde la caméra : une lumière placée DERRIÈRE lui ne peut
 * physiquement rien lui donner, son produit scalaire est négatif. Le héros à deux pas du feu, dos
 * à la flamme, s'éteignait donc complètement — correct, et complètement faux à l'oeil.
 *
 * Aucun réglage de lumière ne corrige ça, et les demi-lambert non plus : à contre-jour franc le
 * scalaire vaut -0.97, un « wrap » même total en tire 1 %. On calcule donc l'appoint à la main et
 * on le donne au matériau en émissif. Là où le sprite fait face à la flamme il vaut zéro, et c'est
 * la lumière ponctuelle qui joue : le total ne dépend plus de l'orientation, seulement de la
 * distance.
 */
export function fillAmount({
  dot,
  intensity,
  distance,
  gain = 0.42,
}: {
  dot: number;
  intensity: number;
  distance: number;
  gain?: number;
}): number {
  if (intensity <= 0) return 0;
  const d = Math.max(distance, DISTANCE_MIN);
  const manque = 1 - Math.max(0, dot);
  return Math.min(APPOINT_MAX, (intensity / (d * d)) * manque * gain);
}
```

Puis `applyFillFromPointLight(ctx, …)` : port de `fillFromPointLight`, qui itère sur `ctx.litBillboards()` au lieu du tableau de module, calcule la normale moyenne tournée du yaw courant (`ctx.yaw()`), et écrit `material.emissive` en appelant `fillAmount`. Les vecteurs de travail restent alloués **hors de la boucle** : cette fonction tourne à chaque frame sur tous les sprites éclairés.

- [ ] **Step 4: Porter `clouds.ts`**

Port de `~/git/poc-hd-2d/src/world/clouds.js`, avec un seul changement : les uniformes ne sont plus un objet de module mais appartiennent au contexte. `applyCloudShadow(ctx, material, opts)` lit les uniformes du contexte. `coverageTexture()` reste paresseuse.

Ce qui ne bouge pas :

- **plus aucune géométrie.** Les nuages ont d'abord été cinq quads écrivant dans la shadow map : leurs bords étaient aussi nets que ceux d'un tronc, ils croisaient la ligne de visée à 38° de plongée, et les sprites ne recevaient rien. C'est maintenant une carte de couverture qui dérive et **multiplie l'albédo du décor ET des sprites** ;
- **`atOrigin` pour les sprites.** Un billboard est un plan vertical : échantillonné par fragment, la carte s'y étirerait en traînée verticale et le haut de l'arbre serait à l'ombre pendant que son pied est au soleil ;
- **`customProgramCacheKey`.** Sans lui, three réutilise le programme d'un matériau non patché ayant les mêmes réglages, et la greffe passe à la trappe une fois sur deux.

Brancher ensuite la vraie greffe dans `billboard.ts` à la place du no-op de la Task 5. Attention à l'ordre : `makeBillboard` écrase la clé de cache par `"sprite-eclaire"` **après** l'appel à `applyCloudShadow`, et enchaîne son propre `onBeforeCompile` par-dessus celui des nuages. C'est intentionnel — le patch émissif et le patch de nuages doivent coexister sur le même matériau.

- [ ] **Step 5: Lancer les tests pour les voir passer**

Run: `npx vitest run --project hd2d && npm run typecheck:hd2d`
Expected: PASS — toute la suite du projet `hd2d`, y compris les tests des tasks précédentes.

- [ ] **Step 6: Commit**

```bash
git add packages/hd2d
git commit -m "feat(hd2d): appoint de lumière sur les sprites et ombres de nuages par contexte"
```

---

### Task 7: Le mélangeur d'ambiances et la voûte céleste

**Files:**
- Create: `packages/hd2d/src/mood.ts`, `packages/hd2d/src/sky.ts`
- Test: `packages/hd2d/test/mood.test.ts`

**Interfaces:**
- Consumes: `SkyShader` (Task 4)
- Produces:
  - `interface MoodConfig { exposure: number; sky: { top: string; horizon: string; glow: string; glowStrength: number; stars: number }; fog: { near: number; far: number }; sun: { color: string; intensity: number; position: readonly [number, number, number] }; rim: { color: string; intensity: number; position: readonly [number, number, number] }; hemi: { sky: string; ground: string; intensity: number }; fire: number; clouds: number; water: { shallow: string; deep: string; sparkle: number }; motes: number; fireflies: number; bloom: { strength: number; threshold: number }; grade: { saturation: number; lift: number } }`
  - `type ResolvedMood` — le même, couleurs en `THREE.Color`
  - `createMoodMixer<K extends string>(moods: Record<K, MoodConfig>, start: K, fadeSeconds: number): MoodMixer<K>` avec `interface MoodMixer<K> { readonly value: ResolvedMood; readonly name: K; goTo(name: K): void; update(dt: number): boolean }`
  - `createSky(ctx: Hd2dContext): Sky` avec `interface Sky { mesh: THREE.Mesh; readonly horizon: THREE.Color; apply(mood: ResolvedMood, sunDirection: THREE.Vector3): void; update(dt: number, camera: THREE.Camera): void }`

Le catalogue d'ambiances (`MOODS`) reste au labo : `day`/`night` sont du contenu, pas du moteur. `hd2d` fournit le mélangeur et la forme.

- [ ] **Step 1: Écrire le test qui échoue**

```ts
// packages/hd2d/test/mood.test.ts
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createMoodMixer, type MoodConfig } from "../src/mood.js";

const base: MoodConfig = {
  exposure: 1,
  sky: { top: "#3d8fd0", horizon: "#a8dced", glow: "#fff4d2", glowStrength: 0.5, stars: 0 },
  fog: { near: 34, far: 86 },
  sun: { color: "#ffffff", intensity: 2.6, position: [-18, 22, 12] },
  rim: { color: "#cfe6ff", intensity: 0.85, position: [17, 12, -8] },
  hemi: { sky: "#bfe6ff", ground: "#6b7a4a", intensity: 1.15 },
  fire: 1.1,
  clouds: 0.34,
  water: { shallow: "#1eab99", deep: "#08365c", sparkle: 1 },
  motes: 0.5,
  fireflies: 0,
  bloom: { strength: 0.38, threshold: 0.78 },
  grade: { saturation: 1.14, lift: 0 },
};
const nuit: MoodConfig = {
  ...base,
  exposure: 0.72,
  sun: { color: "#000000", intensity: 0.62, position: [-15, 21, 10] },
  fire: 13,
};

const FADE = 2.2;

describe("createMoodMixer", () => {
  it("interpole les scalaires à mi-fondu", () => {
    const mix = createMoodMixer({ day: base, night: nuit }, "day", FADE);
    mix.goTo("night");
    mix.update(FADE / 2);
    expect(mix.value.exposure).toBeCloseTo((1 + 0.72) / 2, 3);
    expect(mix.value.fire).toBeCloseTo((1.1 + 13) / 2, 3);
  });

  it("interpole aussi les COULEURS, et non un entier hexadécimal", () => {
    // Toutes les couleurs sont des chaînes justement pour que le mélange se fasse dans l'espace
    // couleur. Interpoler 0xffffff vers 0x000000 sur un entier passerait par du vert.
    const mix = createMoodMixer({ day: base, night: nuit }, "day", FADE);
    mix.goTo("night");
    mix.update(FADE / 2);
    const c = mix.value.sun.color;
    expect(c.r).toBeCloseTo(0.5, 1);
    expect(c.g).toBeCloseTo(0.5, 1);
    expect(c.b).toBeCloseTo(0.5, 1);
  });

  it("signale le changement tant qu'il bouge, et se tait une fois arrivé", () => {
    // main.js fait `if (mood.update(dt)) pushMood()` : repousser l'ambiance dans toute la scène à
    // chaque frame alors qu'elle ne bouge plus, c'est du travail pour rien à 60 Hz.
    const mix = createMoodMixer({ day: base, night: nuit }, "day", FADE);
    mix.goTo("night");
    expect(mix.update(0.5)).toBe(true);
    expect(mix.update(FADE)).toBe(true);
    expect(mix.update(0.016)).toBe(false);
    expect(mix.value.exposure).toBeCloseTo(0.72);
    expect(mix.name).toBe("night");
  });

  it("repart de la valeur COURANTE quand on change d'avis en plein fondu", () => {
    // Sinon un aller-retour rapide ferait sauter l'image d'un bout à l'autre du fondu.
    const mix = createMoodMixer({ day: base, night: nuit }, "day", FADE);
    mix.goTo("night");
    mix.update(FADE / 2);
    const milieu = mix.value.exposure;
    mix.goTo("day");
    mix.update(0.001);
    expect(mix.value.exposure).toBeCloseTo(milieu, 2);
  });
});
```

- [ ] **Step 2: Lancer le test pour le voir échouer**

Run: `npx vitest run --project hd2d test/mood.test.ts`
Expected: FAIL — module introuvable

- [ ] **Step 3: Porter `mood.ts`**

Port de `~/git/poc-hd-2d/src/render/mood.js`, avec : les ambiances arrivent en argument au lieu d'un import de `config.js`, la durée de fondu aussi, et le typage `MoodConfig` / `ResolvedMood`. Si le PoC ne repart pas de la valeur courante lors d'un changement en plein fondu, **c'est une correction à apporter** — le dernier test l'exige ; l'implémentation garde donc l'état courant comme point de départ à chaque `goTo`.

- [ ] **Step 4: Porter `sky.ts`**

Port de `~/git/poc-hd-2d/src/render/atmosphere.js`. La voûte suit la caméra et n'entre jamais dans le cadre à 38° de plongée et 22° de champ — elle existe pour donner sa **couleur d'horizon au brouillard** : deux teintes voisines mais distinctes dessinaient une ligne franche là où la mer lointaine rencontre la voûte. `horizon` est donc exposée en lecture.

- [ ] **Step 5: Lancer les tests pour les voir passer**

Run: `npx vitest run --project hd2d && npm run typecheck:hd2d`
Expected: PASS — toute la suite du projet `hd2d`, y compris les tests des tasks précédentes.

- [ ] **Step 6: Commit**

```bash
git add packages/hd2d
git commit -m "feat(hd2d): mélangeur d'ambiances et voûte céleste"
```

---

### Task 8: Le mailleur de terrain — autotiling, parois, occlusion de contact

**Files:**
- Create: `packages/hd2d/src/terrain/field.ts`, `packages/hd2d/src/terrain/atlas.ts`, `packages/hd2d/src/terrain/mesh.ts`
- Test: `packages/hd2d/test/terrain-field.test.ts`, `packages/hd2d/test/terrain-mesh.test.ts`

**Interfaces:**
- Consumes: `Hd2dContext`, `applyCloudShadow`
- Produces:
  - `interface HeightField { readonly cols: number; readonly rows: number; levelAt(i: number, j: number): number | null; materialAt(i: number, j: number): string | null }`
  - `openEdge(field: HeightField, i: number, j: number, di: number, dj: number): boolean`
  - `autotileAxis(a: boolean, b: boolean): 0 | 1 | 2 | 3`
  - `cornerOcclusion(field: HeightField, i: number, j: number, di: number, dj: number): number`
  - `wallDrop(field: HeightField, i: number, j: number, di: number, dj: number): number`
  - `AO_CORNER: number`
  - `interface TerrainAtlas { texture: THREE.Texture; cols: number; rows: number; block: "water-edge" | "cliff-edge" | "flat"; wallRow: number }`
  - `tileUV(atlas: TerrainAtlas, col: number, row: number): { u0: number; v0: number; u1: number; v1: number }`
  - `meshTerrain(ctx: Hd2dContext, field: HeightField, opts: { atlases: Record<string, TerrainAtlas>; levelHeight: number }): { group: THREE.Group; dispose(): void }`

C'est la task où les tests paient le plus : ces quatre fonctions pures sont le cerveau du mailleur, et ce sont exactement celles qui cassent en silence — une bordure qui s'ouvre du mauvais côté ne lève aucune erreur, elle produit juste une île qui a l'air presque juste.

- [ ] **Step 1: Écrire les tests qui échouent**

```ts
// packages/hd2d/test/terrain-field.test.ts
import { describe, expect, it } from "vitest";
import { AO_CORNER, autotileAxis, cornerOcclusion, openEdge, wallDrop } from "../src/terrain/field.js";
import type { HeightField } from "../src/terrain/field.js";

/**
 * Construit un champ depuis un dessin : un chiffre = un palier, `.` = l'eau, `s` = du sable au
 * palier 0. Une ligne du tableau = une rangée j, un caractère = une colonne i.
 */
function fieldFrom(rows: readonly string[]): HeightField {
  const cols = rows[0]?.length ?? 0;
  const at = (i: number, j: number): string | null => {
    if (i < 0 || j < 0 || j >= rows.length || i >= cols) return null;
    const ch = rows[j]?.[i];
    return ch === undefined || ch === "." ? null : ch;
  };
  return {
    cols,
    rows: rows.length,
    levelAt: (i, j) => {
      const ch = at(i, j);
      return ch === null ? null : ch === "s" ? 0 : Number(ch);
    },
    materialAt: (i, j) => {
      const ch = at(i, j);
      return ch === null ? null : ch === "s" ? "sable" : "herbe";
    },
  };
}

describe("openEdge", () => {
  const f = fieldFrom(["01", "0."]);

  it("s'ouvre face au vide", () => {
    // (1,0) est au palier 1, son voisin sud (1,1) est de l'eau.
    expect(openEdge(f, 1, 0, 0, 1)).toBe(true);
    // (0,1) au palier 0, voisin est (1,1) : de l'eau.
    expect(openEdge(f, 0, 1, 1, 0)).toBe(true);
  });

  it("s'ouvre face à un voisin PLUS BAS", () => {
    expect(openEdge(f, 1, 0, -1, 0)).toBe(true); // palier 1 vers palier 0
  });

  it("ne s'ouvre PAS face à un voisin plus haut", () => {
    // On est au pied de sa falaise : c'est elle qui porte la bordure, pas nous.
    expect(openEdge(f, 0, 0, 1, 0)).toBe(false);
  });

  it("ne s'ouvre pas face à un voisin de même niveau et même matière", () => {
    expect(openEdge(fieldFrom(["00"]), 0, 0, 1, 0)).toBe(false);
  });

  it("le sable se borde contre l'herbe, et l'herbe le subit", () => {
    // C'est le sable qui dessine le trait de plage.
    const plage = fieldFrom(["s0"]);
    expect(openEdge(plage, 0, 0, 1, 0)).toBe(true);
    expect(openEdge(plage, 1, 0, -1, 0)).toBe(false);
  });

  it("sort de la carte comme sur du vide", () => {
    expect(openEdge(fieldFrom(["0"]), 0, 0, -1, 0)).toBe(true);
  });
});

describe("autotileAxis", () => {
  it("choisit la colonne sur les deux seules arêtes de son axe", () => {
    // Chaque bloc est un autotile 4x4 : un carré 3x3 (coins, bords, centre) plus une colonne et
    // une ligne pour les bandes d'une seule case de large. Le choix est SÉPARABLE.
    expect(autotileAxis(false, false)).toBe(1); // centre
    expect(autotileAxis(true, false)).toBe(0); // bord côté a
    expect(autotileAxis(false, true)).toBe(2); // bord côté b
    expect(autotileAxis(true, true)).toBe(3); // bande d'une seule case
  });
});

describe("cornerOcclusion", () => {
  it("assombrit un coin une fois par voisin plus haut qui le touche", () => {
    // Un coin est occlus par chacun des TROIS voisins qui le touchent : les deux d'arête et le
    // diagonal. C'est ce qui creuse le pied des falaises et le creux des marches.
    const f = fieldFrom(["11", "10"]);
    // Coin nord-ouest de (1,1) : ses trois voisins (0,1), (1,0) et (0,0) sont au palier 1.
    expect(cornerOcclusion(f, 1, 1, -1, -1)).toBeCloseTo(1 - AO_CORNER * 3);
  });

  it("laisse un coin dégagé en pleine clarté", () => {
    expect(cornerOcclusion(fieldFrom(["00", "00"]), 0, 0, 1, 1)).toBe(1);
  });

  it("ignore l'eau et le hors-carte", () => {
    expect(cornerOcclusion(fieldFrom(["0.", ".."]), 0, 0, 1, 1)).toBe(1);
  });
});

describe("wallDrop", () => {
  it("compte les paliers franchis jusqu'au voisin", () => {
    // La paroi est découpée en un quad par palier franchi : le premier porte la retombée sous
    // l'arête, les suivants une bande répétable.
    expect(wallDrop(fieldFrom(["20"]), 0, 0, 1, 0)).toBe(2);
    expect(wallDrop(fieldFrom(["21"]), 0, 0, 1, 0)).toBe(1);
  });

  it("ne rend rien face à un voisin de même niveau ou plus haut", () => {
    expect(wallDrop(fieldFrom(["11"]), 0, 0, 1, 0)).toBe(0);
    expect(wallDrop(fieldFrom(["12"]), 0, 0, 1, 0)).toBe(0);
  });

  it("descend jusqu'à l'eau face au vide", () => {
    // Une falsaise qui donne sur la mer retombe de tous ses paliers, sinon il reste une bande
    // apparemment vide mais inaccessible au ras de l'eau.
    expect(wallDrop(fieldFrom(["2."]), 0, 0, 1, 0)).toBe(2);
  });
});
```

```ts
// packages/hd2d/test/terrain-mesh.test.ts
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createHd2dContext } from "../src/context.js";
import { meshTerrain } from "../src/terrain/mesh.js";
import type { TerrainAtlas } from "../src/terrain/atlas.js";
import type { HeightField } from "../src/terrain/field.js";

function atlas(): TerrainAtlas {
  return { texture: new THREE.Texture(), cols: 9, rows: 6, block: "cliff-edge", wallRow: 4 };
}

function flat(cols: number, rows: number, level: number): HeightField {
  return {
    cols,
    rows,
    levelAt: (i, j) => (i < 0 || j < 0 || i >= cols || j >= rows ? null : level),
    materialAt: (i, j) => (i < 0 || j < 0 || i >= cols || j >= rows ? null : "herbe"),
  };
}

describe("meshTerrain", () => {
  it("émet un quad de dessus par case praticable", () => {
    const ctx = createHd2dContext();
    const { group } = meshTerrain(ctx, flat(4, 3, 0), {
      atlases: { herbe: atlas() },
      levelHeight: 0.9,
    });
    const positions = group.children
      .filter((c): c is THREE.Mesh => c instanceof THREE.Mesh)
      .reduce((n, m) => n + (m.geometry.getAttribute("position")?.count ?? 0), 0);
    // 12 cases plates, aucun dénivelé donc aucune paroi : 4 sommets chacune.
    expect(positions).toBe(12 * 4);
  });

  it("place le dessus à la hauteur de son palier", () => {
    const ctx = createHd2dContext();
    const { group } = meshTerrain(ctx, flat(1, 1, 2), {
      atlases: { herbe: atlas() },
      levelHeight: 0.9,
    });
    const mesh = group.children.find((c): c is THREE.Mesh => c instanceof THREE.Mesh);
    const pos = mesh?.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let k = 0; k < pos.count; k++) expect(pos.getY(k)).toBeCloseTo(1.8);
  });

  it("porte une couleur de sommet pour l'occlusion de contact", () => {
    const ctx = createHd2dContext();
    const { group } = meshTerrain(ctx, flat(2, 2, 0), {
      atlases: { herbe: atlas() },
      levelHeight: 0.9,
    });
    const mesh = group.children.find((c): c is THREE.Mesh => c instanceof THREE.Mesh);
    expect(mesh?.geometry.getAttribute("color")).toBeDefined();
  });

  it("libère ses géométries au dispose", () => {
    const ctx = createHd2dContext();
    const built = meshTerrain(ctx, flat(2, 2, 0), { atlases: { herbe: atlas() }, levelHeight: 0.9 });
    built.dispose();
    expect(built.group.children).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Lancer les tests pour les voir échouer**

Run: `npx vitest run --project hd2d test/terrain-field.test.ts test/terrain-mesh.test.ts`
Expected: FAIL — modules introuvables

- [ ] **Step 3: Écrire `terrain/field.ts`**

Les quatre fonctions extraites de `buildTerrain()` dans `~/git/poc-hd-2d/src/world/terrain.js` (les closures `isOpen`, `axis`, `coin`, `hasWall`), sorties de la fonction et rendues pures sur un `HeightField`.

```ts
// packages/hd2d/src/terrain/field.ts
/** Un terrain vu comme des données : un niveau et une matière par case, rien d'autre. C'est
 *  l'AUTEUR qui pose l'altitude ; parois, bordures et occlusion s'en déduisent. */
export interface HeightField {
  readonly cols: number;
  readonly rows: number;
  /** Niveau de la case, ou null si c'est de l'eau ou hors carte. */
  levelAt(i: number, j: number): number | null;
  /** Clé de matière — sert à choisir l'atlas et à ouvrir les arêtes entre matières. */
  materialAt(i: number, j: number): string | null;
}

/** Assombrissement apporté par UN voisin plus haut touchant un coin. */
export const AO_CORNER = 0.11;

/**
 * Une arête est « ouverte » — donc bordée — face au vide, face à un voisin plus bas, ou face à une
 * autre matière de même niveau. Un voisin PLUS HAUT ne l'ouvre pas : on est au pied de sa falaise,
 * c'est elle qui porte la bordure.
 *
 * Le sable se borde contre l'herbe et pas l'inverse : c'est lui qui dessine le trait de plage.
 */
export function openEdge(field: HeightField, i: number, j: number, di: number, dj: number): boolean {
  const h = field.levelAt(i, j);
  if (h === null) return false;
  const n = field.levelAt(i + di, j + dj);
  if (n === null || n < h) return true;
  const mine = field.materialAt(i, j);
  return mine === "sable" && field.materialAt(i + di, j + dj) !== "sable";
}

/**
 * Colonne (ou ligne) de l'autotile 4x4. Le choix est SÉPARABLE : la colonne ne dépend que des
 * arêtes ouvertes à l'ouest et à l'est, la ligne que de celles au nord et au sud.
 */
export function autotileAxis(a: boolean, b: boolean): 0 | 1 | 2 | 3 {
  return a && b ? 3 : a ? 0 : b ? 2 : 1;
}

/**
 * Un coin est occlus par chacun des trois voisins qui le touchent — les deux d'arête et le
 * diagonal — dès qu'ils sont plus hauts que lui. C'est ce qui creuse le pied des falaises et le
 * creux des marches, en vertex color et sans coûter une passe.
 */
export function cornerOcclusion(
  field: HeightField,
  i: number,
  j: number,
  di: number,
  dj: number,
): number {
  const h = field.levelAt(i, j);
  if (h === null) return 1;
  let n = 0;
  for (const [a, b] of [
    [di, 0],
    [0, dj],
    [di, dj],
  ] as const) {
    const v = field.levelAt(i + a, j + b);
    if (v !== null && v > h) n++;
  }
  return 1 - AO_CORNER * n;
}

/**
 * Nombre de paliers que la paroi doit descendre de ce côté. Zéro s'il n'y a pas de paroi.
 *
 * Face au vide, elle descend de TOUS ses paliers : sans ça il reste une bande apparemment vide
 * mais inaccessible au ras de l'eau — une falaise doit se voir sur ses quatre côtés.
 */
export function wallDrop(
  field: HeightField,
  i: number,
  j: number,
  di: number,
  dj: number,
): number {
  const h = field.levelAt(i, j);
  if (h === null) return 0;
  const n = field.levelAt(i + di, j + dj);
  if (n === null) return h;
  return n < h ? h - n : 0;
}
```

- [ ] **Step 4: Écrire `terrain/atlas.ts` puis `terrain/mesh.ts`**

`atlas.ts` porte `tileUV` avec la **garde d'un demi-texel** : un atlas sans mipmaps échantillonné par sous-rectangles bave sur ses voisines dès que les UV tombent pile sur la frontière.

`mesh.ts` porte la boucle de maillage de `buildTerrain()` — un accumulateur de quads par atlas, le dessus avec sa tuile d'autotile et ses quatre couleurs de coin, puis les parois par côté découpées en un quad par palier (about gauche, morceau courant, about droit). Trois changements par rapport au PoC :

1. la **génération** du heightmap sort — `meshTerrain` reçoit un `HeightField`, il ne le fabrique pas. `makeHeightmap`, `mulberry32`, la propagation de distance à l'eau et le calcul du sable partent au labo (`apps/lab/src/world/island.ts`) ;
2. les **méthodes de requête** (`heightAt`, `maxHeightAround`, `levelAt`, `kindAt`, `cellCenter`) sortent aussi : ce sont de la collision, pas du rendu, et elles iront dans `engine` en S2. Pour S1 elles vivent au labo, à côté de la génération ;
3. la **mer et l'écume** partent dans `water.ts` / `foam.ts` (Task 9).

Ce qui ne bouge pas :

- le choix du bloc d'autotile : **au palier 0 toute arête ouverte donne sur l'eau** → bloc à liseré d'écume ; **plus haut elle donne sur un vide** → bloc à bordure touffue, celui qui se raccorde à la paroi ;
- **un tileset par palier** : l'altitude se lit à la teinte de l'herbe elle-même, pas à une correction plaquée après coup ;
- **`shadowSide: DoubleSide` sur le sol** : sans ça il ne projette rien dans la shadow map ;
- **`applyCloudShadow` par fragment** (pas `atOrigin`) sur le terrain : posé à plat, il doit s'échantillonner dans le plan du sol.

- [ ] **Step 5: Lancer les tests pour les voir passer**

Run: `npx vitest run --project hd2d && npm run typecheck:hd2d && npm run lint`
Expected: PASS — toute la suite du projet `hd2d`, y compris les tests des tasks précédentes.

- [ ] **Step 6: Commit**

```bash
git add packages/hd2d
git commit -m "feat(hd2d): mailleur de terrain — autotiling, parois, occlusion de contact"
```

---

### Task 9: La mer et l'écume

**Files:**
- Create: `packages/hd2d/src/terrain/water.ts`, `packages/hd2d/src/terrain/foam.ts`
- Test: `packages/hd2d/test/foam.test.ts`

**Interfaces:**
- Consumes: `HeightField`, `Hd2dContext`, `makeFlatSprite`
- Produces:
  - `createWater(ctx, field, opts: { level: number; size: number; segment: number; depthRange: number; roughness: number }): Water` avec `interface Water { mesh: THREE.Mesh; readonly colors: { shallow: THREE.Color; deep: THREE.Color }; setSparkle(v: number): void; update(dt: number): void; dispose(): void }`
  - `foamPlacements(field: HeightField): readonly { i: number; j: number }[]`
  - `createFoam(ctx, field, opts: { texture: THREE.Texture; frames: number; fps: number; spread: number }): Foam` avec `interface Foam { group: THREE.Group; update(dt: number): void; dispose(): void }`
  - `FOAM_SPREAD: number`

- [ ] **Step 1: Écrire le test qui échoue**

```ts
// packages/hd2d/test/foam.test.ts
import { describe, expect, it } from "vitest";
import { foamPlacements } from "../src/terrain/foam.js";
import type { HeightField } from "../src/terrain/field.js";

function fieldFrom(rows: readonly string[]): HeightField {
  const cols = rows[0]?.length ?? 0;
  const lvl = (i: number, j: number) => {
    if (i < 0 || j < 0 || j >= rows.length || i >= cols) return null;
    const ch = rows[j]?.[i];
    return ch === undefined || ch === "." ? null : Number(ch);
  };
  return { cols, rows: rows.length, levelAt: lvl, materialAt: (i, j) => (lvl(i, j) === null ? null : "herbe") };
}

describe("foamPlacements", () => {
  it("centre la tache sur la case de TERRE, jamais sur l'eau", () => {
    // Posée sur l'eau, elle formait des pavés flottant au large. Centrée sur la terre et glissée
    // dessous, le sol la masque partout où il la recouvre : seul son débord dépasse, et le liseré
    // épouse exactement le découpage des cases.
    const f = fieldFrom([".0."]);
    expect(foamPlacements(f)).toEqual([{ i: 1, j: 0 }]);
  });

  it("ne pose rien sur une case de terre entourée de terre", () => {
    // Le bord de carte compte comme de l'eau, sinon le rivage d'une île qui le touche perdrait son
    // liseré : sur un 3x3 plein, la case centrale est donc la seule à n'avoir aucun voisin d'eau.
    const posees = foamPlacements(fieldFrom(["000", "000", "000"]));
    expect(posees).toHaveLength(8);
    expect(posees).not.toContainEqual({ i: 1, j: 1 });
  });

  it("ne pose rien sur une case en hauteur : l'écume est un liseré de rivage", () => {
    expect(foamPlacements(fieldFrom([".1."]))).toEqual([]);
  });

  it("ne pose rien sur une carte sans terre", () => {
    expect(foamPlacements(fieldFrom(["..", ".."]))).toEqual([]);
  });
});
```

- [ ] **Step 2: Lancer le test pour le voir échouer**

Run: `npx vitest run --project hd2d test/foam.test.ts`
Expected: FAIL — module introuvable

- [ ] **Step 3: Porter `water.ts`**

Extraction de la partie mer de `buildTerrain()`. Ce qui ne bouge pas :

- **quatre houles analytiques** pour la normale : sans elles le plan est parfaitement plat, le soleil n'accroche nulle part malgré une roughness basse, et la mer reste un aplat ;
- **roughness 0.46**, pas 0.12 : à 0.12 la mer est un miroir, le lobe spéculaire du soleil couvre le cadre entier et l'écran blanchit d'un coup quand l'azimut s'aligne ;
- **couleurs volontairement sombres et saturées** : c'est un plan horizontal qui prend le soleil de plein fouet, et ACES désature tout ce qui monte vers les hautes lumières — un turquoise pâle finit en nappe grise ;
- **la mer est opaque.** L'écume est en découpe donc peinte avant les transparents ; une eau translucide la recouvrait de 12 % ;
- **dégradé de profondeur sur `depthRange` cases**, turquoise sur les hauts-fonds, bleu au large.

- [ ] **Step 4: Porter `foam.ts`**

`foamPlacements` est la fonction pure testée ci-dessus. `createFoam` pose un `makeFlatSprite` par emplacement, dimensionné sur la **pastille** et non sur la frame : la tache n'occupe que 39 % de sa frame (75 px opaques sur 192), un quad dimensionné sur la case donnerait une pastille de 0.39 unité entièrement cachée sous la tuile de terre. `FOAM_SPREAD = 1.42` — 1.56 semait des mouchetures aux angles du littoral, 1.42 donne un liseré continu. L'atlas de huit frames avance toutes en phase (une marée, pas un clapot) et est déclaré `atlas: true` au registre de textures, sans quoi les mipmaps moyennent les huit frames entre elles.

- [ ] **Step 5: Lancer les tests pour les voir passer**

Run: `npx vitest run --project hd2d && npm run typecheck:hd2d`
Expected: PASS — toute la suite du projet `hd2d`, y compris les tests des tasks précédentes.

- [ ] **Step 6: Commit**

```bash
git add packages/hd2d
git commit -m "feat(hd2d): mer à profondeur et écume de rivage"
```

---

### Task 10: Les particules

**Files:**
- Create: `packages/hd2d/src/particles.ts`
- Test: `packages/hd2d/test/particles.test.ts`

**Interfaces:**
- Consumes: `Hd2dContext`, `ResolvedMood`
- Produces:
  - `createParticleField(ctx, opts: { firePosition: THREE.Vector3; worldRadius: number }): ParticleField` avec `interface ParticleField { group: THREE.Group; apply(mood: ResolvedMood): void; update(dt: number): void; dispose(): void }`
  - `createPetalFall(ctx, opts: { centre: THREE.Vector3; radius: number; height: number }): PetalFall` avec `interface PetalFall { group: THREE.Group; update(dt: number): void; dispose(): void }`

Braises, lucioles et pollen : des points additifs pour meubler le vide entre les sprites. `apply(mood)` lit `motes` et `fireflies` — le pollen est diurne, les lucioles nocturnes.

- [ ] **Step 1: Écrire le test qui échoue**

```ts
// packages/hd2d/test/particles.test.ts
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createHd2dContext } from "../src/context.js";
import { createParticleField } from "../src/particles.js";

const moodLike = (motes: number, fireflies: number) =>
  ({ motes, fireflies }) as unknown as Parameters<ReturnType<typeof createParticleField>["apply"]>[0];

describe("createParticleField", () => {
  it("éteint les lucioles le jour et le pollen la nuit", () => {
    const ctx = createHd2dContext();
    const champ = createParticleField(ctx, { firePosition: new THREE.Vector3(), worldRadius: 22 });

    champ.apply(moodLike(0.5, 0));
    const jour = champ.group.children.map((c) => c.visible);
    champ.apply(moodLike(0, 1));
    const nuit = champ.group.children.map((c) => c.visible);

    // Le jour et la nuit ne montrent pas les mêmes nuages de points.
    expect(jour).not.toEqual(nuit);
  });

  it("avance sans jamais laisser filer un point hors du monde", () => {
    const ctx = createHd2dContext();
    const champ = createParticleField(ctx, { firePosition: new THREE.Vector3(), worldRadius: 10 });
    champ.apply(moodLike(0.5, 1));
    for (let k = 0; k < 600; k++) champ.update(1 / 60);

    for (const enfant of champ.group.children) {
      const pos = (enfant as THREE.Points).geometry?.getAttribute("position");
      if (!pos) continue;
      for (let n = 0; n < pos.count; n++) {
        expect(Math.hypot(pos.getX(n), pos.getZ(n))).toBeLessThanOrEqual(10 * 1.5);
      }
    }
  });

  it("libère ses géométries au dispose", () => {
    const ctx = createHd2dContext();
    const champ = createParticleField(ctx, { firePosition: new THREE.Vector3(), worldRadius: 10 });
    champ.dispose();
    expect(champ.group.children).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Lancer le test pour le voir échouer**

Run: `npx vitest run --project hd2d test/particles.test.ts`
Expected: FAIL — module introuvable

- [ ] **Step 3: Porter `particles.ts`**

Port de `~/git/poc-hd-2d/src/world/particles.js` (`createParticles`, `createPetals`), avec le contexte en argument et le typage. Le recyclage des points doit rester borné au rayon du monde — c'est ce que pin le deuxième test.

- [ ] **Step 4: Lancer les tests pour les voir passer**

Run: `npx vitest run --project hd2d && npm run typecheck:hd2d`
Expected: PASS — toute la suite du projet `hd2d`, y compris les tests des tasks précédentes.

- [ ] **Step 5: Commit**

```bash
git add packages/hd2d
git commit -m "feat(hd2d): braises, lucioles, pollen et pétales"
```

---

### Task 11: Le labo — le monde jouable

**Files:**
- Create: `apps/lab/src/settings.ts`, `apps/lab/src/world/island.ts`, `apps/lab/src/world/terrain-query.ts`, `apps/lab/src/world/colliders.ts`, `apps/lab/src/world/hero.ts`, `apps/lab/src/core/input.ts`, `apps/lab/scripts/sync-assets.sh`
- Create: `apps/lab/public/**` (assets)
- Modify: `apps/lab/src/main.ts`

**Interfaces:**
- Consumes: tout `@lindocara/hd2d`
- Produces (internes au labo) :
  - `generateIsland(opts: { size: number; seed: number }): { field: HeightField; query: TerrainQuery }`
  - `interface TerrainQuery { heightAt(wx: number, wz: number): number | null; maxHeightAround(wx: number, wz: number, r: number): number; levelAt(wx: number, wz: number): number | null; cellCenter(i: number, j: number): [number, number] }`
  - `createColliders(): Colliders` — grille spatiale, `add(x, z, r)`, `blocked(x, z, r)`
  - `createHero(query, colliders, spawn): Hero`
  - `createInput(canvas, handlers): Input`

Jalon : **on marche, on saute, on tombe, on nage, on se noie.** Pas encore de props, pas de PNJ, pas de son.

- [ ] **Step 1: Rapatrier les assets**

Copier `~/git/poc-hd-2d/public/` vers `apps/lab/public/` (4,8 Mo, 94 fichiers) et `~/git/poc-hd-2d/assets/generated/`, `assets/voices/`, `assets/sounds/` vers `apps/lab/assets/`. Les trois packs Tiny Swords ne sont **pas** recopiés : `packages/catalog/assets/` les a déjà.

Porter `scripts/sync-assets.sh` en `apps/lab/scripts/sync-assets.sh`, avec `SRC`/`FREE`/`ENEMY` pointant vers `packages/catalog/assets/…` et `SFX` vers `${LAB_SFX_PACK:?le pack SFX (371 Mo) est hors dépôt — pointer LAB_SFX_PACK dessus}`. Reprendre l'entête du PoC : rien ne se copie à la main dans `public/`, ajouter un asset = ajouter une ligne au script.

Ajouter à `.gitignore` : rien de nouveau — le pack SFX n'entre jamais dans ce dépôt.

- [ ] **Step 2: Porter les réglages du monde**

`apps/lab/src/settings.ts` reçoit ce que `hd2d/config.ts` n'a pas pris : `WORLD`, `CAMERA`, `HERO`, `GROTA`, `MOODS`, `WATER`, `SUN_DRIFT`, `MOOD_FADE`, `TARGET_FPS`, et le catalogue `TEXTURE_URLS` avec son drapeau `atlas` par entrée (les cinq tilesets et l'écume à `true`).

- [ ] **Step 3: Porter la génération d'île et les requêtes de terrain**

De `~/git/poc-hd-2d/src/world/terrain.js` : `mulberry32`, `makeHeightmap`, la propagation de distance à l'eau, `estSable`, et les méthodes de requête (`heightAt`, `maxHeightAround`, `levelAt`, `kindAt`, `cellCenter`). `generateIsland` renvoie un `HeightField` que `meshTerrain` consomme, plus la `TerrainQuery` que le héros consomme.

`maxHeightAround` garde son commentaire et sa règle : tester un point laisserait le corps s'enfoncer de sa demi-largeur dans les falaises ; **l'eau compte pour son propre niveau** — c'est une surface où l'on nage, pas un mur — et le hors-carte non plus n'est pas un mur, c'est le souffle qui ramène.

- [ ] **Step 4: Porter les colliders et le héros**

`~/git/poc-hd-2d/src/world/collision.js` puis `src/world/hero.js`, verbatim, typés. Les règles à ne pas perdre (elles seront la base de S2) :

- **`maxStep = 0`**, saut à 1.35 unité — un palier avec de la marge, jamais deux — coyote time 120 ms ;
- **empreinte décalée vers le fond** (`HERO.offset`), rayon sous la demi-case ;
- **chaque axe testé séparément** : on glisse au lieu de coller ;
- **un déplacement est accepté s'il est valide OU s'il n'aggrave pas un chevauchement déjà présent** — sans quoi, atterrir au pied d'une falaise cimente le héros sur place. Le sol sous le centre n'est jamais assoupli ;
- **nage** : 45 % de vitesse, pas de saut, 11 s de souffle, noyade et réapparition au point de départ ; on se hisse sur une rive de plain-pied seulement.

- [ ] **Step 5: Assembler `main.ts`**

Port de la partie « monde + caméra + boucle » de `~/git/poc-hd-2d/src/main.js` : chargement pesé (85 % téléchargement / 15 % décodage), construction, la boucle `frame()` avec son plafond à `TARGET_FPS`, `updateCamera` (suivi amorti exponentiel, look-ahead, yaw qui revient seul, secousse appliquée APRÈS le cadrage, dérive d'azimut du soleil, brouillard qui suit le zoom asymétriquement), et le `setFocusY` du tilt-shift sur la position écran du héros.

Le bouton JOUER lève l'écran de chargement et donne le focus au canvas ; l'audio arrive à la Task 12.

- [ ] **Step 6: Vérifier à l'écran**

Run: `npm run lab`

Avec la skill `playwright-cli` (jamais l'extension Chrome), vérifier :

- l'île se construit, éclairée, avec ses bordures autotilées et ses parois ;
- ZQSD déplace le héros, espace le fait sauter, il retombe ;
- entrer dans l'eau met à la nage : ralenti, saut sans effet, jauge de souffle qui descend ;
- à zéro, noyade et réapparition au point de départ ;
- `N` bascule jour/nuit en fondu ;
- molette = zoom, clic droit + glisser = pivot qui revient seul ;
- le compteur affiche 60 fps.

Mesurer aussi le temps GPU réel par la méthode `readPixels` du `CLAUDE.md` du PoC, et **noter le chiffre dans le message de commit**.

- [ ] **Step 7: Commit**

```bash
git add apps/lab
git commit -m "feat(lab): l'île jouable — terrain, collision, saut, nage, caméra"
```

---

### Task 12: Le labo — la scène complète

**Files:**
- Create: `apps/lab/src/world/props.ts`, `sheep.ts`, `npc.ts`, `chest.ts`, `house.ts`, `interior.ts`, `debug.ts`, `apps/lab/src/core/audio.ts`, `apps/lab/src/core/dialog.ts`
- Modify: `apps/lab/src/main.ts`

**Interfaces:**
- Consumes: `@lindocara/hd2d`, la `TerrainQuery` et les `Colliders` de la Task 11

- [ ] **Step 1: Porter les props, le troupeau et le décor**

`~/git/poc-hd-2d/src/world/props.js` et `sheep.js`. Les pièges à ne pas réintroduire :

- **toutes les frames d'une feuille ne sont pas une animation** : celle de l'arbre contient le balancement (4 frames), la réaction quand on l'abat, et la souche ; les buissons sont rembourrés de doublons de la première frame. Les compteurs mesurés du PoC sont dans la source, les reprendre tels quels ;
- **rafales de vent** : la phase d'oscillation se déduit de la position, la bourrasque traverse l'île ;
- **le foyer ne projette qu'une fois la nuit tombée** — une lumière ponctuelle qui projette, c'est six rendus de la scène, et l'ombre ne se lit pas en plein jour ;
- **la portée d'une lumière ponctuelle est une coupure** : portée doublée et décroissance physique (2), sinon le foyer trace un cerne net au sol à seize unités de lui ;
- **deux couches de halo à poids égal** : donner le dessus à la petite lui rend son statut de tache principale et le « gros rond » revient ;
- **les moutons** : errance sur leur palier, demi-tour plutôt que la chute à l'eau, quatre prises de bêlement, +1.5 demi-ton par clic, explosion au quatrième.

- [ ] **Step 2: Porter Grota, le coffre, la maison et l'intérieur**

`npc.js`, `chest.js`, `house.js`, `interior.js`. Grota est sur le mamelon de la petite île du sud — celle qu'on n'atteint qu'à la nage. Il porte un collider. La maison se place au centre d'une zone plate cherchée par anneaux, son empreinte entre dans la grille comme n'importe quel prop, et l'intérieur vit très loin de la carte, caché tant qu'on n'y est pas entré, avec un fondu de 280 ms de part et d'autre du déplacement.

- [ ] **Step 3: Porter l'audio**

`~/git/poc-hd-2d/src/core/audio.js`. Ce qui compte :

- le contexte **naît suspendu** : c'est ce qui permet de tout décoder pendant le chargement et de n'avoir qu'à le réveiller au clic sur JOUER ;
- **pas cadencés à la distance parcourue** (un tous les 1.2 unité), pas au temps — la cadence suit alors la vitesse et ne se dérègle pas ;
- **l'attaque part 30 ms après l'appui**, avant la sortie de lame : ces échantillons n'ont aucun transitoire, ils enflent pendant 170 ms jusqu'à une crête, et c'est la crête que l'oreille prend pour le coup ;
- chaque déclenchement tire **une variante ET une hauteur** au hasard, sinon cinq échantillons en boucle s'entendent au bout de dix secondes ;
- la **voix de Grota** ne passe pas par `jouer()` : pas de variante, pas de hauteur aléatoire ;
- **aucune piste de musique** n'est livrée (les arrangements essayés étaient sous droits), mais toute la mécanique reste : fondu croisé jour/nuit, entrée à 10 s, fondu de 6 s, pause de 30 s, un seul arrangement à la fois.

- [ ] **Step 4: Porter le dialogue**

`~/git/poc-hd-2d/src/core/dialog.js`. **C'est la voix qui donne le tempo** : `sayLine()` renvoie la durée de la prise et le bandeau en déduit sa cadence de frappe (`longueur / durée`), le texte s'achevant à 88 % de la prise. Sans prise décodée, cadence fixe. Le « toc » de validation ne sonne qu'au **passage** d'une réplique à la suivante — pas au rattrapage, pas à la fermeture. Deux lignes réservées d'avance (3.3em), sinon le nom sursaute en pleine frappe.

- [ ] **Step 5: Porter le mode debug**

`debug.js` : contour vert des cases praticables, arêtes rouges des marches infranchissables avec leur montant vertical, cercles orange des props, empreinte du héros. Touche `B`.

- [ ] **Step 6: Vérifier à l'écran**

Run: `npm run lab`, puis avec `playwright-cli` :

- la scène complète est là : arbres, buissons, décor, feu de camp, rochers, moutons, coffre, maison, cerisier, intérieur ;
- `F` près de Grota ouvre le bandeau, la voix part, le texte se cale sur elle, `F` déroule, `échap` coupe ;
- s'éloigner referme le bandeau ;
- un clic sur un mouton le fait bêler de plus en plus aigu ; au quatrième il éclate et la caméra tremble ;
- entrer dans la maison fond au noir puis rouvre à l'intérieur ;
- `B` montre les volumes, `H` masque l'aide, `M` répond « aucune piste » ;
- 60 fps tenus, y compris de nuit avec l'ombre du foyer.

Comparer une capture jour et une capture nuit à `~/git/poc-hd-2d/docs/day.png` et `night.png`.

- [ ] **Step 7: Commit**

```bash
git add apps/lab
git commit -m "feat(lab): la scène complète — props, troupeau, Grota, maison, son, dialogue"
```

---

### Task 13: Le harnais de charge, la parité visuelle et la documentation

**Files:**
- Create: `apps/lab/src/bench.ts`, `packages/hd2d/AGENTS.md`, `apps/lab/AGENTS.md`
- Modify: `apps/lab/src/main.ts`, `CLAUDE.md`

**Interfaces:**
- Produces: `createBench(ctx, scene, opts: { level: BenchLevel }): Bench` avec `type BenchLevel = "off" | "game" | "heavy"` et `interface Bench { populate(): void; clear(): void; measure(render: () => void, gl: WebGL2RenderingContext): Promise<number> }`

C'est le vrai inconnu du chantier : le PoC affiche un héros, une trentaine de props et une île ; le jeu affiche quatre joueurs, des monstres, des projectiles, des effets de combat, du butin et une carte entière. Découvrir un budget GPU insuffisant en S3 coûterait très cher.

- [ ] **Step 1: Écrire le harnais**

`createBench` peuple la scène au niveau du jeu, en billboards animés partageant les textures déjà chargées :

| Population | `game` | `heavy` | Pourquoi ce chiffre |
| --- | --- | --- | --- |
| joueurs | 4 | 4 | le plafond d'une partie |
| monstres | 40 | 90 | rayon d'intérêt monstres 850 px ≈ 13 cases |
| gardes | 8 | 16 | patrouilles de zone sûre |
| butin au sol | 30 | 70 | rayon butin 650 px |
| corps | 4 | 12 | un corps par joueur, plus la marge |
| projectiles | 12 | 30 | flèches et sorts en vol |
| effets de combat | 6 | 20 | impacts, soins, portails |
| sources ponctuelles projetant | 1 | 4 | six rendus de scène chacune |

`measure()` reprend la méthode du `CLAUDE.md` du PoC : un `render()` d'amorçage, un `readPixels` pour vider le pipe, puis 40 `render()` encadrés par un second `readPixels` qui bloque jusqu'au GPU, et la moyenne en ms/frame.

Le niveau se choisit par `?bench=game` / `?bench=heavy` dans l'URL, et le résultat s'affiche dans le HUD à côté du compteur de fps.

- [ ] **Step 2: Mesurer et consigner**

Run: `npm run lab` puis ouvrir `?bench=game` et `?bench=heavy`.

Relever pour chacun : ms/frame de jour, ms/frame de nuit (le foyer projette, c'est le pire cas), et le nombre d'appels de dessin (`renderer.info.render.calls`).

**Si `game` ne tient pas les 16,7 ms, c'est un résultat, pas un bug : arrêter et remonter le chiffre.** Le budget GPU décide de la forme de S3 ; le découvrir maintenant est précisément la raison d'être de cette task.

- [ ] **Step 2 bis: Mesurer le poids du bundle**

L'autre chiffre que le spec du reboot demande de relever en S1 : Three.js pèse plus que PixiJS, et l'écart n'a jamais été mesuré sur ce projet.

Run: `npm run build -w @lindocara/lab`

Relever le poids **gzip** du chunk JavaScript principal de `apps/lab/dist/`, et le comparer à celui du bundle actuel du jeu :

```bash
npm run build -w @lindocara/lab
find apps/lab/dist/assets -name '*.js' -exec sh -c 'printf "%s\t" "$1"; gzip -c "$1" | wc -c' _ {} \;
```

Consigner les deux chiffres dans le message de commit. Si l'écart dépasse 300 ko gzip, le remonter : trois-quatre modules d'addons de post-traitement peuvent se remplacer par du GLSL maison, mais c'est un arbitrage à faire avec le chiffre sous les yeux, pas par principe.

- [ ] **Step 3: Écrire `packages/hd2d/AGENTS.md`**

Y consigner, en une page :

- la frontière : `hd2d` ne connaît ni lindocara ni son protocole ; sa seule dépendance est `three` ;
- l'interdiction d'état mutable au niveau module, et le rôle de `Hd2dContext` ;
- la convention de commentaires en français, portés du PoC, et pourquoi (ils consignent des mesures et des pièges) ;
- le projet vitest en `node` et ce qui n'est donc pas testable unitairement ;
- le renvoi vers `~/git/poc-hd-2d/README.md` comme registre des pièges, avec la liste courte de ceux qui coûtent le plus cher à redécouvrir (cible MSAA dédiée, étalonnage après `OutputPass`, `shadowSide: DoubleSide`, `alphaTest: 0.5`, atlas sans mipmaps, appoint de lumière émissif modulé par la texture, contre-jour cantonné à son calque).

- [ ] **Step 4: Écrire `apps/lab/AGENTS.md`**

Le rôle du labo : un témoin, pas une copie figée. Il consomme les mêmes packages que le jeu, donc une expérimentation qui y marche marche dans le jeu. Les commandes, `?bench=`, `window.lab` (l'équivalent de `window.poc`), la discipline d'assets (`sync-assets.sh`, le pack SFX hors dépôt, `LAB_SFX_PACK`).

- [ ] **Step 5: Mettre à jour `CLAUDE.md`**

Ajouter `@lindocara/hd2d` et `apps/lab` au tableau du monorepo avec leurs liens `AGENTS.md`, ajouter `npm run lab` au tableau des commandes, ajouter `typecheck:hd2d` / `typecheck:lab` / `test:hd2d`, et une ligne dans « Gotchas » sur l'état de module interdit dans `hd2d` et pourquoi.

Ajouter aussi une phrase renvoyant au spec du reboot : le rendu du jeu reste sur PixiJS jusqu'à S3, et `hd2d` n'est pour l'instant consommé que par le labo.

- [ ] **Step 6: Vérifier**

Run: `npm run check`
Expected: catalogue, cartes, lint, typecheck et tous les projets vitest passent.

- [ ] **Step 7: Commit**

```bash
git add apps/lab packages/hd2d CLAUDE.md
git commit -m "feat(lab): harnais de charge, et documentation du package hd2d"
```

---

## Ce que S1 ne fait pas

- Ne touche ni `@lindocara/renderer`, ni `client`, ni `editor`, ni `server`. Le jeu tourne encore sur PixiJS.
- Ne porte pas le modèle de carte dans `engine` : `HeightField` est une interface de rendu, et la génération d'île comme les requêtes de collision vivent au labo. C'est S2 qui les remonte dans `engine`, autoritatives et partagées avec la prédiction.
- Ne déploie rien. Le labo tourne en local (`npm run lab`).
