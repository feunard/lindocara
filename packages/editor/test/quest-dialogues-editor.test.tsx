import { setLocale, t } from "@lindocara/client/i18n.js";
import { defaultEventPage } from "@lindocara/editor/game/editor-state.js";
import { QuestDialoguesEditor } from "@lindocara/editor/ui/editor/QuestDialoguesEditor.js";
import type { QuestMapCatalog } from "@lindocara/editor/ui/editor/quest-editor-model.js";
import { createAuthoredQuestDefinition } from "@lindocara/engine/quests.js";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const maps: readonly QuestMapCatalog[] = [
  {
    mapId: "village",
    name: "Village",
    cols: 20,
    rows: 20,
    events: [
      {
        id: "mira",
        col: 4,
        row: 5,
        name: "Mira",
        ordinal: 1,
        kind: "normal",
        species: null,
        patrolRadius: null,
        pages: [defaultEventPage()],
      },
      {
        id: "captain",
        col: 7,
        row: 5,
        name: "Captain Rowan",
        ordinal: 2,
        kind: "normal",
        species: null,
        patrolRadius: null,
        pages: [defaultEventPage()],
      },
    ],
  },
];

describe("QuestDialoguesEditor", () => {
  beforeEach(() => setLocale("en"));

  it("groups every line under the character who will speak it", () => {
    const onChange = vi.fn();
    const quest = {
      ...createAuthoredQuestDefinition("0001", "The old road"),
      giver: { mapId: "village", eventId: "mira" },
      turnInTarget: { mapId: "village", eventId: "captain" },
    };

    render(<QuestDialoguesEditor quest={quest} maps={maps} onChange={onChange} />);

    expect(
      screen.getByRole("heading", {
        name: t("editor.quest.dialogue.giverGroup", { speaker: "Village · Mira" }),
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", {
        name: t("editor.quest.dialogue.turnInGroup", {
          speaker: "Village · Captain Rowan",
        }),
      }),
    ).toBeVisible();

    fireEvent.change(screen.getByLabelText(t("editor.quest.dialogue.offer")), {
      target: { value: "Can you help?" },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        dialogues: expect.objectContaining({ offer: "Can you help?" }),
      }),
    );
  });
});
