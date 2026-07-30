import {
  activePartyAtom,
  adventureEditorSessionAtom,
  adventureTestSessionAtom,
  questTrackingAtom,
  quickItemsAtom,
} from "@lindocara/client/state/atoms.js";
import { useStore } from "alepha/react";
import { renderWithAlepha } from "alepha/react/testing";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";

function ActivePartyProbe() {
  const [activeParty, setActiveParty] = useStore(activePartyAtom);
  return (
    <div>
      <span data-testid="value">{activeParty ? activeParty.id : "none"}</span>
      <button type="button" onClick={() => setActiveParty({ ...PARTY, status: "completed" })}>
        complete
      </button>
      <button type="button" onClick={() => setActiveParty(null)}>
        clear
      </button>
    </div>
  );
}

const PARTY = {
  id: "party-1",
  name: null,
  adventureId: "adv-1",
  adventureTitle: "Donjon",
  maxPlayers: 4,
  status: "open" as const,
  hostAccountId: "acct-1",
  colors: ["blue" as const],
  mine: true,
  myColor: "blue" as const,
};

describe("state/atoms", () => {
  let alephaInstances: Array<{ stop(): Promise<void> }> = [];

  afterEach(async () => {
    for (const alepha of alephaInstances) await alepha.stop();
    alephaInstances = [];
  });

  it("activePartyAtom defaults to null and round-trips a write, re-rendering its React reader", async () => {
    const { alepha, getByTestId, getByRole } = await renderWithAlepha(<ActivePartyProbe />);
    alephaInstances.push(alepha);

    expect(alepha.store.get(activePartyAtom)).toBeNull();
    expect(getByTestId("value")).toHaveTextContent("none");

    await act(async () => {
      alepha.store.set(activePartyAtom, PARTY);
    });
    expect(getByTestId("value")).toHaveTextContent("party-1");

    // A React-driven write is visible from the non-React side too (round-trip, not just fan-out).
    await act(async () => {
      getByRole("button", { name: "complete" }).click();
    });
    expect(alepha.store.get(activePartyAtom)).toEqual({ ...PARTY, status: "completed" });

    await act(async () => {
      getByRole("button", { name: "clear" }).click();
    });
    expect(alepha.store.get(activePartyAtom)).toBeNull();
    expect(getByTestId("value")).toHaveTextContent("none");
  });

  it("adventureTestSessionAtom and adventureEditorSessionAtom default to null", async () => {
    const { alepha } = await renderWithAlepha(<div />);
    alephaInstances.push(alepha);
    expect(alepha.store.get(adventureTestSessionAtom)).toBeNull();
    expect(alepha.store.get(adventureEditorSessionAtom)).toBeNull();
  });

  it("quickItemsAtom defaults to the starter loadout and persists writes to localStorage", async () => {
    localStorage.removeItem("lindocara.quickItems");
    const { alepha } = await renderWithAlepha(<div />);
    alephaInstances.push(alepha);
    expect(alepha.store.get(quickItemsAtom)).toEqual([
      "health_potion",
      "mana_potion",
      "invisibility_potion",
    ]);

    alepha.store.set(quickItemsAtom, [null, "mana_potion", null]);
    expect(JSON.parse(String(localStorage.getItem("lindocara.quickItems")))).toEqual([
      null,
      "mana_potion",
      null,
    ]);
    localStorage.removeItem("lindocara.quickItems");
  });

  // Guards the schema this atom now carries instead of `Type.custom` (see its own docblock): a
  // corrupt/tampered `localStorage` value must fail `StateManager.bindWebStorage()`'s
  // `safeValidate` and fall back to the default — a `Type.custom<T>()` passthrough would have let
  // any of these three flow straight through into `useQuickItem`'s hotkey dispatch instead.
  it.each([
    ["not JSON at all", "{not json"],
    ["the wrong shape entirely", JSON.stringify({ potions: ["health_potion"] })],
    [
      "an unknown consumable id smuggled into a real slot",
      JSON.stringify(["not_a_real_item", null, null]),
    ],
  ])("quickItemsAtom discards a corrupted persisted value (%s) and falls back to the default", async (_case, raw) => {
    localStorage.setItem("lindocara.quickItems", raw);
    const { alepha } = await renderWithAlepha(<div />);
    alephaInstances.push(alepha);

    expect(alepha.store.get(quickItemsAtom)).toEqual([
      "health_potion",
      "mana_potion",
      "invisibility_potion",
    ]);
    // The bad key is discarded, not left behind to keep re-failing on every later read.
    expect(localStorage.getItem("lindocara.quickItems")).toBeNull();
  });

  it("questTrackingAtom defaults to an empty record and round-trips per-quest overrides", async () => {
    const { alepha } = await renderWithAlepha(<div />);
    alephaInstances.push(alepha);
    expect(alepha.store.get(questTrackingAtom)).toEqual({});

    alepha.store.set(questTrackingAtom, { "0001": false });
    expect(alepha.store.get(questTrackingAtom)).toEqual({ "0001": false });
  });
});
