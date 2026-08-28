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
  atlasFor(level: number, ramp: StairRampGeometry): TerrainAtlas;
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

/**
 * Treads per cell, and therefore the riser height: `levelHeight / TREADS_PER_CELL`.
 *
 * Three is the number where a one-cell ramp reads as a flight rather than as a single kerb, while
 * each tread stays deep enough (a third of a tile, ~21px at the pack's 64px scale) to show its own
 * fill tile instead of collapsing into a stripe.
 */
const TREADS_PER_CELL = 3;

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
 * A ramp: a flight of STEPS drawn over the smooth slope the collision samples.
 *
 * Three shapes have been tried here, and the reasons the first two lost are what keeps the third
 * honest.
 *
 * The original sliced the official strip (`Tilemap_color*.png`, columns 0 and 3, rows 4-5) over
 * eight boxes. That strip is a 64x128 SIDE ELEVATION, half of it transparent, drawn to be pasted
 * against a wall in a 2D game: laid over the tops of boxes it drew neither a tread nor a slope.
 *
 * The second was one continuous wedge, which matched `rampSampleAt` (`engine/hd2d/terrain-query.ts`)
 * exactly and still read as a flat green slab: it samples the same interior fill tile a flat ground
 * cell gets, so nothing about it says "ground you climb" rather than "ground that leans".
 *
 * So the surface is now cut into `TREADS_PER_CELL` treads and risers per cell. A tread is flat and
 * a riser is vertical, which is what makes the eye read stairs at any camera angle, and each riser
 * wears the same cliff-wall tile every other vertical face in the terrain wears, so the flight
 * belongs to the ground it cuts through.
 *
 * **The collision stays the smooth ramp, deliberately.** `rampSampleAt` is a continuous slope and
 * every mover reads it, so a hero climbing this walks up the ramp rather than bumping tread to
 * tread. Stepping the collision too would make every ramp a stutter and would put `MAX_STEP` in
 * the middle of ordinary walking.
 *
 * The price is that what is drawn and what is walked disagree, by at most ONE riser
 * (`levelHeight / TREADS_PER_CELL`, 0.3 world units at the shipped level height): each tread is
 * drawn at the HIGHER of its two ends, so a hero at the start of a tread stands up to a riser
 * below the surface under them. Both ends stay flush that way -- the first riser leaves the low
 * bank exactly, the last tread meets the plateau exactly -- and that is what the alternative
 * costs: dropping the flight half a riser to straddle the ramp would centre the error and leave a
 * visible lip at the top and a buried step at the bottom.
 *
 * That trade is the one thing here worth re-opening after seeing it in a real scene rather than in
 * a test.
 *
 * The progression convention is unchanged: `east` climbs toward +x, `west` toward -x, and each ramp
 * asks for the atlas of the bank it climbs TO, because grass reads its sheet from its altitude.
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
    const atlas = options.atlasFor(ramp.lowLevel + 1, ramp);
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
    const z0 = ramp.z;
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

    const rise = endY - startY;
    const alongStart = alongOrigin;
    const alongEnd = alongOrigin + alongSpan;
    const acrossOrigin = alongX ? z0 : x0;
    // Written in along/across and projected back to world x/z at the last moment, so the two
    // orientations share one piece of arithmetic instead of two that can drift apart.
    const at = (alongValue: number, acrossValue: number, y: number): Vec3 =>
      alongX ? [alongValue, y, acrossValue] : [acrossValue, y, alongValue];

    // --- treads and risers: the flight the hero walks up ----------------------------------------
    // ONE TILE PER CELL, never a single cell of UV stretched over the whole ramp: the atlas is
    // sampled ClampToEdge (see `textures.ts`), so a stretched cell draws grass at twice the size
    // and the ramp stops sharing the density of the ground it cuts through. A tread is a third of
    // a cell, so it takes a third of the fill tile, keeping every texel the size of flat ground's.
    const steps = Math.max(1, Math.round(alongSpan * TREADS_PER_CELL));
    const stepAlong = alongSpan / steps;
    const stepRise = rise / steps;
    const acrossCells = Math.max(1, Math.round(acrossSpan));
    for (let across = 0; across < acrossCells; across += 1) {
      const b0 = acrossOrigin + across;
      const b1 = Math.min(b0 + 1, acrossOrigin + acrossSpan);
      for (let step = 0; step < steps; step += 1) {
        const a0 = alongStart + stepAlong * step;
        const a1 = step === steps - 1 ? alongEnd : alongStart + stepAlong * (step + 1);
        const y0 = startY + stepRise * step;
        const y1 = startY + stepRise * (step + 1);
        // The tread is at the HIGHER of the step's two heights and the riser climbs to it from the
        // lower one, which is the same statement whichever way the flight runs.
        const tread = Math.max(y0, y1);
        const riserFoot = Math.min(y0, y1);
        // A tread's slice of the fill tile, so three treads walk across one tile exactly as three
        // thirds of a flat cell would.
        const slice = step % TREADS_PER_CELL;
        const u0 = top.u0 + ((top.u1 - top.u0) * slice) / TREADS_PER_CELL;
        const u1 = top.u0 + ((top.u1 - top.u0) * (slice + 1)) / TREADS_PER_CELL;
        builder.quad(
          [at(a0, b0, tread), at(a0, b1, tread), at(a1, b1, tread), at(a1, b0, tread)],
          [0, 1, 0],
          [
            [u0, top.v1],
            [u0, top.v0],
            [u1, top.v0],
            [u1, top.v1],
          ],
          [pied(tread), pied(tread), pied(tread), pied(tread)],
        );

        // The riser stands at the step's LOW end and faces down the flight: one full cliff-wall
        // cell per drop, the same convention every wall in `mesh.ts` follows.
        const riserAlong = climbsPositive ? a0 : a1;
        const facing = climbsPositive ? -1 : 1;
        const riserNormal: Vec3 = alongX ? [facing, 0, 0] : [0, 0, facing];
        builder.quad(
          [
            at(riserAlong, b0, riserFoot),
            at(riserAlong, b1, riserFoot),
            at(riserAlong, b1, tread),
            at(riserAlong, b0, tread),
          ],
          riserNormal,
          [
            [cheek.u0, cheek.v0],
            [cheek.u1, cheek.v0],
            [cheek.u1, cheek.v1],
            [cheek.u0, cheek.v1],
          ],
          [pied(riserFoot), pied(riserFoot), pied(tread), pied(tread)],
        );
      }
    }

    // --- the cheeks: the flight's stepped silhouette, seen from the side -------------------------
    // One quad per step rather than one triangle over the whole ramp. The triangle carried a single
    // cliff tile stretched over its hypotenuse, which is the "ugly front faces" of the report: at
    // ten levels that tile was smeared over nine world units. Here the ONE cheek cell is mapped
    // across the whole flank by position, so each step samples its own sub-rectangle of it and no
    // texel is stretched further than its neighbour's.
    const topY = Math.max(startY, endY);
    const cheekSides = [
      { across: acrossOrigin, normal: alongX ? ([0, 0, -1] as const) : ([-1, 0, 0] as const) },
      {
        across: acrossOrigin + acrossSpan,
        normal: alongX ? ([0, 0, 1] as const) : ([1, 0, 0] as const),
      },
    ];
    const cheekU = (alongValue: number): number =>
      cheek.u0 + ((cheek.u1 - cheek.u0) * (alongValue - alongStart)) / Math.max(alongSpan, 1e-9);
    const cheekV = (y: number): number =>
      cheek.v0 + ((cheek.v1 - cheek.v0) * (y - lowY)) / Math.max(topY - lowY, 1e-9);
    for (const side of cheekSides) {
      const corner = (alongValue: number, y: number): Vec3 =>
        alongX ? [alongValue, y, side.across] : [side.across, y, alongValue];
      for (let step = 0; step < steps; step += 1) {
        const a0 = alongStart + stepAlong * step;
        const a1 = step === steps - 1 ? alongEnd : alongStart + stepAlong * (step + 1);
        const tread = Math.max(startY + stepRise * step, startY + stepRise * (step + 1));
        builder.quad(
          [corner(a0, lowY), corner(a1, lowY), corner(a1, tread), corner(a0, tread)],
          [side.normal[0], side.normal[1], side.normal[2]],
          [
            [cheekU(a0), cheekV(lowY)],
            [cheekU(a1), cheekV(lowY)],
            [cheekU(a1), cheekV(tread)],
            [cheekU(a0), cheekV(tread)],
          ],
          [pied(lowY), pied(lowY), pied(tread), pied(tread)],
        );
      }
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
