import type { PlayerSnapshot, WorldEventSnapshot } from "@lindocara/engine/protocol.js";
import {
  createHarvestEventVisualState,
  harvestEventPresentation,
  peasantCarryPresentation,
} from "@lindocara/renderer/harvest-visuals.js";
import { describe, expect, it } from "vitest";

const GRAPHIC = "tree.intact";
const STUMP = "resource.terrain-resources-wood-trees.stump-1";

function event(
  harvest: WorldEventSnapshot["harvest"],
  graphicAssetId: string | null = GRAPHIC,
): WorldEventSnapshot {
  return {
    id: "harvest-a",
    col: 2,
    row: 3,
    graphicAssetId,
    onTop: false,
    moveSpeed: 0,
    moveFrequency: 0,
    moveAnimation: false,
    directionFixed: true,
    ...(harvest ? { harvest } : {}),
  };
}

function intact(overrides: Partial<NonNullable<WorldEventSnapshot["harvest"]>> = {}) {
  return {
    state: "intact",
    generation: 0,
    hits: 0,
    lastHitAt: null,
    depletedAt: null,
    respawnAt: null,
    exhaustionBehavior: "replace",
    exhaustedAssetId: STUMP,
    fadeDurationMs: 300,
    ...overrides,
  } satisfies NonNullable<WorldEventSnapshot["harvest"]>;
}

const identityClock = (timestamp: number) => timestamp;

describe("authoritative harvest event presentation", () => {
  it("plays each fresh authoritative hit exactly once across repeated snapshots and resyncs", () => {
    let state = createHarvestEventVisualState();
    const present = (snapshot: WorldEventSnapshot, now: number) => {
      const presentation = harvestEventPresentation({
        event: snapshot,
        previous: state,
        previousGraphicAssetId: GRAPHIC,
        now,
        toLocal: identityClock,
      });
      state = presentation.state;
      return presentation;
    };

    expect(present(event(intact()), 1_000).playHitEffect).toBe(false);
    const firstHit = event(intact({ hits: 1, lastHitAt: 1_010 }));
    expect(present(firstHit, 1_010).playHitEffect).toBe(true);
    expect(present(firstHit, 1_020).playHitEffect).toBe(false);
    expect(present(structuredClone(firstHit), 1_030).playHitEffect).toBe(false);

    expect(present(event(intact({ hits: 2, lastHitAt: 1_100 })), 1_100).playHitEffect).toBe(true);
    expect(present(event(intact({ generation: 1 })), 1_200).playHitEffect).toBe(false);
    expect(
      present(event(intact({ generation: 1, hits: 1, lastHitAt: 1_210 })), 1_210).playHitEffect,
    ).toBe(true);
  });

  it("observes but never replays an old hit received in a late resync", () => {
    let state = createHarvestEventVisualState();
    const stale = event(intact({ hits: 1, lastHitAt: 1_000 }));
    const first = harvestEventPresentation({
      event: stale,
      previous: state,
      previousGraphicAssetId: GRAPHIC,
      now: 5_000,
      toLocal: identityClock,
    });
    state = first.state;
    const repeated = harvestEventPresentation({
      event: structuredClone(stale),
      previous: state,
      previousGraphicAssetId: GRAPHIC,
      now: 5_010,
      toLocal: identityClock,
    });

    expect(first.playHitEffect).toBe(false);
    expect(repeated.playHitEffect).toBe(false);
  });

  it("anchors a fade to the server depletion timestamp without restarting it on snapshots", () => {
    let state = createHarvestEventVisualState();
    const depleted = event(
      {
        ...intact({ hits: 3, lastHitAt: 9_950 }),
        state: "depleted",
        depletedAt: 10_000,
        exhaustionBehavior: "fade",
        fadeDurationMs: 500,
      },
      null,
    );
    const toLocal = (timestamp: number) => timestamp - 9_000;
    const first = harvestEventPresentation({
      event: depleted,
      previous: state,
      previousGraphicAssetId: GRAPHIC,
      now: 1_100,
      toLocal,
    });
    state = first.state;
    const repeated = harvestEventPresentation({
      event: structuredClone(depleted),
      previous: state,
      previousGraphicAssetId: GRAPHIC,
      now: 1_200,
      toLocal,
    });
    state = repeated.state;
    const finished = harvestEventPresentation({
      event: depleted,
      previous: state,
      previousGraphicAssetId: GRAPHIC,
      now: 1_500,
      toLocal,
    });

    expect(first).toMatchObject({ graphicAssetId: GRAPHIC, alpha: 0.8 });
    expect(first.state.fadeStartedAt).toBe(1_000);
    expect(repeated).toMatchObject({ graphicAssetId: GRAPHIC, alpha: 0.6 });
    expect(repeated.state.fadeStartedAt).toBe(1_000);
    expect(finished).toMatchObject({ graphicAssetId: null, alpha: 0 });
  });

  it("uses explicit hide and replacement presentations, then restores an intact respawn", () => {
    const initial = createHarvestEventVisualState();
    const hide = harvestEventPresentation({
      event: event({
        ...intact({ hits: 1, lastHitAt: 1_000 }),
        state: "depleted",
        depletedAt: 1_000,
        exhaustionBehavior: "hide",
      }),
      previous: initial,
      previousGraphicAssetId: GRAPHIC,
      now: 1_000,
      toLocal: identityClock,
    });
    const replacement = harvestEventPresentation({
      event: event(
        {
          ...intact({ hits: 1, lastHitAt: 1_000 }),
          state: "depleted",
          depletedAt: 1_000,
          exhaustionBehavior: "replace",
        },
        "tree.stump",
      ),
      previous: hide.state,
      previousGraphicAssetId: null,
      now: 1_050,
      toLocal: identityClock,
    });
    const respawn = harvestEventPresentation({
      event: event(intact({ generation: 1 })),
      previous: replacement.state,
      previousGraphicAssetId: "tree.stump",
      now: 2_000,
      toLocal: identityClock,
    });

    expect(hide).toMatchObject({ graphicAssetId: null, alpha: 0 });
    expect(replacement).toMatchObject({ graphicAssetId: "tree.stump", alpha: 1 });
    expect(respawn).toMatchObject({ graphicAssetId: GRAPHIC, alpha: 1 });
    expect(respawn.state.fadeKey).toBeNull();
  });
});

