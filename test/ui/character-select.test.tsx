import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CharacterSummary } from "../../src/client/api.js";
import { setLocale } from "../../src/client/i18n.js";
import { useUiStore } from "../../src/client/store.js";
import { CharacterSelect } from "../../src/client/ui/CharacterSelect.js";

const three: CharacterSummary[] = [
  { id: "1", name: "One", appearance: "azure", level: 1 },
  { id: "2", name: "Two", appearance: "ember", level: 2 },
  { id: "3", name: "Three", appearance: "moss", level: 3 },
];

describe("CharacterSelect", () => {
  beforeEach(() => {
    setLocale("en");
    vi.stubGlobal("fetch", vi.fn());
  });

  it("disables the new-character card at the cap", () => {
    useUiStore.setState({ screen: "characters", characters: three });
    render(<CharacterSelect onPlay={() => undefined} />);
    expect(screen.getByRole("button", { name: "New character" })).toBeDisabled();
  });

  it("requires two clicks to delete", async () => {
    const mock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", mock);
    useUiStore.setState({ screen: "characters", characters: [three[0] as CharacterSummary] });
    render(<CharacterSelect onPlay={() => undefined} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(mock).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Delete forever?" }));
    expect(mock).toHaveBeenCalledWith(
      "/api/characters/1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("calls onPlay with the chosen character", async () => {
    const onPlay = vi.fn();
    useUiStore.setState({ screen: "characters", characters: three });
    render(<CharacterSelect onPlay={onPlay} />);
    await userEvent.click(screen.getAllByRole("button", { name: "Play" })[0] as HTMLElement);
    expect(onPlay).toHaveBeenCalledWith(three[0]);
  });
});
