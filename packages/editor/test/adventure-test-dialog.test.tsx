import { setLocale, t } from "@lindocara/client/i18n.js";
import { AdventureTestDialog } from "@lindocara/editor/ui/editor/AdventureTestDialog.js";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

describe("AdventureTestDialog", () => {
  beforeEach(() => setLocale("en"));

  test("offers every shared hero class and launches a Peasant preview", async () => {
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
    await userEvent.click(screen.getByRole("option", { name: t("class.peasant") }));
    await userEvent.click(screen.getByRole("button", { name: t("editor.test.launch") }));

    expect(onLaunch).toHaveBeenCalledWith({ startMapId: null, heroClass: "peasant" });
  });
});
