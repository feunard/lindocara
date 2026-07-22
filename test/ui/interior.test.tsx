import { setLocale } from "@lindocara/client/i18n.js";
import { useUiStore } from "@lindocara/client/store.js";
import { InteriorOverlay } from "@lindocara/client/ui/InteriorOverlay.js";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

describe("InteriorOverlay", () => {
  beforeEach(() => setLocale("en"));

  it("renders the open door localized and closes via the button", async () => {
    useUiStore.setState({ interiorDoorId: "crossing-hall" });
    render(<InteriorOverlay />);
    expect(screen.getByText("Crossing Hall")).toBeInTheDocument();
    setLocale("fr");
    expect(screen.getByText("Le Hall de la Croisée")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /fermer/i }));
    expect(useUiStore.getState().interiorDoorId).toBeNull();
  });

  it("renders nothing when closed", () => {
    useUiStore.setState({ interiorDoorId: null });
    const { container } = render(<InteriorOverlay />);
    expect(container).toBeEmptyDOMElement();
  });
});