describe("authoritative peasant carry presentation", () => {
  const peasant = {
    class: "peasant",
    appearance: { body: "wayfarer", primaryColor: "azure" },
    peasantCarry: { kind: "wood", until: 2_000 },
  } satisfies Pick<PlayerSnapshot, "class" | "appearance" | "peasantCarry">;

  it("selects the preloaded idle and run strips until the server deadline", () => {
    const idle = peasantCarryPresentation(peasant, false, 1_000, identityClock);
    const run = peasantCarryPresentation(peasant, true, 1_000, identityClock);

    expect(idle).toMatchObject({ kind: "wood", motion: "idle", localUntil: 2_000 });
    expect(decodeURIComponent(idle?.sheet.source ?? "")).toContain("Pawn_Idle Wood.png");
    expect(run).toMatchObject({ kind: "wood", motion: "run", localUntil: 2_000 });
    expect(decodeURIComponent(run?.sheet.source ?? "")).toContain("Pawn_Run Wood.png");
  });

  it("returns immediately to normal rendering after expiry or authoritative removal", () => {
    expect(peasantCarryPresentation(peasant, false, 1_999, identityClock)).not.toBeNull();
    expect(peasantCarryPresentation(peasant, false, 2_000, identityClock)).toBeNull();
    expect(
      peasantCarryPresentation(
        { class: peasant.class, appearance: peasant.appearance },
        false,
        1_000,
        identityClock,
      ),
    ).toBeNull();
  });

  it("rejects unsupported visuals and never invents stone or iron carry art", () => {
    const invalid = {
      ...peasant,
      peasantCarry: { kind: "stone", until: 2_000 },
    } as unknown as Pick<PlayerSnapshot, "class" | "appearance" | "peasantCarry">;
    expect(peasantCarryPresentation(invalid, false, 1_000, identityClock)).toBeNull();
    expect(
      peasantCarryPresentation({ ...peasant, class: "warrior" }, false, 1_000, identityClock),
    ).toBeNull();
  });
});
