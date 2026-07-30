import { setLocale } from "@lindocara/client/i18n.js";
import { useUiStore } from "@lindocara/client/store.js";
import { AuthScreen } from "@lindocara/client/ui/AuthScreen.js";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Stubs a single fixed response for every fetch call — enough for a login-only flow (one call:
 *  `POST /_auth/token`). */
function stubFetch(status: number, body: unknown): ReturnType<typeof vi.fn> {
  const mock = vi.fn().mockResolvedValue(jsonResponse(status, body));
  vi.stubGlobal("fetch", mock);
  return mock;
}

/**
 * Stubs the alepha auth routes by path, since `register()` drives three sequential calls with
 * three different response shapes (`POST /api/users/register` -> `{intentId}`, `POST
 * /api/users/register/complete` -> the created user resource, `POST /_auth/token` -> `{user}`) and
 * `login()` alone drives the last of those. Defaults describe a happy path for `username`; callers
 * override only the phase they want to fail.
 */
function stubAuthFlow(
  username: string,
  overrides: {
    intent?: Response;
    complete?: Response;
    token?: Response;
  } = {},
): ReturnType<typeof vi.fn> {
  const mock = vi.fn((input: RequestInfo | URL) => {
    const path = String(input);
    if (path.startsWith("/api/users/register/complete")) {
      return Promise.resolve(overrides.complete ?? jsonResponse(200, { id: "a", username }));
    }
    if (path.startsWith("/api/users/register")) {
      return Promise.resolve(
        overrides.intent ??
          jsonResponse(200, {
            intentId: "intent-1",
            expectEmailVerification: false,
            expectPhoneVerification: false,
            expiresAt: new Date().toISOString(),
          }),
      );
    }
    if (path.startsWith("/_auth/token")) {
      return Promise.resolve(overrides.token ?? jsonResponse(200, { user: { id: "a", username } }));
    }
    throw new Error(`auth-screen.test.tsx: unexpected fetch ${path}`);
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

describe("AuthScreen", () => {
  beforeEach(() => {
    setLocale("en");
    useUiStore.setState({ screen: "auth" });
  });

  it("switches to register and blocks mismatched passwords client-side", async () => {
    const mock = stubFetch(200, {});
    render(<AuthScreen />);
    await userEvent.click(screen.getByRole("button", { name: "New here? Create an account" }));
    await userEvent.type(screen.getByLabelText("Username"), "nico");
    await userEvent.type(screen.getByLabelText("Password"), "12345678");
    await userEvent.type(screen.getByLabelText("Confirm password"), "87654321");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Passwords do not match.");
    expect(mock).not.toHaveBeenCalled();
  });

  it("shows the machine-code error localized, and re-localizes on toggle", async () => {
    // `POST /_auth/token` rejects wrong credentials with Alepha's own `InvalidCredentialsError`
    // (401), not this app's legacy `invalid_credentials` code — `ERROR_KEYS` maps the class name
    // onto the same dictionary entry.
    stubFetch(401, {
      error: "InvalidCredentialsError",
      status: 401,
      message: "Invalid credentials",
    });
    render(<AuthScreen />);
    await userEvent.type(screen.getByLabelText("Username"), "nico");
    await userEvent.type(screen.getByLabelText("Password"), "12345678");
    await userEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Wrong username or password.");
    setLocale("fr");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Nom d'utilisateur ou mot de passe incorrect.",
    );
  });

  it("moves to the saved-parties home on successful login", async () => {
    stubFetch(200, { user: { id: "a", username: "nico" } });
    render(<AuthScreen />);
    await userEvent.type(screen.getByLabelText("Username"), "nico");
    await userEvent.type(screen.getByLabelText("Password"), "12345678");
    await userEvent.click(screen.getByRole("button", { name: "Play" }));
    await vi.waitFor(() => expect(useUiStore.getState().screen).toBe("menu"));
  });

  it("registers through the two-phase intent flow, then logs in", async () => {
    const mock = stubAuthFlow("nico");
    render(<AuthScreen />);
    await userEvent.click(screen.getByRole("button", { name: "New here? Create an account" }));
    await userEvent.type(screen.getByLabelText("Username"), "nico");
    await userEvent.type(screen.getByLabelText("Password"), "12345678");
    await userEvent.type(screen.getByLabelText("Confirm password"), "12345678");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    await vi.waitFor(() => expect(useUiStore.getState().screen).toBe("menu"));

    const paths = mock.mock.calls.map((call) => String(call[0]));
    expect(paths).toEqual([
      "/api/users/register",
      "/api/users/register/complete",
      "/_auth/token?provider=credentials",
    ]);
    const intentBody = JSON.parse(String(mock.mock.calls[0]?.[1]?.body)) as {
      username: string;
      password: string;
    };
    expect(intentBody).toEqual({ username: "nico", password: "12345678" });
    const completeBody = JSON.parse(String(mock.mock.calls[1]?.[1]?.body)) as { intentId: string };
    expect(completeBody).toEqual({ intentId: "intent-1" });
  });

  it("shows a taken username localized during registration", async () => {
    // Phase 1 rejects with Alepha's own `ConflictError` (409) for any taken identifier — see
    // `ERROR_KEYS`.
    stubAuthFlow("nico", {
      intent: jsonResponse(409, {
        error: "ConflictError",
        status: 409,
        message: "These registration details are not available",
      }),
    });
    render(<AuthScreen />);
    await userEvent.click(screen.getByRole("button", { name: "New here? Create an account" }));
    await userEvent.type(screen.getByLabelText("Username"), "nico");
    await userEvent.type(screen.getByLabelText("Password"), "12345678");
    await userEvent.type(screen.getByLabelText("Confirm password"), "12345678");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That username is already taken.");
  });

  describe("continue as guest", () => {
    beforeEach(() => localStorage.clear());

    it("registers a fresh guest and keeps the credential for the next visit", async () => {
      const mock = stubAuthFlow("guest-abcdefghij");
      render(<AuthScreen />);
      await userEvent.click(screen.getByRole("button", { name: "Continue as guest" }));
      await vi.waitFor(() => expect(useUiStore.getState().screen).toBe("menu"));

      const paths = mock.mock.calls.map((call) => String(call[0]));
      expect(paths).toEqual([
        "/api/users/register",
        "/api/users/register/complete",
        "/_auth/token?provider=credentials",
      ]);
      // The credential is minted client-side, so the server must never be asked to invent one.
      const sent = JSON.parse(String(mock.mock.calls[0]?.[1]?.body)) as {
        username: string;
        password: string;
      };
      expect(sent.username).toMatch(/^guest-[a-z0-9]{10}$/);
      expect(sent.password).toHaveLength(32);
      expect(JSON.parse(String(localStorage.getItem("lindocara.guest")))).toEqual(sent);
    });

    it("logs the stored guest back in instead of minting a second account", async () => {
      const stored = { username: "guest-abcdefghij", password: "x".repeat(32) };
      localStorage.setItem("lindocara.guest", JSON.stringify(stored));
      const mock = stubFetch(200, { user: { id: "a", username: stored.username } });
      render(<AuthScreen />);
      await userEvent.click(screen.getByRole("button", { name: "Continue as guest" }));
      await vi.waitFor(() => expect(useUiStore.getState().screen).toBe("menu"));

      expect(mock).toHaveBeenCalledTimes(1);
      const [path, init] = mock.mock.calls[0] as [string, RequestInit];
      expect(path).toBe("/_auth/token?provider=credentials");
      expect(JSON.parse(String(init.body))).toEqual(stored);
    });

    it("ignores a stored guest that the server no longer knows", async () => {
      localStorage.setItem(
        "lindocara.guest",
        JSON.stringify({ username: "guest-abcdefghij", password: "x".repeat(32) }),
      );
      // The login is refused, so the flow has to fall through to a brand new registration rather
      // than stranding the player on a credential they can neither see nor retype. Only the FIRST
      // `/_auth/token` call is the stale-guest login; `register()`'s own trailing login (once the
      // fresh account exists) must succeed, so the rejection is one-shot, not path-keyed.
      let tokenCalls = 0;
      const mock = vi.fn((input: RequestInfo | URL) => {
        const path = String(input);
        if (path.startsWith("/_auth/token")) {
          tokenCalls += 1;
          if (tokenCalls === 1) {
            return Promise.resolve(
              jsonResponse(401, {
                error: "InvalidCredentialsError",
                status: 401,
                message: "Invalid credentials",
              }),
            );
          }
          return Promise.resolve(
            jsonResponse(200, { user: { id: "a", username: "guest-newnewnew" } }),
          );
        }
        if (path.startsWith("/api/users/register/complete")) {
          return Promise.resolve(jsonResponse(200, { id: "a", username: "guest-newnewnew" }));
        }
        if (path.startsWith("/api/users/register")) {
          return Promise.resolve(
            jsonResponse(200, {
              intentId: "intent-2",
              expectEmailVerification: false,
              expectPhoneVerification: false,
              expiresAt: new Date().toISOString(),
            }),
          );
        }
        throw new Error(`unexpected fetch ${path}`);
      });
      vi.stubGlobal("fetch", mock);

      render(<AuthScreen />);
      await userEvent.click(screen.getByRole("button", { name: "Continue as guest" }));
      await vi.waitFor(() => expect(useUiStore.getState().screen).toBe("menu"));

      const paths = mock.mock.calls.map((call) => String(call[0]));
      expect(paths).toEqual([
        "/_auth/token?provider=credentials",
        "/api/users/register",
        "/api/users/register/complete",
        "/_auth/token?provider=credentials",
      ]);
      const replaced = JSON.parse(String(localStorage.getItem("lindocara.guest"))) as {
        username: string;
      };
      expect(replaced.username).not.toBe("guest-abcdefghij");
    });

    it("refuses a tampered credential in storage rather than sending it", async () => {
      localStorage.setItem(
        "lindocara.guest",
        JSON.stringify({ username: "!!", password: "short" }),
      );
      const mock = stubAuthFlow("guest-abcdefghij");
      render(<AuthScreen />);
      await userEvent.click(screen.getByRole("button", { name: "Continue as guest" }));
      await vi.waitFor(() => expect(useUiStore.getState().screen).toBe("menu"));

      // Straight to register: storage is user-writable, so it is validated like any wire input.
      const paths = mock.mock.calls.map((call) => String(call[0]));
      expect(paths).toEqual([
        "/api/users/register",
        "/api/users/register/complete",
        "/_auth/token?provider=credentials",
      ]);
    });
  });
});
