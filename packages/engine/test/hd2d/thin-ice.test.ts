import { compteCommeEau, createThinIce, tombeEnArrivant } from "@lindocara/engine/hd2d/thin-ice.js";
import { describe, expect, it } from "vitest";

const REGLAGES = { seuilCraquement: 0.4, seuilRupture: 1.2, regel: 5 } as const;

describe("thin ice", () => {
  it("cracks before breaking: there must be time to leave", () => {
    // The whole point of the mechanic is here. Ice that breaks without warning isn't a danger,
    // it's a trap.
    const g = createThinIce(REGLAGES);
    expect(g.charge("3,4", 0.3)).toBe("intacte");
    expect(g.charge("3,4", 0.2)).toBe("craquelee");
    expect(g.charge("3,4", 0.8)).toBe("rompue");
  });

  it("forgets the load when you leave, but keeps the crack", () => {
    const g = createThinIce(REGLAGES);
    g.charge("3,4", 0.5);
    g.relache("3,4");
    g.update(0.5);
    // Left in time: it stays cracked, not broken.
    expect(g.etat("3,4")).toBe("craquelee");
  });

  it("refreezes after the delay, so it can be tried again", () => {
    // In a lab, a permanent hole prevents trying again — and trying again is the whole point.
    const g = createThinIce(REGLAGES);
    g.charge("3,4", 1.5);
    expect(g.etat("3,4")).toBe("rompue");
    g.relache("3,4");
    g.update(REGLAGES.regel + 0.1);
    expect(g.etat("3,4")).toBe("intacte");
  });

  it("tracks several cells independently", () => {
    const g = createThinIce(REGLAGES);
    g.charge("1,1", 1.5);
    expect(g.etat("1,1")).toBe("rompue");
    expect(g.etat("2,2")).toBe("intacte");
  });

  it("keeps no entry for a cell that came back intact", () => {
    // Otherwise the table grows without bound over a session — the same defect the billboard
    // registries had in S1.
    const g = createThinIce(REGLAGES);
    g.charge("1,1", 0.5);
    g.relache("1,1");
    g.update(REGLAGES.regel + 0.1);
    expect(g.taille()).toBe(0);
  });
});

// The two rules below came out of a bug found by PLAYING (see the originating task's report), not
// by reading the code: nothing in `apps/lab/test/` exercised `createHero().update()`, so nothing
// protected them from a silent regression — exactly the swim resolutions S2 makes authoritative
// server-side. Extracted here as pure functions to be testable without standing up a full hero.
describe("compteCommeEau — a broken cell must be treated as water", () => {
  it("a broken cell counts as water, despite terrain of non-zero height", () => {
    // This is the rule that keeps `hero.ts` from surfacing the hero back up one frame after
    // `enterWater(plunge)`: the height field knows nothing of the hole (see `island.ts`), only
    // this question — asked of the ice's state, not the terrain — knows it.
    expect(compteCommeEau("rompue")).toBe(true);
  });

  it("an intact or cracked cell doesn't count as water", () => {
    expect(compteCommeEau("intacte")).toBe(false);
    expect(compteCommeEau("craquelee")).toBe(false);
  });
});

describe("tombeEnArrivant — stepping onto a hole already open falls through without delay", () => {
  it("arriving on a broken cell falls through immediately", () => {
    // Without it, a hero who walks back on foot onto a hole they opened themselves (and escaped
    // by swimming) would stay standing on empty space: collision only knows the terrain relief,
    // always solid, and never the ice's state.
    expect(tombeEnArrivant("rompue")).toBe(true);
  });

  it("arriving on an intact or cracked cell doesn't fall through", () => {
    // A cracked cell stays crossable: that's exactly the warning that leaves time to leave, not
    // an immediate fall.
    expect(tombeEnArrivant("intacte")).toBe(false);
    expect(tombeEnArrivant("craquelee")).toBe(false);
  });
});
