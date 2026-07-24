import { setLocale, t } from "@lindocara/client/i18n.js";
import {
  EditorHelpDialog,
  type EditorHelpSection,
} from "@lindocara/editor/ui/editor/EditorHelpDialog.js";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it } from "vitest";

function HelpHarness() {
  const [section, setSection] = useState<EditorHelpSection>("start");
  return (
    <EditorHelpDialog open section={section} onOpenChange={() => {}} onSectionChange={setSection} />
  );
}

describe("EditorHelpDialog", () => {
  beforeEach(() => setLocale("fr"));

  it("offers task-separated, code-free guidance for the complete creator workflow", async () => {
    const user = userEvent.setup();
    render(<HelpHarness />);

    expect(screen.getByText(t("editor.help.noCode"))).toBeVisible();
    expect(screen.getByText(t("editor.help.start.step8.title"))).toBeVisible();
    for (const tab of ["start", "maps", "story", "quests", "state", "test"] as const) {
      expect(screen.getByRole("tab", { name: t(`editor.help.tab.${tab}`) })).toBeVisible();
    }

    await user.click(screen.getByRole("tab", { name: t("editor.help.tab.maps") }));
    expect(screen.getByText(t("editor.help.maps.relief.title"))).toBeVisible();
    expect(screen.getByText(t("editor.help.maps.relief.rule"))).toBeVisible();

    await user.click(screen.getByRole("tab", { name: t("editor.help.tab.quests") }));
    expect(screen.getByText(t("editor.help.quests.links.title"))).toBeVisible();
    expect(screen.getByText(t("editor.help.quests.objective.defeatTarget"))).toBeVisible();

    await user.click(screen.getByRole("tab", { name: t("editor.help.tab.state") }));
    expect(screen.getByText(t("editor.help.state.boolean.title"))).toBeVisible();
    expect(screen.getByText(t("editor.help.state.example.title"))).toBeVisible();
  });
});
