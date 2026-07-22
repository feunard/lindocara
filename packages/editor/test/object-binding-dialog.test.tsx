import { setLocale, t } from "@lindocara/client/i18n.js";
import type { ElementEventBinding } from "@lindocara/editor/game/editor-state.js";
import { ObjectBindingDialog } from "@lindocara/editor/ui/editor/ObjectBindingDialog.js";
import { QuestRegistryEditor } from "@lindocara/editor/ui/editor/QuestRegistryEditor.js";
import {
  type AuthoredQuestDefinition,
  createAuthoredQuestDefinition,
  createManualQuestObjective,
} from "@lindocara/engine/adventure-state.js";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ASSET = "decoration.terrain-decorations-bushes.bushe1" as const;
const QUESTS: AuthoredQuestDefinition[] = [
  {
    ...createAuthoredQuestDefinition("0001", "Goblin hunt"),
    description: "Protect the village",
    objectives: [createManualQuestObjective("0001", "Defeat goblins", 3)],
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
    await user.click(screen.getByText(t("editor.binding.kind.quest-progress")));
    await user.click(screen.getByRole("button", { name: t("editor.binding.continue") }));
    expect(onBind).toHaveBeenCalledWith({
      name: "",
      commands: [{ t: "advanceQuest", questId: "0001", objectiveId: "0001", amount: 1 }],
      once: false,
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

describe("QuestRegistryEditor", () => {
  it("creates a quest and a stable objective from the database surface", async () => {
    setLocale("en");
    const latest = { current: [] as readonly AuthoredQuestDefinition[] };
    function Harness() {
      const [quests, setQuests] = useState<readonly AuthoredQuestDefinition[]>([]);
      latest.current = quests;
      return <QuestRegistryEditor quests={quests} onChange={setQuests} />;
    }
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: t("editor.quest.add") }));
    await user.click(screen.getByRole("button", { name: t("editor.quest.addObjective") }));
    expect(latest.current[0]).toMatchObject({
      id: "0001",
      objectives: [{ id: "0001", target: 1 }],
    });
  });
});
