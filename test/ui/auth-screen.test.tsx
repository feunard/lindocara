import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../../src/client/i18n.js";
import { useUiStore } from "../../src/client/store.js";
import { AuthScreen } from "../../src/client/ui/AuthScreen.js";

function stubFetch(status: number, body: unknown): ReturnType<typeof vi.fn> {
  const mock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
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
    stubFetch(401, { error: "invalid_credentials" });
    render(<AuthScreen />);
    await userEvent.type(screen.getByLabelText("Username"), "nico");
    await userEvent.type(screen.getByLabelText("Password"), "12345678");
    await userEvent.click(screen.getByRole("button", { name: "Enter the Hollow" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Wrong username or password.");
    setLocale("fr");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Nom d'utilisateur ou mot de passe incorrect.",
    );
  });

  it("moves to the saved-parties home on successful login", async () => {
    stubFetch(200, { id: "a", username: "nico" });
    render(<AuthScreen />);
    await userEvent.type(screen.getByLabelText("Username"), "nico");
    await userEvent.type(screen.getByLabelText("Password"), "12345678");
    await userEvent.click(screen.getByRole("button", { name: "Enter the Hollow" }));
    await vi.waitFor(() => expect(useUiStore.getState().screen).toBe("parties"));
  });

  describe("continue as guest", () => {
    beforeEach(() => localStorage.clear());

    it("registers a fresh guest and keeps the credential for the next visit", async () => {
      const mock = stubFetch(200, { id: "a", username: "guest-abcdefghij" });
      render(<AuthScreen />);
      await userEvent.click(screen.getByRole("button", { name: "Continue as guest" }));
      await vi.waitFor(() => expect(useUiStore.getState().screen).toBe("parties"));

      expect(mock).toHaveBeenCalledTimes(1);
      const [path, init] = mock.mock.calls[0] as [string, RequestInit];
      expect(path).toBe("/api/register");
      // The credential is minted client-side, so the server must never be asked to invent one.
      const sent = JSON.parse(String(init.body)) as { username: string; password: string };
      expect(sent.username).toMatch(/^guest-[a-z0-9]{10}$/);
      expect(sent.password).toHaveLength(32);
      expect(JSON.parse(String(localStorage.getItem("lindocara.guest")))).toEqual(sent);
    });

    it("logs the stored guest back in instead of minting a second account", async () => {
      const stored = { username: "guest-abcdefghij", password: "x".repeat(32) };
      localStorage.setItem("lindocara.guest", JSON.stringify(stored));
      const mock = stubFetch(200, { id: "a", username: stored.username });
      render(<AuthScreen />);
      await userEvent.click(screen.getByRole("button", { name: "Continue as guest" }));
      await vi.waitFor(() => expect(useUiStore.getState().screen).toBe("parties"));

      expect(mock).toHaveBeenCalledTimes(1);
      const [path, init] = mock.mock.calls[0] as [string, RequestInit];
      expect(path).toBe("/api/session");
      expect(JSON.parse(String(init.body))).toEqual(stored);
    });

    it("ignores a stored guest that the server no longer knows", async () => {
      localStorage.setItem(
        "lindocara.guest",
        JSON.stringify({ username: "guest-abcdefghij", password: "x".repeat(32) }),
      );
      // The login is refused, so the flow has to fall through to a brand new registration rather
      // than stranding the player on a credential they can neither see nor retype.
      const mock = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ error: "invalid_credentials" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          }),
        )
        .mockResolvedValue(
          new Response(JSON.stringify({ id: "a", username: "guest-newnewnew" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      vi.stubGlobal("fetch", mock);

      render(<AuthScreen />);
      await userEvent.click(screen.getByRole("button", { name: "Continue as guest" }));
      await vi.waitFor(() => expect(useUiStore.getState().screen).toBe("parties"));

      expect(mock.mock.calls.map(([path]) => path)).toEqual(["/api/session", "/api/register"]);
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
      const mock = stubFetch(200, { id: "a", username: "guest-abcdefghij" });
      render(<AuthScreen />);
      await userEvent.click(screen.getByRole("button", { name: "Continue as guest" }));
      await vi.waitFor(() => expect(useUiStore.getState().screen).toBe("parties"));

      // Straight to register: storage is user-writable, so it is validated like any wire input.
      expect(mock.mock.calls.map(([path]) => path)).toEqual(["/api/register"]);
    });
  });
});
