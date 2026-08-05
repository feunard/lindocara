import type { WorldPosition } from "@lindocara/engine/ground.js";
import { $repository, DbEntityNotFoundError, sql } from "alepha/orm";
import { heroes } from "../entities/heroes.ts";

/**
 * Fenced mutations on `hero.session_epoch` — the realtime tranche's port of
 * `packages/server/src/hero-profile.ts:118-146` (`acquireHeroEpoch`/`handoffHeroLocation`) onto
 * Alepha's `$repository`, following the tranche-1 raw-SQL discipline `MapService.updateMap`
 * already established for its own fenced-revision increment
 * (`packages/server/src/api/services/MapService.ts:246-269`): a single-statement
 * `UPDATE ... SET session_epoch = session_epoch + 1 ... RETURNING session_epoch`, never a
 * read-then-write pair — so a race between two acquirers, or an acquire racing a handoff, can
 * never land two updates against the same starting epoch.
 *
 * `hero.session_epoch` is the ONLY source of truth for a hero's fencing generation (see the root
 * `CLAUDE.md`'s "Hero presence and save fencing"); `PresenceRoom`'s in-memory lease is a cache of
 * the value this service last returned, never the other way around. Every write below goes
 * through `Repository.updateOne`/`updateById`, which already throw `DbEntityNotFoundError` when
 * their `WHERE` predicate matches zero rows — both methods collapse that into a plain `null`,
 * mirroring the legacy `Promise<number | null>` contract instead of leaking a driver-shaped error.
 */
export class HeroEpochService {
  heroes = $repository(heroes);

  /**
   * Unconditionally bumps `session_epoch` by one and returns the new value — the write a fresh
   * `PresenceRoom.acquire` performs before installing its in-memory lease (port of
   * `hero-profile.ts`'s `acquireHeroEpoch`). Returns `null` only when `heroId` names no row.
   */
  async acquireEpoch(heroId: string): Promise<number | null> {
    try {
      const updated = await this.heroes.updateById(heroId, {
        sessionEpoch: sql`session_epoch + 1`,
      });
      return updated.sessionEpoch;
    } catch (error) {
      if (error instanceof DbEntityNotFoundError) return null;
      throw error;
    }
  }

  /**
   * The fenced move+increment behind `PresenceRoom.handoff`: moves the hero's durable map/x/y and
   * bumps `session_epoch` by one, in the SAME statement, gated on `fenced.sessionEpoch` matching
   * the row's current value (port of `hero-profile.ts`'s `handoffHeroLocation`). A stale
   * `sessionEpoch` — the caller lost a race, or is a zombie holder whose lease already moved on —
   * matches zero rows and returns `null`, changing nothing (no partial move, no epoch bump).
   */
  /**
   * The fenced move WITHOUT an epoch bump — port of `index.ts`'s `relocateHero` (the admission
   * fallback that re-homes a hero whose stored map vanished onto the adventure's resolved start).
   * The caller has just acquired the epoch it names, so gating on it means a concurrent second
   * acquire (which bumped the epoch again) makes this a no-op `null` instead of a blind move.
   */
  async relocate(fenced: {
    heroId: string;
    sessionEpoch: number;
    mapId: string;
    position: WorldPosition;
  }): Promise<boolean> {
    try {
      await this.heroes.updateOne(
        { id: { eq: fenced.heroId }, sessionEpoch: { eq: fenced.sessionEpoch } },
        {
          mapId: fenced.mapId,
          x: fenced.position.x,
          y: fenced.position.y,
          z: fenced.position.z,
        },
      );
      return true;
    } catch (error) {
      if (error instanceof DbEntityNotFoundError) return false;
      throw error;
    }
  }

  async handoffEpoch(fenced: {
    heroId: string;
    sessionEpoch: number;
    mapId: string;
    position: WorldPosition;
  }): Promise<number | null> {
    try {
      const updated = await this.heroes.updateOne(
        { id: { eq: fenced.heroId }, sessionEpoch: { eq: fenced.sessionEpoch } },
        {
          mapId: fenced.mapId,
          // All THREE axes, always together. A move that writes two of them lands the body at a
          // point nothing validated, and typechecks, because every axis is a `number`.
          x: fenced.position.x,
          y: fenced.position.y,
          z: fenced.position.z,
          sessionEpoch: sql`session_epoch + 1`,
        },
      );
      return updated.sessionEpoch;
    } catch (error) {
      if (error instanceof DbEntityNotFoundError) return null;
      throw error;
    }
  }
}
