import * as THREE from "three";

import { DEFAULT_CONFIG, type Hd2dConfig } from "./config.js";

/**
 * Uniformes de l'ombre des nuages (Task 6, `clouds.ts`). Le PoC les gardait en objet de MODULE,
 * partagé par tous les matériaux patchés de la page — une seule scène possible. Ici ils vivent sur
 * le contexte comme le yaw et les registres de billboards : le jeu et l'éditeur ouvrent chacun le
 * leur, et faire dériver les nuages de l'un ne doit pas faire dériver ceux de l'autre.
 */
export interface CloudUniforms {
  uCloudMap: { value: THREE.Texture | null };
  uCloudOffset: { value: THREE.Vector2 };
  uCloudScale: { value: number };
  uCloudStrength: { value: number };
  uCloudSoftness: { value: number };
}

/**
 * Texel neutre 1x1, noir. `applyCloudShadow` échantillonne `uCloudMap` dans TOUT matériau greffé,
 * y compris avant qu'un `createCloudCover` existe : un sampler2D nul est indéfini en GLSL et peut
 * faire virer la scène au noir. Le noir est le neutre pour
 * `smoothstep(0.5-s, 0.5+s, 0.0)` — il vaut 0, donc le multiplicateur d'albédo vaut 1 et l'ombre ne
 * change rien tant que personne n'a posé la vraie carte. Une `DataTexture` ne demande aucun canvas,
 * donc reste compatible avec le projet vitest `node` — contrairement à la carte réelle, qui en
 * dessine une.
 */
// Exportée (pas seulement interne) : `clouds.ts` la réutilise pour reposer `uCloudMap` sur ce même
// neutre quand `CloudCover.dispose()` libère la carte qu'il avait construite. Une seconde
// définition du « neutre » ailleurs finirait par diverger — et la polarité (noir, pas blanc) est
// justement ce qui est facile à inverser sans que rien ne le signale.
export function neutralCloudTexture(): THREE.DataTexture {
  const texture = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  texture.needsUpdate = true;
  return texture;
}

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
  /** Plongée initiale de la caméra, si ce contexte possède une caméra orbitale. */
  pitch?: number;
}

type BillboardRegistration =
  | { lit: false; onPitch?: (pitch: number) => void }
  | {
      lit: true;
      material: THREE.MeshLambertMaterial;
      mid: number | (() => number);
      onPitch?: (pitch: number) => void;
    };

export interface Hd2dContext {
  readonly config: Hd2dConfig;
  /** Uniformes de l'ombre des nuages de CE contexte (Task 6, `clouds.ts`) — jamais partagés entre
   *  deux contextes. */
  readonly cloudUniforms: CloudUniforms;
  yaw(): number;
  setYaw(yaw: number): void;
  pitch(): number | null;
  setPitch(pitch: number): void;
  registerBillboard(mesh: THREE.Mesh, opts: BillboardRegistration): void;
  /** Retire un mesh des DEUX registres (tous, éclairés). Sans ça, un billboard disposé reste dans
   *  `tous` pour toujours : `setYaw` continue de tourner un mesh détruit à chaque rotation de
   *  caméra, et un futur lecteur de `litBillboards()` toucherait le `.emissive` d'un matériau
   *  libéré. Désinscrire un mesh jamais inscrit ne fait rien — ce n'est pas une erreur, une
   *  disparition peut survenir avant tout enregistrement (ex. échec de chargement de texture). */
  unregisterBillboard(mesh: THREE.Mesh): void;
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
  // Un merge superficiel sur DEFAULT_CONFIG partagerait ses sous-objets (postfx.bloom,
  // cloudShadow.drift, ...) par référence entre TOUS les contextes qui ne les surchargent pas —
  // muter l'un corromprait l'autre, et DEFAULT_CONFIG lui-même, pour la durée du process. Cloner
  // avant de fusionner donne à chaque contexte ses propres sous-objets, même non surchargés.
  const defaults = structuredClone(DEFAULT_CONFIG);
  const config: Hd2dConfig = {
    ...defaults,
    ...options.config,
    render: { ...defaults.render, ...options.config?.render },
    postfx: { ...defaults.postfx, ...options.config?.postfx },
    cloudShadow: { ...defaults.cloudShadow, ...options.config?.cloudShadow },
  };

