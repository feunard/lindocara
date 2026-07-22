import { type AdventureDraft, emptyDraft } from "@lindocara/client/adventure-draft.js";
import { setLocale, t } from "@lindocara/client/i18n.js";
import { useUiStore } from "@lindocara/client/store.js";
import { QuestWorkspaceDialog } from "@lindocara/editor/ui/editor/QuestWorkspaceDialog.js";
import {
  createStructuredQuestObjective,
  type QuestMapCatalog,
} from "@lindocara/editor/ui/editor/quest-editor-model.js";
import {
  type AuthoredQuestDefinition,
  createAuthoredQuestDefinition,
} from "@lindocara/engine/adventure-state.js";
import { defaultEventPage, type MapEvent } from "@lindocara/engine/map-events.js";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const MAP_ID = "11111111-1111-4111-8111-111111111111";
const EVENT_ID = "22222222-2222-4222-8222-222222222222";

function npc(): MapEvent {
  return {
    id: EVENT_ID,
    col: 4,
    row: 6,
    name: "Warden Mira",
    ordinal: 1,
    kind: "normal",
    species: null,
    patrolRadius: null,
    pages: [defaultEventPage()],
  };
}

const CURRENT_MAP: QuestMapCatalog = {
  mapId: MAP_ID,
  name: "Verdant Reach",
  cols: 40,
  rows: 30,
  events: [npc()],
};

function seed(quests: readonly AuthoredQuestDefinition[] = []): void {
  const draft = {
    ...emptyDraft(),
    title: "The Green Road",
    registry: { switches: [], variables: [], ...(quests.length > 0 ? { quests } : {}) },
  };
  useUiStore.setState({
    adventureEditorSession: {
      adventureId: "adv-1",
      draftId: "draft-1",
      draft,
      invalidatedLinks: [],
      savedDraft: JSON.stringify(draft),
    },
  });
}

function mapListBackend() {
  return vi.fn((url: string) => {
    if (url.startsWith("/api/maps?adventure=")) {
      return Promise.resolve(
        new Response(
          JSON.stringify([
            {
              id: MAP_ID,
              name: CURRENT_MAP.name,
              revision: 1,
              cols: CURRENT_MAP.cols,
              rows: CURRENT_MAP.rows,
              isFirst: true,
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify({ error: "not_found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
}

describe("QuestWorkspaceDialog", () => {
  beforeEach(() => {
    setLocale("en");
    seed();
    vi.stubGlobal("fetch", mapListBackend());
  });

  it("creates and saves a structured ten-monster objective through the primary quest surface", async () => {
    const user = userEvent.setup();
    const onSaveDraft = vi.fn(async (draft: AdventureDraft) => draft);
    render(
      <QuestWorkspaceDialog
        open
        onOpenChange={() => {}}
        onSessionExpired={() => {}}
        currentMap={CURRENT_MAP}
        onSaveDraft={onSaveDraft}
      />,
    );

    await screen.findByText(t("editor.quest.workspace.emptySelection"));
    const createButton = screen.getAllByRole("button", { name: t("editor.quest.add") })[0];
    if (!createButton) throw new Error("create quest button missing");
    await user.click(createButton);

    const title = await screen.findByLabelText(t("editor.quest.title"));
    expect(screen.getByRole("combobox", { name: t("editor.quest.scope") })).toHaveTextContent(
      t("editor.quest.scope.party"),
    );
    fireEvent.change(title, { target: { value: "Ten spear goblins" } });
    await user.click(screen.getByRole("tab", { name: t("editor.quest.tab.objectives") }));
    await user.click(screen.getByRole("button", { name: t("editor.quest.addObjective") }));
    expect(
      screen.getByRole("combobox", { name: t("editor.quest.objective.type") }),
    ).toHaveTextContent(t("editor.quest.objective.type.kill"));
    const target = screen.getByLabelText(t("editor.quest.target"));
    fireEvent.change(target, { target: { value: "10" } });

    await user.click(screen.getByRole("button", { name: t("editor.quest.save") }));
    await waitFor(() => expect(onSaveDraft).toHaveBeenCalledTimes(1));
    const saved = onSaveDraft.mock.calls[0]?.[0];
    expect(saved?.registry.quests).toMatchObject([
      {
        id: "0001",
        title: "Ten spear goblins",
        version: 1,
        objectives: [
          {
            id: "0001",
            type: "kill",
            species: "spear_goblin",
            target: 10,
            credit: "contributors",
            mapScope: { kind: "any" },
          },
        ],
      },
    ]);
  });

  it("duplicates, searches and deletes by friendly title while reporting broken references", async () => {
    const kill = createStructuredQuestObjective("0001", "kill", [CURRENT_MAP]);
    if (!kill) throw new Error("kill default missing");
    const quest = {
      ...createAuthoredQuestDefinition("0001", "Village defense"),
      giver: { mapId: MAP_ID, eventId: "33333333-3333-4333-8333-333333333333" },
      turnInTarget: { mapId: MAP_ID, eventId: "33333333-3333-4333-8333-333333333333" },
      objectives: [kill],
    };
    seed([quest]);
    const user = userEvent.setup();
    render(
      <QuestWorkspaceDialog
        open
        onOpenChange={() => {}}
        onSessionExpired={() => {}}
        currentMap={CURRENT_MAP}
      />,
    );

    await screen.findByDisplayValue("Village defense");
    await user.click(screen.getByRole("button", { name: t("editor.quest.duplicate") }));
    expect(await screen.findByDisplayValue("Village defense (copy)")).toBeVisible();

    const search = screen.getByRole("searchbox", { name: t("editor.quest.search") });
    await user.type(search, "copy");
    expect(screen.getByText("Village defense (copy)")).toBeVisible();
    expect(screen.queryByText("Village defense")).toBeNull();

    await user.clear(search);
    await user.click(screen.getByRole("tab", { name: /Validation/ }));
    expect(screen.getByText(t("editor.quest.validation.giverMissing"))).toBeVisible();
    expect(screen.getByText(t("editor.quest.validation.turnInMissing"))).toBeVisible();

    await user.click(screen.getByRole("button", { name: t("editor.quest.delete") }));
    const confirmText = screen.getByText(t("editor.quest.deleteConfirm.body"));
    const confirm = confirmText.closest('[data-slot="dialog-content"]');
    if (!(confirm instanceof HTMLElement)) throw new Error("delete confirm missing");
    await user.click(within(confirm).getByRole("button", { name: t("editor.quest.delete") }));
    expect(screen.queryByDisplayValue("Village defense (copy)")).toBeNull();
  });
});
