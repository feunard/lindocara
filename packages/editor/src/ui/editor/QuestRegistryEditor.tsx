import { t, useLocale } from "@lindocara/client/i18n.js";
import {
  type AuthoredQuestDefinition,
  MAX_AUTHORED_QUESTS,
  MAX_QUEST_OBJECTIVES,
  mintRegistryId,
  QUEST_DESCRIPTION_MAX,
  QUEST_OBJECTIVE_LABEL_MAX,
  QUEST_OBJECTIVE_TARGET_MAX,
  QUEST_TITLE_MAX,
} from "@lindocara/engine/adventure-state.js";
import { Button } from "@lindocara/ui/components/button.js";
import { Input } from "@lindocara/ui/components/input.js";

interface QuestRegistryEditorProps {
  quests: readonly AuthoredQuestDefinition[];
  onChange(quests: readonly AuthoredQuestDefinition[]): void;
}

/** Dense quest database: definitions live beside switches/variables, while party progress stays in
 * the runtime save. Stable ids let event commands keep their bindings when labels are renamed. */
export function QuestRegistryEditor({ quests, onChange }: QuestRegistryEditorProps) {
  useLocale();

  const replace = (id: string, next: AuthoredQuestDefinition): void => {
    onChange(quests.map((quest) => (quest.id === id ? next : quest)));
  };

  const addQuest = (): void => {
    if (quests.length >= MAX_AUTHORED_QUESTS) return;
    const id = mintRegistryId(quests);
    if (!id) return;
    onChange([
      ...quests,
      { id, title: t("editor.quest.newTitle"), description: "", objectives: [] },
    ]);
  };

  return (
    <section className="flex flex-col gap-2" aria-label={t("editor.quest.heading")}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{t("editor.quest.heading")}</h3>
          <p className="text-xs text-muted-foreground">{t("editor.quest.registryHint")}</p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          disabled={quests.length >= MAX_AUTHORED_QUESTS}
          onClick={addQuest}
        >
          {t("editor.quest.add")}
        </Button>
      </div>

      {quests.length === 0 ? (
        <p className="rounded-md border border-dashed border-zinc-300 p-3 text-sm text-muted-foreground">
          {t("editor.quest.empty")}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {quests.map((quest) => (
            <article
              key={quest.id}
              className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-3"
            >
              <div className="flex items-center gap-2">
                <code className="rounded bg-zinc-100 px-1.5 py-1 text-xs">Q{quest.id}</code>
                <Input
                  aria-label={t("editor.quest.title")}
                  className="h-8 flex-1"
                  maxLength={QUEST_TITLE_MAX}
                  value={quest.title}
                  onChange={(event) =>
                    replace(quest.id, { ...quest, title: event.currentTarget.value })
                  }
                />
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive"
                  onClick={() => onChange(quests.filter((item) => item.id !== quest.id))}
                >
                  {t("editor.registry.delete")}
                </Button>
              </div>
              <textarea
                aria-label={t("editor.quest.description")}
                className="min-h-16 resize-y rounded-md border border-input bg-transparent px-2 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                maxLength={QUEST_DESCRIPTION_MAX}
                placeholder={t("editor.quest.descriptionHint")}
                value={quest.description}
                onChange={(event) =>
                  replace(quest.id, { ...quest, description: event.currentTarget.value })
                }
              />
              <div className="flex items-center justify-between">
                <strong className="text-xs text-zinc-600">{t("editor.quest.objectives")}</strong>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7"
                  disabled={quest.objectives.length >= MAX_QUEST_OBJECTIVES}
                  onClick={() => {
                    const id = mintRegistryId(quest.objectives);
                    if (!id) return;
                    replace(quest.id, {
                      ...quest,
                      objectives: [
                        ...quest.objectives,
                        { id, label: t("editor.quest.newObjective"), target: 1 },
                      ],
                    });
                  }}
                >
                  {t("editor.quest.addObjective")}
                </Button>
              </div>
              {quest.objectives.map((objective) => (
                <div
                  key={objective.id}
                  className="grid grid-cols-[auto_1fr_5rem_auto] items-center gap-2"
                >
                  <code className="text-[11px] text-zinc-400">{objective.id}</code>
                  <Input
                    aria-label={t("editor.quest.objectiveLabel")}
                    className="h-7 text-xs"
                    maxLength={QUEST_OBJECTIVE_LABEL_MAX}
                    value={objective.label}
                    onChange={(event) =>
                      replace(quest.id, {
                        ...quest,
                        objectives: quest.objectives.map((item) =>
                          item.id === objective.id
                            ? { ...item, label: event.currentTarget.value }
                            : item,
                        ),
                      })
                    }
                  />
                  <Input
                    aria-label={t("editor.quest.target")}
                    className="h-7 text-xs"
                    type="number"
                    min={1}
                    max={QUEST_OBJECTIVE_TARGET_MAX}
                    value={objective.target}
                    onChange={(event) =>
                      replace(quest.id, {
                        ...quest,
                        objectives: quest.objectives.map((item) =>
                          item.id === objective.id
                            ? {
                                ...item,
                                target: Math.max(
                                  1,
                                  Math.min(
                                    QUEST_OBJECTIVE_TARGET_MAX,
                                    Math.trunc(Number(event.currentTarget.value) || 1),
                                  ),
                                ),
                              }
                            : item,
                        ),
                      })
                    }
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-destructive"
                    aria-label={t("editor.quest.deleteObjective")}
                    onClick={() =>
                      replace(quest.id, {
                        ...quest,
                        objectives: quest.objectives.filter((item) => item.id !== objective.id),
                      })
                    }
                  >
                    ×
                  </Button>
                </div>
              ))}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
