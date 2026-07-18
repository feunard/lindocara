import type { HandoffPresence } from "./character-presence.js";
import { CharacterPresence } from "./character-presence.js";
import { createDb } from "./db/index.js";
import { acquireHeroEpoch, handoffHeroLocation } from "./hero-profile.js";

/** One SQLite-backed lease coordinator per party hero. D1 remains the monotone epoch source. */
export class HeroPresence extends CharacterPresence {
  protected override acquireIdentityEpoch(heroId: string): Promise<number | null> {
    return acquireHeroEpoch(createDb(this.env.DB), heroId);
  }

  protected override handoffIdentityLocation(
    heroId: string,
    sessionEpoch: number,
    destination: Pick<HandoffPresence, "zoneId" | "x" | "y">,
  ): Promise<number | null> {
    return handoffHeroLocation(
      createDb(this.env.DB),
      { id: heroId, sessionEpoch },
      { mapId: destination.zoneId, x: destination.x, y: destination.y },
    );
  }
}
