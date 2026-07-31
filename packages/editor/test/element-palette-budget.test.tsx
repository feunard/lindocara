import { setLocale } from "@lindocara/client/i18n.js";
import { ElementPalette } from "@lindocara/editor/ui/editor/ElementPalette.js";
import { MAX_MAP_ELEMENTS } from "@lindocara/engine/map-data.js";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

describe("ElementPalette safety budget", () => {
  it("shows the raised scenery budget and explains when it is reached", () => {
    setLocale("en");
    render(
      <ElementPalette
        selectedAsset={null}
        elementCount={MAX_MAP_ELEMENTS}
        onSelectAsset={() => {}}
      />,
    );

    const formattedLimit = MAX_MAP_ELEMENTS.toLocaleString("en");
    expect(screen.getByTestId("element-budget")).toHaveTextContent(
      `${formattedLimit}/${formattedLimit}`,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      `${MAX_MAP_ELEMENTS}-scenery safety limit`,
    );
  });
});
