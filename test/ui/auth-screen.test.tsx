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

  it("switches tabs and blocks mismatched register passwords client-side", async () => {
    const mock = stubFetch(200, {});
    render(<AuthScreen />);
    await userEvent.click(screen.getByRole("tab", { name: "Create account" }));
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

  it("moves to the characters screen on successful login", async () => {
    stubFetch(200, { id: "a", username: "nico" });
    render(<AuthScreen />);
    await userEvent.type(screen.getByLabelText("Username"), "nico");
    await userEvent.type(screen.getByLabelText("Password"), "12345678");
    await userEvent.click(screen.getByRole("button", { name: "Enter the Hollow" }));
    await vi.waitFor(() => expect(useUiStore.getState().screen).toBe("characters"));
  });
});
