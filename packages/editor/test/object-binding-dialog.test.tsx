import { setLocale, t } from "@lindocara/client/i18n.js";
import type { ElementEventBinding } from "@lindocara/editor/game/editor-state.js";
import { ObjectBindingDialog } from "@lindocara/editor/ui/editor/ObjectBindingDialog.js";
import {
  type AuthoredQuestDefinition,
  createAuthoredQuestDefinition,
} from "@lindocara/engine/adventure-state.js";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ASSET = "decoration.terrain-decorations-bushes.bushe1" as const;
const QUESTS: AuthoredQuestDefinition[] = [
  {
    ...createAuthoredQuestDefinition("0001", "Goblin hunt"),
    description: "Protect the village",
    objectives: [
      {
        id: "0001",
        type: "interact",
        label: "Talk to Mira",
        target: 1,
        optional: false,
        hidden: false,
        stage: 0,
        interaction: "talk",
        targetRef: {
          mapId: "11111111-1111-4111-8111-111111111111",
          eventId: "22222222-2222-4222-8222-222222222222",
        },
      },
    ],
  },
];

describe("ObjectBindingDialog", () => {
  beforeEach(() => setLocale("en"));

  it("builds a quest-objective binding from a double-click preset", async () => {
    const user = userEvent.setup();
    const onBind = vi.fn<(binding: ElementEventBinding) => void>();
    render(
      <ObjectBindingDialog
        assetId={ASSET}
        quests={QUESTS}
        onBind={onBind}
        onCancel={() => {}}
        onOpenQuestDatabase={() => {}}
      />,
    );
    await user.click(screen.getByText(t("editor.binding.kind.quest-objective")));
    await user.click(screen.getByRole("button", { name: t("editor.binding.continue") }));
    expect(onBind).toHaveBeenCalledWith({
      name: "",
      commands: [],
      once: false,
      questBinding: {
        kind: "objective",
        questId: "0001",
        objectiveId: "0001",
        interaction: "interact",
      },
    });
  });

  it("marks a loot preset as one-shot", async () => {
    const user = userEvent.setup();
    const onBind = vi.fn<(binding: ElementEventBinding) => void>();
    render(
      <ObjectBindingDialog
        assetId={ASSET}
        quests={[]}
        onBind={onBind}
        onCancel={() => {}}
        onOpenQuestDatabase={() => {}}
      />,
    );
    await user.click(screen.getByText(t("editor.binding.kind.loot")));
    await user.click(screen.getByRole("button", { name: t("editor.binding.continue") }));
    expect(onBind.mock.calls[0]?.[0].once).toBe(true);
  });
});
