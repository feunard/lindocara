import { ApiError } from "@lindocara/client/api.js";
import { leaveAdventureTest } from "@lindocara/client/game/adventure-test.js";
import type { GameNavigation } from "@lindocara/client/state/navigation.js";
import { setGameNavigation } from "@lindocara/client/state/navigation.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({ remove: vi.fn() }));
vi.mock("@lindocara/client/api.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@lindocara/client/api.js")>()),
  deleteAdventureTestSessionApi: apiMock.remove,
}));

// Only the teardown is stubbed: the real one constructs nothing here (no session was ever
// launched), so a stub is what lets the ORDER of operations be asserted at all.
const stop = vi.hoisted(() => vi.fn());
vi.mock("@lindocara/client/game/session.js", () => ({ stopActiveGameSession: stop }));

const SESSION = { id: "test-1" } as ReturnType<
  NonNullable<GameNavigation["getAdventureTestSession"]>
>;

function fakeNavigation(session: unknown = SESSION): GameNavigation {
  return {
    toGame: vi.fn(),
    toMenu: vi.fn(),
    toAuth: vi.fn(),
    toEditor: vi.fn(),
    setActiveParty: vi.fn(),
    getActiveParty: () => null,
    setAdventureTestSession: vi.fn(),
    getAdventureTestSession: () => session as never,
    getQuickItems: () => [null, null, null],
    logout: vi.fn(),
  };
}

describe("leaveAdventureTest", () => {
  beforeEach(() => {
    apiMock.remove.mockReset();
    stop.mockReset();
  });
  afterEach(() => setGameNavigation(null));

  it("deletes the envelope, tears the runtime down and lands in the editor", async () => {
    apiMock.remove.mockResolvedValue(undefined);
    const nav = fakeNavigation();
    setGameNavigation(nav);

    await expect(leaveAdventureTest()).resolves.toBeNull();

    expect(apiMock.remove).toHaveBeenCalledWith("test-1");
    expect(stop).toHaveBeenCalledTimes(1);
    expect(nav.setAdventureTestSession).toHaveBeenCalledWith(null);
    expect(nav.setActiveParty).toHaveBeenCalledWith(null);
    expect(nav.toEditor).toHaveBeenCalledTimes(1);

    // The order is the load-bearing part: the session atom is still set while the teardown runs,
    // which is how `returnFromGameSession` knows to head for the editor and not the main menu.
    const stopOrder = stop.mock.invocationCallOrder[0] ?? 0;
    const clearOrder =
      vi.mocked(nav.setAdventureTestSession).mock.invocationCallOrder[0] ?? Number.NaN;
    expect(stopOrder).toBeLessThan(clearOrder);
  });

  it("keeps the creator inside the test when the delete fails, and reports the code", async () => {
    apiMock.remove.mockRejectedValue(new ApiError("ServiceUnavailableError"));
    const nav = fakeNavigation();
    setGameNavigation(nav);

    await expect(leaveAdventureTest()).resolves.toBe("ServiceUnavailableError");

    // Nothing was torn down: a failed exit must not half-leave a session it could not delete.
    expect(stop).not.toHaveBeenCalled();
    expect(nav.setAdventureTestSession).not.toHaveBeenCalled();
    expect(nav.toEditor).not.toHaveBeenCalled();
  });

  it("treats an already-expired envelope as a clean exit", async () => {
    apiMock.remove.mockRejectedValue(new ApiError("adventure_test_not_found"));
    const nav = fakeNavigation();
    setGameNavigation(nav);

    await expect(leaveAdventureTest()).resolves.toBeNull();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(nav.toEditor).toHaveBeenCalledTimes(1);
  });

  it("does nothing at all when no test is running", async () => {
    const nav = fakeNavigation(null);
    setGameNavigation(nav);

    await expect(leaveAdventureTest()).resolves.toBeNull();
    expect(apiMock.remove).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
    expect(nav.toEditor).not.toHaveBeenCalled();
  });
});
