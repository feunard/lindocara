import {
  addPartyMaterials,
  applyHarvestHit,
  EMPTY_PARTY_MATERIALS,
  isHarvestNodeId,
  MAX_PARTY_MATERIAL_AMOUNT,
  missingPartyMaterialAmounts,
  parseHarvestNodeStates,
  parsePartyMaterialAmounts,
  parsePartyMaterials,
  refreshHarvestNode,
  spendPartyMaterials,
} from "@lindocara/engine/party-harvest-state.js";
import { describe, expect, it } from "vitest";

const EVENT_ID = "11111111-1111-4111-8111-111111111111";
const CARCASS_ID = "carcass:verdant-reach:road-war-pig";

describe("party material validation", () => {
  it("normalizes missing persisted keys and round-trips explicit stock", () => {
    expect(parsePartyMaterials(undefined)).toEqual(EMPTY_PARTY_MATERIALS);
    expect(parsePartyMaterials({ wood: 3 })).toEqual({ wood: 3, stone: 0, meat: 0 });
    expect(parsePartyMaterials({ wood: 3, stone: 2, iron: 1, meat: 4 })).toEqual({
      wood: 3,
      stone: 3,
      meat: 4,
    });
  });

  it("rejects gold, unknown keys and invalid quantities", () => {
    expect(parsePartyMaterials({ gold: 1 })).toBeNull();
    expect(parsePartyMaterials({ wood: -1 })).toBeNull();
    expect(parsePartyMaterials({ wood: 1.5 })).toBeNull();
    expect(parsePartyMaterials({ wood: MAX_PARTY_MATERIAL_AMOUNT + 1 })).toBeNull();
    expect(parsePartyMaterialAmounts({ timber: 1 })).toBeNull();
  });

  it("adds and consumes stock without partial or overflowing mutations", () => {
    expect(addPartyMaterials({ wood: 3, stone: 3, meat: 4 }, { wood: 2, stone: 1 })).toEqual({
      wood: 5,
      stone: 4,
      meat: 4,
    });
    expect(
      addPartyMaterials({ wood: MAX_PARTY_MATERIAL_AMOUNT, stone: 0, meat: 0 }, { wood: 1 }),
    ).toBeNull();
    expect(spendPartyMaterials({ wood: 3, stone: 3, meat: 4 }, { wood: 2, stone: 2 })).toEqual({
      wood: 1,
      stone: 1,
      meat: 4,
    });
    expect(spendPartyMaterials({ wood: 1, stone: 3, meat: 4 }, { wood: 2 })).toBeNull();
  });

  it("reports the exact resources missing from an atomic spend", () => {
    expect(
      missingPartyMaterialAmounts({ wood: 0, stone: 1, meat: 3 }, { wood: 1, stone: 2, meat: 1 }),
    ).toEqual({ wood: 1, stone: 1 });
  });
});

