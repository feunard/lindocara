import { type Billboard, makeBillboard } from "@lindocara/hd2d/billboard.js";
import type { Hd2dContext } from "@lindocara/hd2d/context.js";
import type { HeightField } from "@lindocara/hd2d/terrain/field.js";
import type { TextureRegistry } from "@lindocara/hd2d/textures.js";
import * as THREE from "three";
import { closeChest, openChest } from "../core/audio.js";
import { CAMERA } from "../settings.js";
import type { Colliders } from "./colliders.js";
import type { TerrainQuery } from "./terrain-query.js";

// Les deux sprites partagent un canevas de 80x80, coffre calé en bas : ouvrir
// ne le fait donc pas sauter, seul le couvercle dépasse plus haut.
// TAILLE/FOOT exportées : `bench.ts` (Task 13) réutilise `chest-closed.png` comme butin au sol et
// doit poser le même cadrage, pas une valeur recopiée à la main qui pourrait diverger sans test.
export const TAILLE = 1.15; // hauteur monde d'une frame
export const FOOT = 0.02; // le coffre touche le bas de son canevas
const RAYON = 0.42; // empreinte au sol
const PORTEE = 1.9; // distance à laquelle on peut l'ouvrir

export interface Chest {
  group: THREE.Group;
  /** À portée, on peut agir : ouvrir s'il est fermé, refermer sinon. */
  readonly canInteract: boolean;
  readonly canOpen: boolean;
  readonly isOpen: boolean;
  /** Bascule le couvercle. Renvoie le nouvel état. */
  toggle(): boolean;
  update(heroPosition: THREE.Vector3): void;
}

/**
 * Le coffre du sommet. Deux sprites superposés dont on bascule la visibilité :
 * plus simple et plus sûr que d'échanger la texture d'un matériau, et les deux
 * frames n'ont pas la même hauteur.
 */
export function createChest(
  ctx: Hd2dContext,
  textures: TextureRegistry,
  field: HeightField,
  query: TerrainQuery,
  colliders: Colliders,
): Chest {
  const group = new THREE.Group();

  // Le point le plus haut de la carte, au nord : on cherche la case du palier
  // maximal la plus proche du centre de ce sommet.
  const size = field.cols;
  let meilleur: { x: number; z: number; score: number } | null = null;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const h = field.levelAt(i, j);
      if (h === null || h < 2) continue;
      const [x, z] = query.cellCenter(i, j);
      if (z > 0) continue; // au nord uniquement
      // On veut être entouré de sol : pas au bord de la falaise.
      let entoure = true;
      for (const [di, dj] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const)
        if (field.levelAt(i + di, j + dj) !== h) entoure = false;
      if (!entoure) continue;
      const score = Math.hypot(x - 7.5, z + 7.5);
      if (!meilleur || score < meilleur.score) meilleur = { x, z, score };
    }
  }
  // Repli : si le relief change et qu'aucun sommet ne convient, on ne pose rien
  // plutôt que de faire flotter un coffre au hasard.
  if (!meilleur) {
    return {
      group,
      get canInteract() {
        return false;
      },
      get canOpen() {
        return false;
      },
      get isOpen() {
        return false;
      },
      toggle() {
        return false;
      },
      update() {},
    };
  }

  const { x, z } = meilleur;
  const y = query.heightAt(x, z) ?? 0;

  const sprites: Record<"ferme" | "ouvert", Billboard> = {
    ferme: makeBillboard(ctx, {
      texture: textures.get("/tex/chest-closed.png"),
      height: TAILLE,
      aspect: 1,
      foot: FOOT,
      pitch: CAMERA.pitch,
    }),
    ouvert: makeBillboard(ctx, {
      texture: textures.get("/tex/chest-open.png"),
      height: TAILLE,
      aspect: 1,
      foot: FOOT,
      pitch: CAMERA.pitch,
    }),
  };
  for (const etat of ["ferme", "ouvert"] as const) {
    const billboard = sprites[etat];
    billboard.placeAt(x, y, z);
    billboard.mesh.visible = etat === "ferme";
    group.add(billboard.mesh);
  }

  colliders.add(x, z, RAYON);

  let ouvert = false;
  let aPortee = false;

  return {
    group,
    get canInteract() {
      return aPortee;
    },
    get canOpen() {
      return aPortee && !ouvert;
    },
    get isOpen() {
      return ouvert;
    },
    toggle() {
      if (!aPortee) return ouvert;
      ouvert = !ouvert;
      sprites.ferme.mesh.visible = !ouvert;
      sprites.ouvert.mesh.visible = ouvert;
      if (ouvert) openChest();
      else closeChest();
      return ouvert;
    },
    update(heroPosition) {
      const d = Math.hypot(heroPosition.x - x, heroPosition.z - z);
      aPortee = d <= PORTEE && Math.abs(heroPosition.y - y) < 1.5;
    },
  };
}
