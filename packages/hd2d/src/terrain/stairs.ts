import * as THREE from "three";
import type { TerrainAtlas } from "./atlas.js";
import { blockOrigin, CLIFF_EDGE_COL, tileUV } from "./atlas.js";
import { AO_WALL, AO_WALL_HEIGHT } from "./field.js";
import { tintAt } from "./mesh.js";

export interface StairRampGeometry {
  x: number;
  z: number;
  width: number;
  depth: number;
  direction: "east" | "west" | "north" | "south";
  lowLevel: number;
}

export interface MeshStairsOptions {
  levelHeight: number;
  /**
   * L'atlas d'un palier donné. Une fonction, et non un atlas unique, parce que l'herbe lit sa
   * feuille dans son ALTITUDE — le pack en livre cinq teintes — et qu'une rampe qui monte du palier
   * 1 au 2 dessinée avec la feuille du palier 0 est du mauvais vert. Chaque rampe demande le palier
   * vers lequel elle monte : c'est le plateau dont on descend, donc la teinte à laquelle l'œil
   * compare la pente.
   */
  atlasFor(level: number): TerrainAtlas;
  color?: THREE.ColorRepresentation;
  opacity?: number;
  lift?: number;
}

/** La tuile de remplissage plein du bloc de cet atlas — la case « tous voisins identiques » du
 *  4x4 (voir `EDGE16_LUT` côté engine : masque 15 = colonne 1, ligne 1). C'est elle qui fait lire
 *  la pente comme du SOL, et non comme un objet posé dessus. */
function fillUV(atlas: TerrainAtlas) {
  return tileUV(atlas, (blockOrigin(atlas) ?? 0) + 1, 1);
}

/** Le milieu de la bande de paroi à pied de terre : le flanc d'une rampe est toujours entre deux
 *  berges, jamais face à la mer. */
function cheekUV(atlas: TerrainAtlas) {
  return tileUV(atlas, CLIFF_EDGE_COL + 1, atlas.wallRow);
}

type Vec2 = readonly [number, number];
type Vec3 = readonly [number, number, number];

/**
 * Accumulateur de quads, même forme que celui de `mesh.ts` : la couleur d'un sommet n'est connue
 * qu'au `build()`, parce qu'elle mêle la teinte procédurale (fonction de la position monde) et
 * l'occlusion propre à ce sommet.
 */