describe("harvest node state", () => {
  it("validates keyed node identity and lifecycle invariants", () => {
    const node = {
      eventId: EVENT_ID,
      generation: 2,
      hits: 3,
      depleted: true,
      respawnAt: 10_000,
    };
    expect(parseHarvestNodeStates({ [EVENT_ID]: node })).toEqual({
      [EVENT_ID]: { ...node, lastHitAt: null, depletedAt: null },
    });
    expect(parseHarvestNodeStates(undefined)).toEqual({});
    expect(
      parseHarvestNodeStates({ [EVENT_ID]: { ...node, eventId: crypto.randomUUID() } }),
    ).toBeNull();
    expect(parseHarvestNodeStates({ [EVENT_ID]: { ...node, hits: -1 } })).toBeNull();
    expect(
      parseHarvestNodeStates({
        [EVENT_ID]: { ...node, depleted: false, respawnAt: 10_000 },
      }),
    ).toBeNull();
  });

  it("accepts only the bounded catalogue-carcass namespace beside authored UUIDs", () => {
    expect(isHarvestNodeId(EVENT_ID)).toBe(true);
    expect(isHarvestNodeId(CARCASS_ID)).toBe(true);
    expect(isHarvestNodeId("carcass:verdant reach:war-pig")).toBe(false);
    expect(isHarvestNodeId(`carcass:${"z".repeat(65)}:war-pig`)).toBe(false);
    expect(isHarvestNodeId("some-free-form-key")).toBe(false);
    const node = {
      eventId: CARCASS_ID,
      generation: 0,
      hits: 0,
      depleted: false,
      respawnAt: null,
    };
    expect(parseHarvestNodeStates({ [CARCASS_ID]: node })).toEqual({
      [CARCASS_ID]: { ...node, lastHitAt: null, depletedAt: null },
    });
  });

  it("allows a gold completion to persist depletion without minting party material", () => {
    expect(
      applyHarvestHit(
        EMPTY_PARTY_MATERIALS,
        {},
        {
          eventId: EVENT_ID,
          generation: 0,
          requiredHits: 1,
          reward: {},
          respawnDelayMs: null,
          now: 1_000,
        },
      ),
    ).toMatchObject({ ok: true, rewarded: true, materials: EMPTY_PARTY_MATERIALS });
  });

  it("credits a final hit once and leaves an already depleted node unchanged", () => {
    const first = applyHarvestHit(
      EMPTY_PARTY_MATERIALS,
      {},
      {
        eventId: EVENT_ID,
        generation: 0,
        requiredHits: 2,
        reward: { wood: 3 },
        respawnDelayMs: null,
        now: 1_000,
      },
    );
    expect(first).toMatchObject({ ok: true, rewarded: false, materials: EMPTY_PARTY_MATERIALS });
    if (!first.ok) throw new Error("first hit rejected");
    expect(first.node).toMatchObject({
      hits: 1,
      lastHitAt: 1_000,
      depleted: false,
      depletedAt: null,
    });

    const final = applyHarvestHit(first.materials, first.nodes, {
      eventId: EVENT_ID,
      generation: 0,
      requiredHits: 2,
      reward: { wood: 3 },
      respawnDelayMs: null,
      now: 1_001,
    });
    expect(final).toMatchObject({
      ok: true,
      rewarded: true,
      materials: { wood: 3, stone: 0, meat: 0 },
      node: {
        hits: 2,
        lastHitAt: 1_001,
        depleted: true,
        depletedAt: 1_001,
        respawnAt: null,
      },
    });
    if (!final.ok) throw new Error("final hit rejected");

    expect(
      applyHarvestHit(final.materials, final.nodes, {
        eventId: EVENT_ID,
        generation: 0,
        requiredHits: 2,
        reward: { wood: 3 },
        respawnDelayMs: null,
        now: 1_002,
      }),
    ).toEqual({ ok: false, reason: "depleted" });
  });

  it("respawns only at the deadline and increments the generation fence", () => {
    const depleted = {
      [EVENT_ID]: {
        eventId: EVENT_ID,
        generation: 4,
        hits: 1,
        lastHitAt: 1_000,
        depleted: true,
        depletedAt: 1_000,
        respawnAt: 2_000,
      },
    };
    expect(refreshHarvestNode(depleted, EVENT_ID, 1_999)).toMatchObject({ changed: false });
    expect(refreshHarvestNode(depleted, EVENT_ID, 2_000)).toEqual({
      changed: true,
      node: {
        eventId: EVENT_ID,
        generation: 5,
        hits: 0,
        lastHitAt: null,
        depleted: false,
        depletedAt: null,
        respawnAt: null,
      },
      nodes: {
        [EVENT_ID]: {
          eventId: EVENT_ID,
          generation: 5,
          hits: 0,
          lastHitAt: null,
          depleted: false,
          depletedAt: null,
          respawnAt: null,
        },
      },
    });
  });
});
