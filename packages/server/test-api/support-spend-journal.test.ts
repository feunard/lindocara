import {
  MAX_SUPPORT_SPEND_ENTRIES,
  parseSupportSpendJournal,
  pruneSupportSpendOutcomes,
  SUPPORT_SPEND_OUTCOME_TTL_MS,
  type SupportSpendEntry,
  type SupportSpendJournal,
} from "@lindocara/server/api/services/supportSpendJournal.js";
import { describe, expect, it } from "vitest";

const PARTY_ID = "11111111-1111-4111-8111-111111111111";
const MAP_ID = "22222222-2222-4222-8222-222222222222";
const HERO_ID = "33333333-3333-4333-8333-333333333333";

function id(index: number): string {
  return `44444444-4444-4444-8${index.toString(16).padStart(3, "0")}-444444444444`;
}

function entry(status: SupportSpendEntry["status"], createdAt: number): SupportSpendEntry {
  return {
    heroId: HERO_ID,
    roomKey: `${PARTY_ID}:${MAP_ID}`,
    costs: { wood: 1 },
    status,
    createdAt,
    resolvedAt: status === "committed" ? null : createdAt,
  };
}

describe("private support-spend journal", () => {
  it("accepts the legacy empty object and rejects malformed entries", () => {
    expect(parseSupportSpendJournal({})).toEqual({});
    expect(
      parseSupportSpendJournal({ [id(0)]: { ...entry("committed", 1), costs: {} } }),
    ).toBeNull();
    expect(
      parseSupportSpendJournal({
        [id(0)]: { ...entry("settled", 1), resolvedAt: null },
      }),
    ).toBeNull();
  });

  it("prunes expired outcomes but never infers a committed outcome from age", () => {
    const journal: SupportSpendJournal = {
      [id(0)]: entry("committed", 1),
      [id(1)]: entry("settled", 1),
    };
    expect(pruneSupportSpendOutcomes(journal, 1 + SUPPORT_SPEND_OUTCOME_TTL_MS)).toEqual({
      [id(0)]: entry("committed", 1),
    });
  });

  it("fails closed when committed entries consume every bounded slot", () => {
    const journal: SupportSpendJournal = {};
    for (let index = 0; index < MAX_SUPPORT_SPEND_ENTRIES; index += 1) {
      journal[id(index)] = entry("committed", index);
    }
    expect(parseSupportSpendJournal(journal)).not.toBeNull();
    expect(pruneSupportSpendOutcomes(journal, 10_000, 1)).toBeNull();
  });
});
