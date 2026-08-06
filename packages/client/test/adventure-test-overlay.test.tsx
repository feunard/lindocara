import { emptyDraft } from "@lindocara/client/adventure-draft.js";
import { setLocale, t } from "@lindocara/client/i18n.js";
import {
  activePartyAtom,
  adventureEditorSessionAtom,
  adventureTestSessionAtom,
} from "@lindocara/client/state/atoms.js";
import type { GameHandle, SelfHud } from "@lindocara/client/store.js";
import { useUiStore } from "@lindocara/client/store.js";
import { AppRouter } from "@lindocara/client/ui/AppRouter.js";
import type { SelfState } from "@lindocara/engine/protocol.js";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Alepha } from "alepha";
import { AlephaReact } from "alepha/react";
import { ReactRouter } from "alepha/react/router";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({ create: vi.fn(), remove: vi.fn() }));
vi.mock("@lindocara/client/api.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@lindocara/client/api.js")>()),
  createAdventureTestSessionApi: apiMock.create,
  deleteAdventureTestSessionApi: apiMock.remove,
}));

const sessionMock = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn() }));
vi.mock("@lindocara/client/game/session.js", async () => {
  // The store is imported INSIDE the factory: `vi.mock` is hoisted above every import, so reaching
  // this file's own top-level `useUiStore` binding from here would be a temporal-dead-zone bet.
  const { useUiStore: store } = await import("@lindocara/client/store.js");
  return {
    startGameAsHero: sessionMock.start,
    // The real `stopActiveGameSession` clears `store.game` SYNCHRONOUSLY before anything navigates,
    // which is precisely what makes `AppLayout`'s leave-`/game` effect a no-op on a sanctioned exit
    // (see that effect's own docblock). The stub has to do the same, or the pathname change it
    // triggers comes straight back round and calls it a second time. This was latent until S3
    // stubbed the `/editor` route: while that route lazy-loaded the real editor chunk, the
    // navigation never completed inside the test window and the second call never happened.
    stopActiveGameSession: (...args: unknown[]) => {
      store.setState({ game: null, heroLoading: null });
      return sessionMock.stop(...args);
    },
  };
});

function fakeGameHandle(): GameHandle {
  return {
    attack: vi.fn(),
    interact: vi.fn(),
    usePotion: vi.fn(),
    release: vi.fn(),
    castSkill: vi.fn(),
    sendChat: vi.fn(),
    switchCharacter: vi.fn(),
    logout: vi.fn(),
    returnToTitle: vi.fn(),
    attachMinimap: vi.fn(),
    attachWorldMap: vi.fn(),
  };
}

// `Hud` (mounted inside `GameScreen`) renders nothing without a self snapshot — the `/game` route
// needs both a live `GameHandle` (the loader guard) and these to actually show the HUD tree the
// overlay lives beside, mirroring `game-route.test.tsx`'s own fixtures.
const SELF_FIXTURE: SelfHud = {
  nick: "Testeur",
  level: 1,
  hp: 100,
  maxHp: 100,
  life: "alive",
  corpseDistance: null,
  class: "ranger",
  appearance: { body: "wayfarer", primaryColor: "azure" },
  equipment: { mainHand: "hunter_bow", offHand: null },
};

const SELF_STATE_FIXTURE: SelfState = {
  xp: 0,
  xpToNext: 100,
  life: "alive",
  corpse: null,
  displacement: { seq: 0, x: 0, y: 0, z: 0 },
  inventory: { potions: 0, gold: 0, crystals: 0 },
  quest: { status: "available", progress: 0, target: 0 },
};

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

function stubFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.startsWith("/_auth/userinfo")) {
        return new Response(
          JSON.stringify({ user: { id: "acc-1", username: "nico" }, api: { actions: {} } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (path.startsWith("/api/parties")) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`adventure-test-overlay.test.tsx: unexpected fetch ${path}`);
    }),
  );
}