  // Tous les sprites regardent la même direction : celle de la caméra. Dès qu'elle pivote, ils
  // doivent pivoter avec, sinon on les voit par la tranche.
  const tous: THREE.Mesh[] = [];
  const eclaires: LitBillboard[] = [];
  const adaptationsPlongee = new Map<THREE.Mesh, (pitch: number) => void>();
  let courant = 0;
  let plongee = Number.isFinite(options.pitch) ? (options.pitch ?? null) : null;

  // Un objet FRAIS par contexte : le PoC en faisait une constante de module, partagée par toute la
  // page. `uCloudStrength` (0.34) n'est pas configurable ailleurs — c'est déjà ainsi dans le PoC —
  // `uCloudScale`/`uCloudSoftness` partent en revanche de la config de CE contexte.
  //
  // `neutre` reste à part de `cloudUniforms.uCloudMap.value` : `createCloudCover` (`clouds.ts`)
  // remplace ce dernier par sa propre carte construite, et le repose sur CE MÊME texel neutre à son
  // `dispose()` plutôt que d'en fabriquer un nouveau. `dispose()` ci-dessous doit donc libérer la
  // ressource GPU que LE CONTEXTE a allouée — `neutre` — jamais ce qui se trouve accidentellement
  // dans `uCloudMap.value` au moment de l'appel (une carte de nuages encore vivante, si aucun
  // `CloudCover` n'a été disposé avant le contexte).
  const neutre = neutralCloudTexture();
  const cloudUniforms: CloudUniforms = {
    uCloudMap: { value: neutre },
    uCloudOffset: { value: new THREE.Vector2(0, 0) },
    uCloudScale: { value: config.cloudShadow.scale },
    uCloudStrength: { value: 0.34 },
    uCloudSoftness: { value: config.cloudShadow.softness },
  };

  return {
    config,
    cloudUniforms,
    yaw: () => courant,
    setYaw(yaw) {
      if (yaw === courant) return;
      courant = yaw;
      for (const m of tous) m.rotation.y = yaw;
    },
    pitch: () => plongee,
    setPitch(pitch) {
      if (!Number.isFinite(pitch) || pitch === plongee) return;
      plongee = pitch;
      for (const adapt of adaptationsPlongee.values()) adapt(pitch);
    },
    registerBillboard(mesh, opts) {
      // Un sprite né pendant une rotation doit adopter le yaw courant, pas zéro.
      mesh.rotation.y = courant;
      tous.push(mesh);
      if (opts.onPitch) {
        adaptationsPlongee.set(mesh, opts.onPitch);
        if (plongee !== null) opts.onPitch(plongee);
      }
      // Le matériau vient de l'appelant plutôt que d'un cast de `mesh.material` : rien ici ne
      // garantit qu'un mesh enregistré porte un `MeshLambertMaterial` (le type de `mesh.material`
      // est une union three), donc c'est à `makeBillboard`, qui construit lui-même le matériau
      // éclairé, de le passer explicitement.
      if (opts.lit) {
        const midpoint = opts.mid;
        eclaires.push({
          mesh,
          material: opts.material,
          get mid() {
            return typeof midpoint === "function" ? midpoint() : midpoint;
          },
        });
      }
    },
    unregisterBillboard(mesh) {
      const i = tous.indexOf(mesh);
      if (i !== -1) tous.splice(i, 1);
      const j = eclaires.findIndex((b) => b.mesh === mesh);
      if (j !== -1) eclaires.splice(j, 1);
      adaptationsPlongee.delete(mesh);
    },
    billboards: () => tous,
    litBillboards: () => eclaires,
    dispose() {
      tous.length = 0;
      eclaires.length = 0;
      adaptationsPlongee.clear();
      // Revue finale (point E3) : c'était le seul `dispose()` du package à ne pas rendre ce qu'il
      // avait pris — le texel neutre alloué ci-dessus restait en mémoire GPU indéfiniment.
      neutre.dispose();
    },
  };
}
