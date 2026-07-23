import { emptyDraft } from "@lindocara/client/adventure-draft.js";
import { setLocale, t } from "@lindocara/client/i18n.js";
import { useUiStore } from "@lindocara/client/store.js";
import { AdventureTestOverlay } from "@lindocara/client/ui/AdventureTestOverlay.js";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({ create: vi.fn(), remove: vi.fn() }));
vi.mock("@lindocara/client/api.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@lindocara/client/api.js")>()),
  createAdventureTestSessionApi: apiMock.create,
  deleteAdventureTestSessionApi: apiMock.remove,
}));

const sessionMock = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn() }));
vi.mock("@lindocara/client/game/session.js", () => ({
  startGameAsHero: sessionMock.start,
  stopActiveGameSession: sessionMock.stop,
}));

const testSession = {
  id: "test-1",
  adventureId: "adventure-1",
  startMapId: "map-2",
  expiresAt: Date.now() + 60_000,
  diagnostics: [],
  party: {
    id: "party-1",
    name: null,
    adventureId: "adventure-1",
    adventureTitle: "Lab",
    maxPlayers: 1,
    status: "open" as const,
    hostAccountId: "account-1",
    colors: ["blue" as const],
    mine: true,
    myColor: "blue" as const,
  },
  hero: {
    id: "hero-1",
    partyId: "party-1",
    accountId: "account-1",
    name: "Testeur",
    class: "ranger" as const,
    mapId: "map-2",
    x: 96,
    y: 96,
    level: 1,
    xp: 0,
    hp: 100,
    life: "alive" as const,
  },
};

function seedStore() {
  const draft = emptyDraft();
  draft.title = "Lab";
  draft.members = [
    {
      mapId: "map-2",
      name: "Caves",
      revision: 1,
      solid: ["....."],
      monsterCount: 0,
      entryIds: [],
      exitIds: [],
      entryLabels: {},
      exitLabels: {},
    },
  ];
  useUiStore.setState({
    screen: "game",
    activeParty: testSession.party,
    adventureTestSession: testSession,
    adventureEditorSession: {
      adventureId: "adventure-1",
      draftId: "draft-1",
      draft,
      invalidatedLinks: [],
      savedDraft: JSON.stringify(draft),
    },
  });
}

describe("AdventureTestOverlay", () => {
  beforeEach(() => {
    setLocale("en");
    apiMock.create.mockReset();
    apiMock.remove.mockReset();
    sessionMock.start.mockReset();
    sessionMock.stop.mockReset();
    seedStore();
  });

  it("makes isolation and the readable selected map explicit", () => {
    render(<AdventureTestOverlay />);
    expect(screen.getByText(t("editor.test.overlay.badge"))).toBeInTheDocument();
    expect(screen.getByText(t("editor.test.overlay.title"))).toBeInTheDocument();
    expect(screen.getByText(t("editor.test.overlay.start", { name: "Caves" }))).toBeInTheDocument();
  });

  it("replaces the authoritative session when reset is requested", async () => {
    const replacement = {
      ...testSession,
      id: "test-2",
      party: { ...testSession.party, id: "party-2" },
      hero: { ...testSession.hero, id: "hero-2", partyId: "party-2" },
    };
    apiMock.create.mockResolvedValue(replacement);
    sessionMock.start.mockResolvedValue(undefined);
    render(<AdventureTestOverlay />);

    await userEvent.click(screen.getByRole("button", { name: t("editor.test.reset") }));
    await waitFor(() => expect(sessionMock.start).toHaveBeenCalledTimes(1));
    expect(apiMock.create).toHaveBeenCalledWith("adventure-1", {
      startMapId: "map-2",
      heroClass: "ranger",
    });
    expect(useUiStore.getState().adventureTestSession).toEqual(replacement);
    expect(sessionMock.start).toHaveBeenCalledWith(replacement.hero, replacement.party);
  });

  it("deletes the disposable party before returning to the editor", async () => {
    apiMock.remove.mockResolvedValue(undefined);
    render(<AdventureTestOverlay />);

    await userEvent.click(screen.getByRole("button", { name: t("editor.test.exit") }));
    await waitFor(() => expect(apiMock.remove).toHaveBeenCalledWith("test-1"));
    expect(sessionMock.stop).toHaveBeenCalledTimes(1);
    expect(useUiStore.getState()).toMatchObject({
      screen: "adventure-editor",
      activeParty: null,
      adventureTestSession: null,
    });
  });
});
