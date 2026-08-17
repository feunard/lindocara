import { setLocale } from "@lindocara/client/i18n.js";
import { AppRouter } from "@lindocara/client/ui/AppRouter.js";
import { screen, waitFor } from "@testing-library/dom";
import userEvent from "@testing-library/user-event";
import { Alepha } from "alepha";
import { AlephaReact } from "alepha/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * `ReactAuth.login()`/`.ping()` go through Alepha's own `HttpClient`, which decodes every response
 * against a `zod` schema (`tokenResponseSchema`/`userinfoResponseSchema`) BEFORE handing it back —
 * unlike this file's plain-`fetch`-based `register()`/`continueAsGuest()` calls, which read the
 * body as loose JSON. A body missing a required field (`api`, the token fields) fails that decode
 * and rejects the call with a validation error, which `AuthScreen`'s `catch` then maps to the
 * generic error code — so every response standing in for `/_auth/token`/`/_auth/userinfo` below
 * must satisfy both schemas' required shape, not just the `user` field the OLD hand-rolled server
 * ever needed. `actions: {}` is the minimal legal `api` registry; the token fields are otherwise
 * unused by this app.
 */
function tokenBody(user: { id: string; username: string }) {
  return {
    provider: "credentials",
    access_token: "test-token",
    issued_at: Date.now(),
    user,
    api: { actions: {} },
  };
}

function userinfoBody(user?: { id: string; username: string }) {
  return { user, api: { actions: {} } };
}

/** Drops `/api/parties` calls — `MainMenu`'s own "has saves" probe, fired once the auth flow
 *  navigates there, is not what these tests are asserting on. Alepha's root renders under React
 *  StrictMode (`ReactPageProvider.ts`), which double-invokes a freshly-mounted component's
 *  effects, so a bare count is timing-dependent noise; filtering the path out entirely keeps the
 *  auth-flow-specific sequence assertions exact without caring how many times it fired. */
function withoutMainMenuNoise(paths: string[]): string[] {
  return paths.filter((path) => path !== "/api/parties");
}

/** Stubs a single fixed response for every `/_auth/token` call — enough for a login-only flow. */
function stubToken(status: number, body: unknown): ReturnType<typeof vi.fn> {
  const mock = vi.fn().mockResolvedValue(jsonResponse(status, body));
  vi.stubGlobal("fetch", mock);
  return mock;
}

/**
 * Stubs the alepha auth routes by path. `register()` (`api.ts`, unchanged this task) drives three
 * sequential plain-`fetch` calls (`POST /api/users/register` -> `{intentId}`, `POST
 * /api/users/register/complete` -> the created user resource, `POST /_auth/token` -> `{user}`, its
 * own trailing plain-fetch login); `continueAsGuest()` drives the same three. Task 3 adds a FOURTH
 * call after either: `AuthScreen` re-`ping()`s (`GET /_auth/userinfo`) to sync `currentUserAtom`,
 * since neither of those two plain-fetch flows touches the atom itself. The login TAB alone drives
 * only the `/_auth/token` call (via `useAuth().login()`, Alepha's `HttpClient` — no re-ping needed,
 * `ReactAuth.login()` fills the atom itself). Defaults describe a happy path for `username`;
 * callers override only the phase they want to fail.
 */
