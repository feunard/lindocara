import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../../src/client/i18n.js";
import { useUiStore } from "../../src/client/store.js";
import { PartyScreen } from "../../src/client/ui/PartyScreen.js";

const startGameAsHero = vi.hoisted(() => vi.fn<() => Promise<void>>());
vi.mock("../../src/client/game/session.js", () => ({ startGameAsHero }));

const PARTY = {
  id: "p1",
  name: "Chez Nico",
  adventureId: "adv-1",
  adventureTitle: "Donjon",
  maxPlayers: 4,
  status: "open" as const,
  hostAccountId: "me",
  colors: ["blue" as const],
  mine: true,
  myColor: "blue" as const,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function fetchMock(): ReturnType<typeof vi.fn> {
  const heroes: Record<string, unknown>[] = [];
  return vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (url === "/api/parties/p1/heroes" && method === "GET") return jsonResponse(heroes);
    if (url === "/api/parties/p1/heroes" && method === "POST") {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const hero = {
        id: `h${heroes.length + 1}`,
        partyId: "p1",
        accountId: "me",
        name: body.name,
        class: body.class,
        mapId: "m1",
        x: 0,
        y: 0,
        level: 1,
        xp: 0,
        hp: 100,
        life: "alive",
      };
      heroes.push(hero);
      return jsonResponse(hero, 201);
    }
    return jsonResponse({ error: "not found" }, 404);
  });
}

describe("PartyScreen", () => {
  beforeEach(() => {
    startGameAsHero.mockReset();
    startGameAsHero.mockResolvedValue();
    setLocale("en");
    useUiStore.setState({ screen: "party", accountId: "me", activeParty: PARTY });
  });

  it("creates a hero in the active party and lists it", async () => {
    vi.stubGlobal("fetch", fetchMock());
    render(<PartyScreen />);

    await userEvent.type(await screen.findByLabelText("Hero name"), "Mira");
    await userEvent.selectOptions(screen.getByLabelText("Class"), "priest");
    await userEvent.click(screen.getByRole("button", { name: "Create hero" }));

    expect(await screen.findByText("Mira")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
  });

  it("goes back to the parties list", async () => {
    vi.stubGlobal("fetch", fetchMock());
    render(<PartyScreen />);
    await userEvent.click(await screen.findByRole("button", { name: "Leave" }));
    expect(useUiStore.getState().screen).toBe("parties");
    expect(useUiStore.getState().activeParty).toBeNull();
  });

  it("starts only one hero session while a launch is in flight", async () => {
    vi.stubGlobal("fetch", fetchMock());
    startGameAsHero.mockImplementation(() => new Promise<void>(() => {}));
    render(<PartyScreen />);

    await userEvent.type(await screen.findByLabelText("Hero name"), "Mira");
    await userEvent.click(screen.getByRole("button", { name: "Create hero" }));
    const play = await screen.findByRole("button", { name: "Play" });
    await userEvent.dblClick(play);

    expect(startGameAsHero).toHaveBeenCalledOnce();
    expect(play).toBeDisabled();
  });
});