function quadBuilder() {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const occ: number[] = [];
  const idx: number[] = [];
  return {
    quad(
      corners: readonly [Vec3, Vec3, Vec3, Vec3],
      normal: Vec3,
      uvs: readonly [Vec2, Vec2, Vec2, Vec2],
      ao: readonly [number, number, number, number],
    ): void {
      const o = pos.length / 3;
      for (const v of corners) {
        pos.push(v[0], v[1], v[2]);
        nor.push(normal[0], normal[1], normal[2]);
      }
      for (const t of uvs) uv.push(t[0], t[1]);
      for (const k of ao) occ.push(k);
      idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
    },
    build(): THREE.BufferGeometry {
      const col: number[] = [];
      for (let v = 0; v < occ.length; v++) {
        const t = tintAt(pos[v * 3] ?? 0, pos[v * 3 + 2] ?? 0);
        const k = occ[v] ?? 1;
        col.push(t[0] * k, t[1] * k, t[2] * k);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
      geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
      geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
      geo.setIndex(idx);
      return geo;
    },
  };
}

/**
 * Une rampe : une pente CONTINUE, pas une pile de marches.
 *
 * L'asset officiel (`Tilemap_color*.png`, colonnes 0 et 3, lignes 4-5) est un ruban 64x128 dessiné
 * DE PROFIL, moitié transparent — une élévation, faite pour être collée contre une paroi dans un
 * jeu en 2D. La version précédente le découpait en huit et l'étalait sur le dessus de huit boîtes :
 * mauvaise projection, d'où le résultat. Et la collision, elle, échantillonnait déjà une pente
 * lisse (`rampSampleAt`, `engine/hd2d/terrain-query.ts`) — le rendu contredisait le sol sur lequel
 * le héros marchait vraiment.
 *
 * On construit donc la pente que la collision décrit déjà, avec la MÊME convention de progression :
 * `east` monte vers +x, `west` vers -x. Le dessus porte la tuile de remplissage de sa berge, les
 * deux flancs la paroi de falaise, et l'ensemble reçoit la teinte et l'assombrissement de pied du
 * terrain qui l'entoure — sinon la rampe se lit comme une pièce rapportée.
 */
export function meshStairs(
  ramps: readonly StairRampGeometry[],
  options: MeshStairsOptions,
): { group: THREE.Group; dispose(): void } {
  const group = new THREE.Group();
  group.name = "terrain-stairs";
  const opacity = options.opacity ?? 1;
  const lift = options.lift ?? 0.006;
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];

  for (const ramp of ramps) {
    const atlas = options.atlasFor(ramp.lowLevel + 1);
    const lowY = ramp.lowLevel * options.levelHeight + lift;
    const highY = (ramp.lowLevel + 1) * options.levelHeight + lift;
    // The slope runs along ONE axis and is flat across the other. `alongX` says which, so the
    // geometry below is written once in "along/across" terms instead of twice in x and z. The foot
    // of the slope is at the axis's negative end when the ramp climbs positive, and the reverse
    // otherwise: `east` and `south` climb toward +x and +z, `west` and `north` back down them.
    const alongX = ramp.direction === "east" || ramp.direction === "west";
    const climbsPositive = ramp.direction === "east" || ramp.direction === "south";
    const startY = climbsPositive ? lowY : highY;
    const endY = climbsPositive ? highY : lowY;
    const x0 = ramp.x;
    const x1 = ramp.x + ramp.width;
    const z0 = ramp.z;
    const z1 = ramp.z + ramp.depth;
    const alongSpan = alongX ? ramp.width : ramp.depth;
    const alongOrigin = alongX ? x0 : z0;
    const acrossSpan = alongX ? ramp.depth : ramp.width;

    // Assombrissement de pied, identique à celui des parois : maximal au ras de la berge basse,
    // dissipé `AO_WALL_HEIGHT` plus haut. C'est ce qui « pose » la rampe au lieu de la faire
    // flotter sur une arête franche.
    const pied = (y: number): number =>
      1 - AO_WALL * (1 - Math.min(1, (y - lowY) / AO_WALL_HEIGHT));

    const builder = quadBuilder();
    const top = fillUV(atlas);
    const cheek = cheekUV(atlas);

    // --- le dessus : la surface que le héros parcourt --------------------------------------------
    // UNE TUILE PAR CASE, pas un seul quad tendu sur toute la rampe. L'atlas est échantillonné en
    // ClampToEdge (voir `textures.ts`), donc une seule cellule d'UV étirée sur deux cases dessine
    // une herbe deux fois trop grande — la rampe se lit alors comme une surface étrangère posée sur
    // un sol dont elle ne partage plus la densité.
    const rise = endY - startY;
    const slope = alongX
      ? new THREE.Vector3(-rise, alongSpan, 0).normalize()
      : new THREE.Vector3(0, alongSpan, -rise).normalize();
    const yAt = (alongValue: number): number =>
      startY + (rise * (alongValue - alongOrigin)) / Math.max(alongSpan, 1e-9);
    for (let across = 0; across < Math.max(1, Math.round(acrossSpan)); across += 1) {
      for (let along = 0; along < Math.max(1, Math.round(alongSpan)); along += 1) {
        const a0 = alongOrigin + along;
        const a1 = Math.min(a0 + 1, alongOrigin + alongSpan);
        const b0 = (alongX ? z0 : x0) + across;
        const b1 = Math.min(b0 + 1, alongX ? z1 : x1);
        const yA = yAt(a0);
        const yB = yAt(a1);
        // Written in along/across and projected back to world x/z at the last moment, so the two
        // orientations share one piece of arithmetic instead of two that can drift apart.
        const at = (alongValue: number, acrossValue: number): Vec3 =>
          alongX
            ? [alongValue, yAt(alongValue), acrossValue]
            : [acrossValue, yAt(alongValue), alongValue];
        builder.quad(
          [at(a0, b0), at(a0, b1), at(a1, b1), at(a1, b0)],
          [slope.x, slope.y, slope.z],
          [
            [top.u0, top.v1],
            [top.u0, top.v0],
            [top.u1, top.v0],
            [top.u1, top.v1],
          ],
          [pied(yA), pied(yA), pied(yB), pied(yB)],
        );
      }
    }

    // --- les flancs : deux triangles, dégénérés du côté bas --------------------------------------
    // Émis comme des quads dont deux sommets coïncident : le même accumulateur sert, et une arête
    // de longueur nulle ne dessine rien.
    const alongStart = alongOrigin;
    const alongEnd = alongOrigin + alongSpan;
    const acrossOrigin = alongX ? z0 : x0;
    const cheekSides = [
      { across: acrossOrigin, normal: alongX ? ([0, 0, -1] as const) : ([-1, 0, 0] as const) },
      {
        across: acrossOrigin + acrossSpan,
        normal: alongX ? ([0, 0, 1] as const) : ([1, 0, 0] as const),
      },
    ];
    for (const side of cheekSides) {
      const corner = (alongValue: number, y: number): Vec3 =>
        alongX ? [alongValue, y, side.across] : [side.across, y, alongValue];
      builder.quad(
        [
          corner(alongStart, lowY),
          corner(alongEnd, lowY),
          corner(alongEnd, endY),
          corner(alongStart, startY),
        ],
        [side.normal[0], side.normal[1], side.normal[2]],
        [
          [cheek.u0, cheek.v0],
          [cheek.u1, cheek.v0],
          [cheek.u1, cheek.v1],
          [cheek.u0, cheek.v1],
        ],
        [pied(lowY), pied(lowY), pied(endY), pied(startY)],
      );
    }

    const geometry = builder.build();
    const material = new THREE.MeshLambertMaterial({
      map: atlas.texture,
      color: options.color ?? 0xffffff,
      vertexColors: true,
      transparent: opacity < 1,
      opacity,
      depthWrite: opacity >= 1,
      alphaTest: 0.5,
      side: THREE.DoubleSide,
      shadowSide: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = opacity >= 1;
    mesh.receiveShadow = true;
    geometries.push(geometry);
    materials.push(material);
    group.add(mesh);
  }

  return {
    group,
    dispose(): void {
      group.removeFromParent();
      group.clear();
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
    },
  };
}
