import { t, useLocale } from "@lindocara/client/i18n.js";
import type {
  AdventureRegistry,
  AuthoredQuestDefinition,
  QuestPrerequisiteCondition,
} from "@lindocara/engine/adventure-state.js";
import { Button } from "@lindocara/ui/components/button.js";
import { Label } from "@lindocara/ui/components/label.js";
import { Trash2 } from "lucide-react";
import { QuestChoiceField } from "./QuestChoiceField.js";
import { QuestNumberInput } from "./QuestNumberInput.js";
import { useStableObjectKeys } from "./use-stable-object-keys.js";

interface QuestPrerequisitesEditorProps {
  quest: AuthoredQuestDefinition;
  quests: readonly AuthoredQuestDefinition[];
  registry: AdventureRegistry;
  onChange(quest: AuthoredQuestDefinition): void;
}

function namedEntry(kind: "switch" | "variable", name: string, index: number): string {
  if (name.trim()) return name;
  return t(
    kind === "switch"
      ? "editor.quest.prerequisite.unnamedSwitch"
      : "editor.quest.prerequisite.unnamedVariable",
    { number: index + 1 },
  );
}

export function QuestPrerequisitesEditor({
  quest,
  quests,
  registry,
  onChange,
}: QuestPrerequisitesEditorProps) {
  useLocale();
  const candidates = quests.filter((candidate) => candidate.id !== quest.id);
  const prerequisites = quest.prerequisites;
  const conditionRows = useStableObjectKeys(prerequisites.conditions, "prerequisite");

  const update = (next: Partial<typeof prerequisites>): void =>
    onChange({ ...quest, prerequisites: { ...prerequisites, ...next } });

  const replaceCondition = (index: number, condition: QuestPrerequisiteCondition): void =>
    update({
      conditions: prerequisites.conditions.map((current, currentIndex) =>
        currentIndex === index ? condition : current,
      ),
    });

  return (
    <div className="flex flex-col gap-5">
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`quest-min-level-${quest.id}`}>
            {t("editor.quest.prerequisite.minLevel")}
          </Label>
          <QuestNumberInput
            id={`quest-min-level-${quest.id}`}
            min={1}
            max={100}
            placeholder={t("editor.quest.optional")}
            value={prerequisites.minLevel}
            allowEmpty
            onValueChange={(minLevel) => update({ minLevel })}
          />
        </div>
        <QuestChoiceField
          label={t("editor.quest.prerequisite.previousQuest")}
          value={prerequisites.previousQuestId ?? "none"}
          options={[
            { value: "none", label: t("editor.quest.none") },
            ...candidates.map((candidate) => ({
              value: candidate.id,
              label: candidate.title || t("editor.quest.untitled"),
            })),
          ]}
          onChange={(previousQuestId) =>
            update({ previousQuestId: previousQuestId === "none" ? null : previousQuestId })
          }
        />
        <QuestChoiceField
          label={t("editor.quest.prerequisite.combine")}
          value={prerequisites.mode}
          options={[
            { value: "all", label: t("editor.quest.prerequisite.all") },
            { value: "any", label: t("editor.quest.prerequisite.any") },
          ]}
          onChange={(mode) => update({ mode: mode as typeof prerequisites.mode })}
        />
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">{t("editor.quest.prerequisite.conditions")}</h3>
            <p className="text-xs text-muted-foreground">
              {t("editor.quest.prerequisite.conditionsHint")}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={registry.switches.length === 0 || prerequisites.conditions.length >= 8}
              onClick={() => {
                const entry = registry.switches[0];
                if (entry)
                  update({
                    conditions: [
                      ...prerequisites.conditions,
                      { type: "switch", switchId: entry.id, value: true },
                    ],
                  });
              }}
            >
              {t("editor.quest.prerequisite.addSwitch")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={registry.variables.length === 0 || prerequisites.conditions.length >= 8}
              onClick={() => {
                const entry = registry.variables[0];
                if (entry)
                  update({
                    conditions: [
                      ...prerequisites.conditions,
                      { type: "variable", variableId: entry.id, min: 1 },
                    ],
                  });
              }}
            >
              {t("editor.quest.prerequisite.addVariable")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={candidates.length === 0 || prerequisites.conditions.length >= 8}
              onClick={() => {
                const candidate = candidates[0];
                if (candidate)
                  update({
                    conditions: [
                      ...prerequisites.conditions,
                      { type: "quest", questId: candidate.id },
                    ],
                  });
              }}
            >
              {t("editor.quest.prerequisite.addQuest")}
            </Button>
          </div>
        </div>

        {prerequisites.conditions.length === 0 ? (
          <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
            {t("editor.quest.prerequisite.empty")}
          </p>
        ) : (
          conditionRows.map(({ item: condition, key }, index) => (
            <div
              key={key}
              className="grid grid-cols-[1fr_auto] items-end gap-2 rounded-lg border border-border p-3"
            >
              {condition.type === "switch" && (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <QuestChoiceField
                    label={t("editor.quest.prerequisite.switch")}
                    value={condition.switchId}
                    options={registry.switches.map((entry, entryIndex) => ({
                      value: entry.id,
                      label: namedEntry("switch", entry.name, entryIndex),
                    }))}
                    onChange={(switchId) => replaceCondition(index, { ...condition, switchId })}
                  />
                  <QuestChoiceField
                    label={t("editor.quest.prerequisite.expected")}
                    value={condition.value ? "on" : "off"}
                    options={[
                      { value: "on", label: t("editor.quest.prerequisite.on") },
                      { value: "off", label: t("editor.quest.prerequisite.off") },
                    ]}
                    onChange={(value) =>
                      replaceCondition(index, { ...condition, value: value === "on" })
                    }
                  />
                </div>
              )}
              {condition.type === "variable" && (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <QuestChoiceField
                    label={t("editor.quest.prerequisite.variable")}
                    value={condition.variableId}
                    options={registry.variables.map((entry, entryIndex) => ({
                      value: entry.id,
                      label: namedEntry("variable", entry.name, entryIndex),
                    }))}
                    onChange={(variableId) => replaceCondition(index, { ...condition, variableId })}
                  />
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`quest-prerequisite-min-${quest.id}-${index}`}>
                      {t("editor.quest.prerequisite.minimum")}
                    </Label>
                    <QuestNumberInput
                      id={`quest-prerequisite-min-${quest.id}-${index}`}
                      value={condition.min}
                      onValueChange={(min) =>
                        replaceCondition(index, { ...condition, min: min ?? 0 })
                      }
                    />
                  </div>
                </div>
              )}
              {condition.type === "quest" && (
                <QuestChoiceField
                  label={t("editor.quest.prerequisite.completedQuest")}
                  value={condition.questId}
                  options={candidates.map((candidate) => ({
                    value: candidate.id,
                    label: candidate.title || t("editor.quest.untitled"),
                  }))}
                  onChange={(questId) => replaceCondition(index, { ...condition, questId })}
                />
              )}
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                className="text-destructive"
                aria-label={t("editor.quest.prerequisite.delete")}
                onClick={() =>
                  update({
                    conditions: prerequisites.conditions.filter(
                      (_, currentIndex) => currentIndex !== index,
                    ),
                  })
                }
              >
                <Trash2 />
              </Button>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
