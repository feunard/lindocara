//
// ============================ TILE→PIXEL BRIDGE ============================
// TEMPORARY, AND DELIBERATELY SO. The map is stored and shipped as a heightfield in TILE units,
// grid-centred; the game's simulation (`simulation.ts`, `collider.ts`, the server's fourteen world
// systems) still runs in PIXELS with a top-left origin, and every position on the wire is therefore
// a pixel. This file is the only place the two unit systems meet.
//
// It lives in `engine`, not in the server or the renderer, because BOTH sides convert and there
// must be exactly ONE copy of the arithmetic: the server projects the stored heightfield into the
// pixel geometry it collides against, the HD-2D renderer projects the snapshot's pixels back into
// the tile-unit scene it draws. Two hand-synchronised copies of an origin shift is how one side
// ends up drawing every actor half a map from the ground under its feet — silently, and with a
// clean typecheck.
//
// It exists for exactly as long as that migration takes. When the game's geometry moves to tile
// units, DELETE this file and every call site — `grep -rn "TILE→PIXEL BRIDGE"` finds them all.
// Do not grow it, and do not let a caller convert coordinates by hand instead of going through it.
// ===========================================================================

import { TILE_SIZE } from "../tilemap.js";

/** Grid-centred tile units -> top-left pixel units. The origin shift is the half that gets
 *  forgotten; keeping it in one exported function is why this is not inlined at each site. */
export function tileToPixel(value: number, size: number): number {
  return (value + size / 2) * TILE_SIZE;
}

/** Top-left pixel units -> grid-centred tile units: the exact inverse of `tileToPixel`. */
export function pixelToTile(value: number, size: number): number {
  return value / TILE_SIZE - size / 2;
}
