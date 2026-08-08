import { t } from "@lindocara/client/i18n.js";
import { MapHeroSettingsDialog } from "@lindocara/editor/ui/editor/MapHeroSettingsDialog.js";
import {
  defaultMapHeroSettings,
  type MapHeroSettings,
} from "@lindocara/engine/map-hero-settings.js";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, test, vi } from "vitest";

function Harness({ onSave }: { onSave: Parameters<typeof MapHeroSettingsDialog>[0]["onSave"] }) {
  const [open, setOpen] = useState(true);
  return (
    <MapHeroSettingsDialog
      open={open}
      mapName="Labyrinthe"
      initial={defaultMapHeroSettings()}
      onOpenChange={setOpen}
      onSave={onSave}
    />
  );
}

describe("MapHeroSettingsDialog", () => {
  test("keeps all five classes on one row and exposes the Peasant rules", async () => {
    render(<Harness onSave={async () => true} />);

    expect(screen.getByRole("tablist")).toHaveClass("grid-cols-5");
    await userEvent.click(screen.getByRole("tab", { name: t("class.peasant") }));

    expect(screen.getByLabelText(t("editor.heroSettings.movementSpeed"))).toHaveValue(247 / 64);
    expect(
      screen.getByRole("checkbox", {
        name: `4. ${t("skill.peasant.makeshift_camp.name")}`,
      }),
    ).toBeChecked();
  });

  test("edits a class speed and disables an ability before saving", async () => {
    const onSave = vi.fn(async (_settings: MapHeroSettings) => true);
    render(<Harness onSave={onSave} />);
    await userEvent.click(screen.getByRole("tab", { name: t("class.rogue") }));

    const speed = screen.getByLabelText(t("editor.heroSettings.movementSpeed"));
    await userEvent.clear(speed);
    await userEvent.type(speed, "350");
    await userEvent.click(
      screen.getByRole("checkbox", { name: `3. ${t("skill.rogue.vanish.name")}` }),
    );
    await userEvent.click(screen.getByRole("button", { name: t("editor.save") }));

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    const saved = onSave.mock.calls[0]?.[0];
    expect(saved?.classes.rogue.stats.movementSpeed).toBe(350);
    expect(saved?.classes.rogue.disabledSkills).toEqual([3]);
  });

  test("refuses values outside the shared limits", async () => {
    render(<Harness onSave={async () => true} />);
    const speed = screen.getByLabelText(t("editor.heroSettings.movementSpeed"));
    await userEvent.clear(speed);
    await userEvent.type(speed, "9999");
    expect(speed).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: t("editor.save") })).toBeDisabled();
  });
});
