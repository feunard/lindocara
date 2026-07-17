import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../../src/client/i18n.js";
import { useUiStore } from "../../src/client/store.js";
import { PartiesScreen } from "../../src/client/ui/PartiesScreen.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function fetchMock() {
  const parties: Record<string, unknown>[] = [];
  return vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (url === "/api/adventures" && method === "GET") {
      return jsonResponse([{ id: "adv-1", title: "Donjon", maxPlayers: 4 }]);
    }
    if (url === "/api/parties" && method === "GET") {
      return jsonResponse(parties);
    }
    if (url === "/api/parties" && method === "POST") {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const stored = {
        id: "p1",
        name: body.name ?? null,
        adventureId: body.adventureId,
        adventureTitle: "Donjon",
        maxPlayers: 4,
        status: "open",
        hostAccountId: "me",
        colors: [body.color],
        mine: true,
        myColor: body.color,
      };
      parties.push(stored);
      return jsonResponse(
        {
          id: "p1",
          adventureId: body.adventureId,
          adventureVersion: 1,
          maxPlayers: 4,
          hostAccountId: "me",
          name: body.name ?? null,
          status: "open",
        },
        201,
      );
    }
    return jsonResponse({ error: "not found" }, 404);
  });
}

describe("PartiesScreen", () => {
  beforeEach(() => {
    setLocale("en");
    useUiStore.setState({ screen: "parties", accountId: "me", activeParty: null });
  });

  it("creates a party from an adventure and enters it", async () => {
    vi.stubGlobal("fetch", fetchMock());
    render(<PartiesScreen />);

    await userEvent.selectOptions(await screen.findByLabelText("Adventure"), "adv-1");
    await userEvent.click(screen.getByRole("button", { name: "Blue" }));
    await userEvent.click(screen.getByRole("button", { name: "Create party" }));

    await waitFor(() => expect(useUiStore.getState().screen).toBe("party"));
    expect(useUiStore.getState().activeParty?.id).toBe("p1");
  });

  it("shows an Enter button for a party the caller belongs to", async () => {
    const mock = fetchMock();
    vi.stubGlobal("fetch", mock);
    // seed one party owned by me via the create endpoint
    await mock("/api/parties", {
      method: "POST",
      body: JSON.stringify({ adventureId: "adv-1", color: "blue" }),
    });
    render(<PartiesScreen />);

    const region = await screen.findByRole("region", { name: "Cooperative parties" });
    const row = await within(region).findByText("Donjon");
    const card = row.closest("article");
    if (!card) throw new Error("expected a party card");
    expect(within(card).getByRole("button", { name: "Enter" })).toBeInTheDocument();
  });
});