/**
 * `AdventureTestOverlay` mounts inside `AppRouter.tsx`'s `GameScreen` — reading the game bridge
 * (zustand) and the test/editor-session atoms directly, and (Task 6) navigating back to the editor
 * through `useRouter()` on exit. Testing it standalone would need to fake both a Router and every
 * atom by hand; booting the real `AppRouter` (the same harness `game-route.test.tsx` uses) and
 * landing on `/game` with a live fake `GameHandle` exercises the actual mounted component instead.
 */
async function mountOnGameWithTestSession(): Promise<{
  alepha: Alepha;
  router: ReactRouter<AppRouter>;
}> {
  const alepha = Alepha.create().with(AlephaReact).with(AppRouter);
  await act(async () => {
    await alepha.start();
  });
  const router = alepha.inject(ReactRouter<AppRouter>);
  await act(async () => {
    await router.push("/menu");
  });
  await waitFor(() => expect(document.querySelector(".main-menu")).toBeTruthy());

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
    game: fakeGameHandle(),
    self: SELF_FIXTURE,
    selfState: SELF_STATE_FIXTURE,
  });
  alepha.store.set(adventureEditorSessionAtom, {
    adventureId: "adventure-1",
    draftId: "draft-1",
    draft,
    invalidatedLinks: [],
    savedDraft: JSON.stringify(draft),
  });
  alepha.store.set(activePartyAtom, testSession.party);
  alepha.store.set(adventureTestSessionAtom, testSession);

  await act(async () => {
    await router.push("/game");
  });
  await waitFor(() => expect(document.querySelector("#hud")).toBeTruthy());

  return { alepha, router };
}

describe("AdventureTestOverlay", () => {
  let alepha: Alepha | undefined;

  beforeEach(() => {
    setLocale("en");
    document.title = "";
    document.head.innerHTML = "";
    document.body.innerHTML = '<div id="root"></div>';
    stubFetch();
    apiMock.create.mockReset();
    apiMock.remove.mockReset();
    sessionMock.start.mockReset();
    sessionMock.stop.mockReset();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
    useUiStore.setState({ game: null, heroLoading: null, self: null, selfState: null });
  });

  it("makes isolation and the readable selected map explicit", async () => {
    const result = await mountOnGameWithTestSession();
    alepha = result.alepha;
    expect(screen.getByText(t("editor.test.overlay.badge"))).toBeInTheDocument();
    expect(screen.getByText(t("editor.test.overlay.title"))).toBeInTheDocument();
    expect(screen.getByText(t("editor.test.overlay.start", { name: "Caves" }))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("editor.test.exit") })).toHaveClass(
      "bg-white",
      "text-zinc-950",
      "disabled:text-zinc-500",
    );
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
    const result = await mountOnGameWithTestSession();
    alepha = result.alepha;

    await userEvent.click(screen.getByRole("button", { name: t("editor.test.reset") }));
    await waitFor(() => expect(sessionMock.start).toHaveBeenCalledTimes(1));
    expect(apiMock.create).toHaveBeenCalledWith("adventure-1", {
      startMapId: "map-2",
      heroClass: "ranger",
    });
    expect(alepha.store.get(adventureTestSessionAtom)).toEqual(replacement);
    expect(sessionMock.start).toHaveBeenCalledWith(replacement.hero, replacement.party);
  });

  it("deletes the disposable party and navigates back to the editor route on exit", async () => {
    apiMock.remove.mockResolvedValue(undefined);
    const result = await mountOnGameWithTestSession();
    alepha = result.alepha;
    const { router } = result;
    // Spy rather than assert on what `/editor` renders: this test asserts that exiting ROUTES to
    // the editor, not what that route draws. (It drew the real `@lindocara/editor` shell until S3
    // quarantined the package; today it is a notice. Either way, not this test's business.)
    const pushSpy = vi.spyOn(router, "push");

    await userEvent.click(screen.getByRole("button", { name: t("editor.test.exit") }));
    await waitFor(() => expect(apiMock.remove).toHaveBeenCalledWith("test-1"));
    expect(sessionMock.stop).toHaveBeenCalledTimes(1);
    expect(alepha.store.get(activePartyAtom)).toBeNull();
    expect(alepha.store.get(adventureTestSessionAtom)).toBeNull();
    await waitFor(() => expect(pushSpy).toHaveBeenCalledWith("editor"));
  });
});
