import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { setLocale } from "../../src/client/i18n.js";
import { useUiStore } from "../../src/client/store.js";
import { TitleScreen } from "../../src/client/ui/TitleScreen.js";

describe("TitleScreen", () => {
  beforeEach(() => {
    setLocale("en");
    useUiStore.setState({ screen: "title" });
  });

  it("opens authentication before the saved-parties home", async () => {
    render(<TitleScreen />);
    expect(screen.getByRole("heading", { name: "lindocara" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(useUiStore.getState().screen).toBe("auth");
  });
});
