import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CharacterSummary } from "../../src/client/api.js";
import { setLocale } from "../../src/client/i18n.js";
import { useUiStore } from "../../src/client/store.js";
import { CharacterSelect } from "../../src/client/ui/CharacterSelect.js";
import { starterEquipmentFor } from "../../src/shared/character.js";

const three: CharacterSummary[] = [
  {
    id: "1",
    name: "One",
    appearance: {
      body: "wayfarer",
      primaryColor: "azure",
    },
    equipment: starterEquipmentFor("warrior"),
    level: 1,
    class: "warrior",
  },
  {
    id: "2",
    name: "Two",
    appearance: {
      body: "wayfarer",
      primaryColor: "ember",
    },
    equipment: starterEquipmentFor("ranger"),
    level: 2,
    class: "ranger",
  },
  {
    id: "3",
    name: "Three",
    appearance: {
      body: "wayfarer",
      primaryColor: "moss",
    },
    equipment: starterEquipmentFor("priest"),
    level: 3,
    class: "priest",
  },
];

describe("CharacterSelect", () => {
  beforeEach(() => {
    setLocale("en");
    vi.stubGlobal("fetch", vi.fn());
    useUiStore.setState({ screen: "characters", characters: null });
  });

  it("renders existing character identity, previews, equipment, and the primary play action", () => {
    useUiStore.setState({ characters: three });
    render(<CharacterSelect onPlay={() => undefined} />);

    expect(screen.getByText("One")).toBeInTheDocument();
    expect(screen.getByText("Hunter's bow")).toBeInTheDocument();
    expect(screen.getByText("Heartwood staff")).toBeInTheDocument();
    expect(screen.getAllByRole("img", { name: /wayfarer/i })).toHaveLength(3);
    expect(screen.getAllByRole("button", { name: "Play" })).toHaveLength(3);
    expect(screen.queryByRole("button", { name: /^New character/ })).not.toBeInTheDocument();
  });

  it("protects deletion with a localized alert dialog", async () => {
    const mock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", mock);
    useUiStore.setState({ characters: [three[0] as CharacterSummary] });
    render(<CharacterSelect onPlay={() => undefined} />);

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(mock).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toHaveTextContent("Delete One?");
    await userEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
    expect(mock).toHaveBeenCalledWith(
      "/api/characters/1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("calls onPlay with the chosen character", async () => {
    const onPlay = vi.fn();
    useUiStore.setState({ characters: three });
    render(<CharacterSelect onPlay={onPlay} />);
    await userEvent.click(screen.getAllByRole("button", { name: "Play" })[1] as HTMLElement);
    expect(onPlay).toHaveBeenCalledWith(three[1]);
  });

  it("changes class and appearance with immediate visual feedback", async () => {
    useUiStore.setState({ characters: [] });
    render(<CharacterSelect onPlay={() => undefined} />);

    await userEvent.click(screen.getByRole("radio", { name: /Priest/i }));
    expect(screen.getAllByText("Heartwood staff").length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole("radio", { name: "Violet" }));
    expect(
      screen.getByRole("img", { name: /Priest wayfarer in the Violet palette/i }),
    ).toBeVisible();
  });

  it("generates only valid class and appearance choices", async () => {
    vi.spyOn(Math, "random").mockReturnValueOnce(0.5).mockReturnValueOnce(0.99);
    useUiStore.setState({ characters: [] });
    render(<CharacterSelect onPlay={() => undefined} />);

    await userEvent.click(screen.getByRole("button", { name: "Randomize" }));
    expect(screen.getByRole("radio", { name: /Ranger/i })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Violet" })).toBeChecked();
  });

  it("shows a confirmation summary before posting the server-owned loadout", async () => {
    const created: CharacterSummary = {
      id: "9",
      name: "Mercy",
      appearance: {
        body: "wayfarer",
        primaryColor: "violet",
      },
      equipment: starterEquipmentFor("priest"),
      class: "priest",
      level: 1,
    };
    const mock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(created), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", mock);
    useUiStore.setState({ characters: [] });
    render(<CharacterSelect onPlay={() => undefined} />);

    await userEvent.type(screen.getByLabelText("Name"), "Mercy");
    await userEvent.click(screen.getByRole("radio", { name: /Priest/i }));
    await userEvent.click(screen.getByRole("radio", { name: "Violet" }));
    await userEvent.click(screen.getByRole("button", { name: "Review wayfarer" }));
    expect(screen.getByRole("heading", { name: "Confirm your wayfarer" })).toBeInTheDocument();
    expect(screen.queryByText("Oak shield")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Create wayfarer" }));
    const createCall = mock.mock.calls.find(
      ([url, init]) => url === "/api/characters" && init?.method === "POST",
    );
    expect(JSON.parse(String(createCall?.[1]?.body))).toEqual({
      name: "Mercy",
      appearance: { body: "wayfarer", primaryColor: "violet" },
      class: "priest",
    });
    expect(useUiStore.getState().characters).toContainEqual(created);
  });

  it("renders the creator in both English and French", () => {
    useUiStore.setState({ characters: [] });
    const view = render(<CharacterSelect onPlay={() => undefined} />);
    expect(screen.getByText("Character forge")).toBeInTheDocument();
    view.unmount();

    setLocale("fr");
    render(<CharacterSelect onPlay={() => undefined} />);
    expect(screen.getByText("Forge de personnage")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Aléatoire" })).toBeInTheDocument();
  });
});
