import { setLocale, t } from "@lindocara/client/i18n.js";
import { AdventureTestDialog } from "@lindocara/editor/ui/editor/AdventureTestDialog.js";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

describe("AdventureTestDialog", () => {
  beforeEach(() => setLocale("en"));

  test("offers standard classes and every prototype, then launches the Assassin body", async () => {
    const onLaunch = vi.fn();
    render(
      <AdventureTestDialog
        open
        maps={[{ mapId: "farm", name: "Farm" }]}
        currentMapId="farm"
        quests={[]}
        dirty={false}
        busy={false}
        error={null}
        diagnostics={[]}
        onOpenChange={vi.fn()}
        onQuickPreview={vi.fn()}
        onLaunch={onLaunch}
      />,
    );

    await userEvent.click(screen.getByLabelText(t("editor.test.class.label")));
    for (const label of [
      "hero.bonus.runicGuardian",
      "hero.bonus.assassin",
      "hero.bonus.peasant",
      "hero.bonus.ranger",
      "hero.bonus.priest",
    ] as const) {
      expect(screen.getByRole("option", { name: t(label) })).toBeInTheDocument();
    }
    await userEvent.click(screen.getByRole("option", { name: t("hero.bonus.assassin") }));
    await userEvent.click(screen.getByRole("button", { name: t("editor.test.launch") }));

    expect(onLaunch).toHaveBeenCalledWith({
      startMapId: null,
      heroClass: "rogue",
      heroBody: "assassin",
    });
  });
});