function stubAuthFlow(
  username: string,
  overrides: {
    intent?: Response;
    complete?: Response;
    token?: Response;
    userinfo?: Response;
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
    if (path.startsWith("/_auth/userinfo")) {
      return Promise.resolve(
        overrides.userinfo ?? jsonResponse(200, userinfoBody({ id: "a", username })),
      );
    }
    if (path.startsWith("/_auth/token")) {
      return Promise.resolve(
        overrides.token ?? jsonResponse(200, tokenBody({ id: "a", username })),
      );
    }
    throw new Error(`auth-screen.test.tsx: unexpected fetch ${path}`);
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

describe("AuthScreen", () => {
  let alepha: Alepha | undefined;

  beforeEach(() => {
    setLocale("en");
    document.title = "";
    document.head.innerHTML = "";
    document.body.innerHTML = '<div id="root"></div>';
    // Mount directly at `/auth`, BEFORE `alepha.start()` — `AppRouter.bootPing` (a `$hook({ on:
    // "start" })` since Task 2's fix round 1, not a React effect) reads `window.location`
    // synchronously, so it sees `/auth` and skips its own automatic ping/guest-fallback entirely
    // (`AppRouter.tsx`'s docblock). Without this, that hook would race every test below with its
    // OWN `continueAsGuest()`/`ping()` calls against the exact same stubbed endpoints.
    history.pushState({}, "", "/auth");
  });

  afterEach(async () => {
    await alepha?.stop();
  });

  async function mount(): Promise<void> {
    alepha = Alepha.create().with(AlephaReact).with(AppRouter);
    await act(async () => {
      await alepha?.start();
    });
    await waitFor(() => expect(document.querySelector(".auth-shell")).toBeTruthy());
  }

  it("switches to register and blocks mismatched passwords client-side", async () => {
    const mock = stubToken(200, {});
    await mount();
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
    // onto the same dictionary entry. `useAuth().login()` throws Alepha's `HttpError`, not this
    // file's `ApiError`; `errorCode()`'s duck-typing fallback (`api.ts`) reads its `.error` field
    // the same way. An error response is decoded against `errorSchema`, not `tokenResponseSchema`
    // — no `api`/token padding needed here.
    stubToken(401, {
      error: "InvalidCredentialsError",
      status: 401,
      message: "Invalid credentials",
    });
    await mount();
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
    const mock = vi.fn((input: RequestInfo | URL) => {
      const path = String(input);
      if (path.startsWith("/_auth/token")) {
        return Promise.resolve(jsonResponse(200, tokenBody({ id: "a", username: "nico" })));
      }
      if (path.startsWith("/api/parties")) {
        // MainMenu's own "has saves" probe, once the router lands there.
        return Promise.resolve(jsonResponse(200, []));
      }
      throw new Error(`unexpected fetch ${path}`);
    });
    vi.stubGlobal("fetch", mock);
    await mount();
    await userEvent.type(screen.getByLabelText("Username"), "nico");
    await userEvent.type(screen.getByLabelText("Password"), "12345678");
    await userEvent.click(screen.getByRole("button", { name: "Play" }));
    await waitFor(() => expect(document.querySelector(".main-menu")).toBeTruthy());
    const paths = mock.mock.calls.map((call) => String(call[0]));
    // `/api/parties` (MainMenu's own "has saves" probe) can legitimately appear more than once —
    // Alepha's root renders under React StrictMode (`ReactPageProvider.ts`), which double-invokes
    // a freshly-mounted component's effects — so this asserts the auth call happened, not an exact
    // trailing count.
    expect(paths[0]).toBe("/_auth/token?provider=credentials");
    expect(paths.slice(1)).toEqual(paths.slice(1).map(() => "/api/parties"));
    expect(paths.length).toBeGreaterThanOrEqual(2);
  });

  it("registers through the two-phase intent flow, then logs in", async () => {
    const mock = stubAuthFlow("nico");
    await mount();
    await userEvent.click(screen.getByRole("button", { name: "New here? Create an account" }));
    await userEvent.type(screen.getByLabelText("Username"), "nico");
    await userEvent.type(screen.getByLabelText("Password"), "12345678");
    await userEvent.type(screen.getByLabelText("Confirm password"), "12345678");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(document.querySelector(".auth-shell")).toBeNull());

    const paths = withoutMainMenuNoise(mock.mock.calls.map((call) => String(call[0])));
    expect(paths).toEqual([
      "/api/users/register",
      "/api/users/register/complete",
      "/_auth/token?provider=credentials",
      "/_auth/userinfo",
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
    await mount();
    await userEvent.click(screen.getByRole("button", { name: "New here? Create an account" }));
    await userEvent.type(screen.getByLabelText("Username"), "nico");
    await userEvent.type(screen.getByLabelText("Password"), "12345678");
    await userEvent.type(screen.getByLabelText("Confirm password"), "12345678");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That username is already taken.");
  });
});
