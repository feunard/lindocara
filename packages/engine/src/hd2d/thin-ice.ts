/**
 * The state of thin ice, cell by cell. Pure — no `three`, no DOM, no clock, no `Math.random` —
 * like `locomotion.ts` and `zones.ts`: this is a RULES module, called every frame by `hero.ts`
 * (in the lab) with an already-measured `dt`, never a clock of its own. It moved into
 * `@lindocara/engine` in S2 the same way as the other modules that used to live in `world/`.
 *
 * Three states, in this order and no other: **intact** → **cracking** under the weight (it warns,
 * there's time to leave) → **broken** (you fall through). A cell released before it breaks
 * REFREEZES after a delay rather than staying a permanent hole — in a lab, trying again is the
 * whole point (see the spec, "Thin ice" section).
 */
export type EtatGlace = "intacte" | "craquelee" | "rompue";

export interface ThinIceOptions {
  /** Cumulative load (seconds of weight on it) past which the cell cracks. */
  seuilCraquement: number;
  /** Cumulative load past which the cell gives way. */
  seuilRupture: number;
  /** Delay, once released, before the cell refreezes and forgets everything. */
  regel: number;
}

export interface ThinIce {
  /** Adds `dt` to the load of cell `cle` (weight still on it) and returns its new state. Cancels
   *  any refreeze in progress: stepping back on it before it has refrozen resumes the crack where
   *  it left off, it does not start over from zero. */
  charge(cle: string, dt: number): EtatGlace;
  /** The weight leaves the cell: it stops loading, and the refreeze countdown starts. No effect on
   *  a cell that was never loaded or is already refreezing. */
  relache(cle: string): void;
  /** Advances the refreeze of every released cell by `dt`. A cell whose delay runs out is PURGED
   *  from the table (see `taille`): it becomes intact again by forgetting everything, not by
   *  keeping an entry at zero load. */
  update(dt: number): void;
  /** The state of `cle` — "intacte" if it was never loaded, or if it finished refreezing. */
  etat(cle: string): EtatGlace;
  /** Number of cells currently tracked (loaded, or released and awaiting refreeze). Exists so the
   *  test can prove the purge: without it, nothing distinguishes a table that empties out from one
   *  that grows without bound over a session — the exact defect the billboard registry had in S1. */
  taille(): number;
}

interface Case {
  /** Cumulative seconds of weight. Never decreases in small steps: either it stays exactly as is
   *  (stepped back on before refreeze), or the whole cell is purged (refreeze complete). */
  charge: number;
  /** `null` while someone is standing on it (or just stepped back on it); otherwise the time
   *  remaining before refreeze, counted down by `update`. */
  regelRestant: number | null;
}

function etatDe(c: Case, opts: ThinIceOptions): EtatGlace {
  if (c.charge >= opts.seuilRupture) return "rompue";
  if (c.charge >= opts.seuilCraquement) return "craquelee";
  return "intacte";
}

/**
 * A BROKEN cell counts as water for swim resolution, EVEN THOUGH the terrain height field there
 * still holds a real number: `kindAt` changes a cell's MATERIAL, never its height (see
 * `island.ts`) — the ice sheet stays solid ground at that spot as far as anything else knows.
 *
 * Without this rule, `hero.ts`'s `if (sol !== null) leaveWater(sol)` resolution (pre-existing,
 * deliberately left unchanged in shape) would surface the hero back up all on its own ONE FRAME
 * after falling through — right where they just sank in, which would drain the mechanic of any
 * stakes (breath would never have time to drop). `hero.ts` calls this in the `swimming` branch,
 * `&&`-ed with the existing `sol !== null` condition — a purely ADDITIVE guard that tightens when
 * surfacing, without touching the formula or the rest of the swim resolution.
 */
export function compteCommeEau(etat: EtatGlace): boolean {
  return etat === "rompue";
}

/**
 * Stepping — ON FOOT, not swimming — onto a cell that is ALREADY broken (not yet refrozen) makes
 * the hero fall through WITHOUT a load delay: there is no ice left at all under that step, nothing
 * to accumulate.
 *
 * Without this rule, a hero who escaped by swimming and then walks back onto it from the shore
 * would stay standing on empty space — collision (`hero.ts`, `centreOk`/`canEnter`) only knows the
 * terrain relief, always solid, and never `thinIce`'s state. The `hero.ts` logic that loads a cell
 * only reacts to state TRANSITIONS while it is being loaded; arriving directly on one that is
 * already broken produces none, hence the need for this question asked separately, on ARRIVAL.
 */
export function tombeEnArrivant(etat: EtatGlace): boolean {
  return etat === "rompue";
}

export function createThinIce(opts: ThinIceOptions): ThinIce {
  const cases = new Map<string, Case>();

  return {
    charge(cle, dt) {
      let c = cases.get(cle);
      if (!c) {
        c = { charge: 0, regelRestant: null };
        cases.set(cle, c);
      }
      c.charge += dt;
      // Stepping back on it cancels any refreeze already started: it does not become intact again
      // while someone is still standing on it, which would be the worst time to do so.
      c.regelRestant = null;
      return etatDe(c, opts);
    },
    relache(cle) {
      const c = cases.get(cle);
      // Nothing to load ever existed in the table (never stepped on): nothing to release either.
      if (!c) return;
      // Already refreezing (two calls without going through `charge` in between, which the caller
      // shouldn't do, but staying idempotent costs one line): don't restart the delay from zero.
      if (c.regelRestant === null) c.regelRestant = opts.regel;
    },
    update(dt) {
      for (const [cle, c] of cases) {
        // Still under weight: nothing to count down, it hasn't been released yet.
        if (c.regelRestant === null) continue;
        c.regelRestant -= dt;
        // Refrozen: full purge, not a reset to zero load — otherwise the table grows without bound
        // over a session (see `taille`, and the billboard registry in S1).
        if (c.regelRestant <= 0) cases.delete(cle);
      }
    },
    etat(cle) {
      const c = cases.get(cle);
      return c ? etatDe(c, opts) : "intacte";
    },
    taille() {
      return cases.size;
    },
  };
}
