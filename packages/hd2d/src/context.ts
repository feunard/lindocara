import type * as THREE from "three";
import { DEFAULT_CONFIG, type Hd2dConfig } from "./config.js";

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
  registerBillboard(
    mesh: THREE.Mesh,
    opts: { lit: false } | { lit: true; material: THREE.MeshLambertMaterial; mid: number },
  ): void;
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
      // Le matériau vient de l'appelant plutôt que d'un cast de `mesh.material` : rien ici ne
      // garantit qu'un mesh enregistré porte un `MeshLambertMaterial` (le type de `mesh.material`
      // est une union three), donc c'est à `makeBillboard`, qui construit lui-même le matériau
      // éclairé, de le passer explicitement.
      if (opts.lit) {
        eclaires.push({ mesh, material: opts.material, mid: opts.mid });
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
