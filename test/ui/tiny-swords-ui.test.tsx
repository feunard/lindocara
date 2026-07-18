import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyTinySwordsTheme } from "../../src/client/game/tiny-swords-assets.js";
import { AssetBrowser, resetTinySwordsCatalogForTests } from "../../src/client/ui/AssetBrowser.js";
import { Button } from "../../src/client/ui/pixelact-ui/button/index.js";
import { TinyPanel } from "../../src/client/ui/tiny-swords/TinyPanel.js";
import { TinyRange } from "../../src/client/ui/tiny-swords/TinyRange.js";

const entries = [
  {
    id: "decoration.terrain-decorations-rocks.rock1",
    sourcePath: "Tiny Swords (Free Pack)/Terrain/Decorations/Rocks/Rock1.png",
    pack: "Tiny Swords (Free Pack)",
    domain: "decoration",
    category: "terrain-decorations-rocks",
    tags: ["rock", "stone"],
    width: 64,
    height: 64,
    nature: "static",
    classification: { status: "catalogued", role: "Static rock" },
    editor: {
      allowedTerrain: ["grass"],
      renderLayer: "ground",
      visualFootprint: { cols: 1, rows: 1 },
      collisionFootprint: [],
      behavior: "static",
    },
  },
  {
    id: "ui.cursor.default",
    sourcePath: "Tiny Swords (Free Pack)/UI Elements/UI Elements/Cursors/Cursor_01.png",
    pack: "Tiny Swords (Free Pack)",
    domain: "ui",
    category: "ui-elements-cursors",
    tags: ["cursor"],
    width: 32,
    height: 32,
    nature: "static",
    classification: { status: "catalogued", role: "Default cursor" },
  },
] as const;

describe("Tiny Swords UI foundation", () => {
  beforeEach(() => {
    resetTinySwordsCatalogForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps authored button states, keyboard activation, focus and disabled behavior", async () => {
    const action = vi.fn();
    const user = userEvent.setup();
    render(
      <>
        <Button onClick={action}>Continue</Button>
        <Button disabled onClick={action}>
          Locked
        </Button>
      </>,
    );
    const enabled = screen.getByRole("button", { name: "Continue" });
    expect(enabled).toHaveAttribute("data-tiny-normal");
    expect(enabled).toHaveAttribute("data-tiny-hover");
    expect(enabled).toHaveAttribute("data-tiny-pressed");
    expect(enabled).toHaveAttribute("data-tiny-disabled");
    await user.tab();
    expect(enabled).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(action).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Locked" }));
    expect(action).toHaveBeenCalledOnce();
  });

  it("publishes cursor fallbacks and an extensible panel slice", () => {
    const root = document.createElement("div");
    applyTinySwordsTheme(root);
    expect(root.style.getPropertyValue("--tiny-cursor-default")).toMatch(/, default$/);
    expect(root.style.getPropertyValue("--tiny-cursor-link")).toMatch(/, pointer$/);
    render(<TinyPanel data-testid="panel" />);
    expect(screen.getByTestId("panel")).toHaveAttribute("data-tiny-slice", "64 64 64 64");
  });

  it("assembles range tracks from the authored left, middle and right bar cells", () => {
    render(<TinyRange aria-label="Volume" />);
    const slider = screen.getByRole("slider", { name: "Volume" });
    expect(slider).toHaveClass("tiny-range");
    expect(slider.parentElement?.querySelector("[data-tiny-bar-track]")?.children).toHaveLength(3);
  });

  it("searches and filters the progressively loaded asset catalogue", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ version: 1, entries }) }),
    );
    const user = userEvent.setup();
    render(<AssetBrowser />);
    await user.click(screen.getByText("Tiny Swords asset browser"));
    expect(await screen.findByText(entries[0].id)).toBeInTheDocument();
    expect(screen.getByText("Available in the map editor")).toBeInTheDocument();
    await user.type(screen.getByRole("searchbox"), "cursor");
    expect(screen.getByText(entries[1].id)).toBeInTheDocument();
    expect(screen.queryByText(entries[0].id)).not.toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox", { name: "Domain" }), "decoration");
    await user.clear(screen.getByRole("searchbox"));
    expect(screen.getByText(entries[0].id)).toBeInTheDocument();
    expect(screen.queryByText(entries[1].id)).not.toBeInTheDocument();
  });

  it("reports a catalogue loading error without crashing the interface", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("storage unavailable")));
    render(<AssetBrowser />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });
});
