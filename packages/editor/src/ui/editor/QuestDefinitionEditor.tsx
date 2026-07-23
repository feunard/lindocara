import { t, useLocale } from "@lindocara/client/i18n.js";
import type { AdventureRegistry } from "@lindocara/engine/adventure-state.js";
import { mintRegistryId } from "@lindocara/engine/adventure-state.js";
import type { MessageKey } from "@lindocara/engine/i18n/index.js";
import {
  type AuthoredQuestDefinition,
  MAX_QUEST_OBJECTIVES,
  type QuestDiagnostic,
} from "@lindocara/engine/quests.js";
import { Badge } from "@lindocara/ui/components/badge.js";
import { Button } from "@lindocara/ui/components/button.js";
import { Input } from "@lindocara/ui/components/input.js";
import { Label } from "@lindocara/ui/components/label.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@lindocara/ui/components/tabs.js";
import { Textarea } from "@lindocara/ui/components/textarea.js";
import { Plus } from "lucide-react";
import { QuestChoiceField } from "./QuestChoiceField.js";
import { QuestDialoguesEditor } from "./QuestDialoguesEditor.js";
import { QuestNumberInput } from "./QuestNumberInput.js";
import { QuestObjectiveEditor } from "./QuestObjectiveEditor.js";
import { QuestPrerequisitesEditor } from "./QuestPrerequisitesEditor.js";
import { QuestRewardsEditor } from "./QuestRewardsEditor.js";
import { QuestToggleField } from "./QuestToggleField.js";
import {
  createStructuredQuestObjective,
  eventReferenceFromValue,
  eventReferenceValue,
  type QuestMapCatalog,
  questEventLabel,
  questEventOptions,
} from "./quest-editor-model.js";
import { useStableObjectKeys } from "./use-stable-object-keys.js";

interface QuestDefinitionEditorProps {
  quest: AuthoredQuestDefinition;
  quests: readonly AuthoredQuestDefinition[];
  registry: AdventureRegistry;
  maps: readonly QuestMapCatalog[];
  diagnostics: readonly QuestDiagnostic[];
  onChange(quest: AuthoredQuestDefinition): void;
}

const DIAGNOSTIC_MESSAGES: Readonly<Record<string, MessageKey>> = {
  "quest.title.empty": "editor.quest.validation.titleEmpty",
  "quest.objectives.empty": "editor.quest.validation.objectivesEmpty",
  "quest.objectives.only_optional": "editor.quest.validation.onlyOptional",
  "quest.giver.missing": "editor.quest.validation.giverMissing",
  "quest.turn_in_target.missing": "editor.quest.validation.turnInMissing",
  "quest.acceptance.unbound": "editor.quest.validation.acceptanceUnbound",
  "quest.turn_in.unbound": "editor.quest.validation.turnInUnbound",
  "quest.prerequisite.self": "editor.quest.validation.prerequisiteSelf",
  "quest.prerequisite.missing": "editor.quest.validation.prerequisiteMissing",
  "quest.prerequisite.cycle": "editor.quest.validation.prerequisiteCycle",
  "quest.next.self": "editor.quest.validation.nextSelf",
  "quest.next.missing": "editor.quest.validation.nextMissing",
  "quest.switch.missing": "editor.quest.validation.switchMissing",
  "quest.variable.missing": "editor.quest.validation.variableMissing",
  "quest.reward.switch_missing": "editor.quest.validation.rewardSwitchMissing",
  "quest.reward.variable_missing": "editor.quest.validation.rewardVariableMissing",
  "quest.reward.item_missing": "editor.quest.validation.rewardItemMissing",
  "quest.reward.choices_require_turn_in": "editor.quest.validation.rewardChoicesRequireTurnIn",
  "quest.reward.commands_require_turn_in": "editor.quest.validation.rewardCommandsRequireTurnIn",
  "quest.objectives.stage_gap": "editor.quest.validation.stageGap",
  "quest.objective.map_missing": "editor.quest.validation.objectiveMapMissing",
  "quest.objective.monster_missing": "editor.quest.validation.objectiveMonsterMissing",
  "quest.objective.target_not_monster": "editor.quest.validation.objectiveTargetNotMonster",
  "quest.objective.area_missing": "editor.quest.validation.objectiveAreaMissing",
  "quest.objective.event_missing": "editor.quest.validation.objectiveEventMissing",
  "quest.objective.item_missing": "editor.quest.validation.objectiveItemMissing",
  "quest.objective.activity_missing": "editor.quest.validation.objectiveActivityMissing",
  "quest.objective.manual": "editor.quest.validation.manualObjective",
};

export function questDiagnosticText(diagnostic: QuestDiagnostic): string {
  return t(DIAGNOSTIC_MESSAGES[diagnostic.code] ?? "editor.quest.validation.unknown");
}

export function QuestDefinitionEditor({
  quest,
  quests,
  registry,
  maps,
  diagnostics,
  onChange,
}: QuestDefinitionEditorProps) {
  useLocale();
  const eventOptions = questEventOptions(maps).map((option) => ({
    value: eventReferenceValue(option.reference),
    label: questEventLabel(option),
  }));
  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  const warnings = diagnostics.filter((diagnostic) => diagnostic.severity === "warning");
  const diagnosticRows = useStableObjectKeys(diagnostics, "quest-diagnostic");

  function addObjective(): void {
    if (quest.objectives.length >= MAX_QUEST_OBJECTIVES) return;
    const id = mintRegistryId(quest.objectives);
    if (!id) return;
    const objective = createStructuredQuestObjective(id, "kill", maps);
    if (!objective) return;
    onChange({ ...quest, objectives: [...quest.objectives, objective] });
  }

  function replaceObjective(
    index: number,
    objective: AuthoredQuestDefinition["objectives"][number],
  ) {
    onChange({
      ...quest,
      objectives: quest.objectives.map((current, currentIndex) =>
        currentIndex === index ? objective : current,
      ),
    });
  }

  function moveObjective(index: number, direction: -1 | 1): void {
    const destination = index + direction;
    if (destination < 0 || destination >= quest.objectives.length) return;
    const objectives = [...quest.objectives];
    const current = objectives[index];
    const displaced = objectives[destination];
    if (!current || !displaced) return;
    objectives[index] = displaced;
    objectives[destination] = current;
    onChange({ ...quest, objectives });
  }

  return (
    <Tabs defaultValue="general" className="min-h-0 flex-1">
      <TabsList className="sticky top-0 z-10 w-full justify-start rounded-none border-b border-border bg-background px-1 py-1">
        <TabsTrigger value="general">{t("editor.quest.tab.general")}</TabsTrigger>
        <TabsTrigger value="objectives">{t("editor.quest.tab.objectives")}</TabsTrigger>
        <TabsTrigger value="prerequisites">{t("editor.quest.tab.prerequisites")}</TabsTrigger>
        <TabsTrigger value="dialogues">{t("editor.quest.tab.dialogues")}</TabsTrigger>
        <TabsTrigger value="rewards">{t("editor.quest.tab.rewards")}</TabsTrigger>
        <TabsTrigger value="validation" className="gap-2">
          {t("editor.quest.tab.validation")}
          {errors.length > 0 && <Badge variant="destructive">{errors.length}</Badge>}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="general" className="overflow-y-auto p-5">
        <div className="flex max-w-4xl flex-col gap-5">
          <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="flex flex-col gap-1.5 lg:col-span-2">
              <Label htmlFor={`quest-title-${quest.id}`}>{t("editor.quest.title")}</Label>
              <Input
                id={`quest-title-${quest.id}`}
                maxLength={64}
                value={quest.title}
                autoFocus
                onChange={(event) => onChange({ ...quest, title: event.currentTarget.value })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`quest-description-${quest.id}`}>
                {t("editor.quest.description")}
              </Label>
              <Textarea
                id={`quest-description-${quest.id}`}
                rows={6}
                maxLength={2000}
                value={quest.description}
                placeholder={t("editor.quest.descriptionHint")}
                onChange={(event) => onChange({ ...quest, description: event.currentTarget.value })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`quest-summary-${quest.id}`}>
                {t("editor.quest.journalSummary")}
              </Label>
              <Textarea
                id={`quest-summary-${quest.id}`}
                rows={6}
                maxLength={240}
                value={quest.journalSummary}
                placeholder={t("editor.quest.journalSummaryHint")}
                onChange={(event) =>
                  onChange({ ...quest, journalSummary: event.currentTarget.value })
                }
              />
            </div>
          </section>

          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`quest-level-${quest.id}`}>
                {t("editor.quest.recommendedLevel")}
              </Label>
              <QuestNumberInput
                id={`quest-level-${quest.id}`}
                min={1}
                max={100}
                placeholder={t("editor.quest.optional")}
                value={quest.recommendedLevel}
                allowEmpty
                onValueChange={(recommendedLevel) => onChange({ ...quest, recommendedLevel })}
              />
            </div>
            <QuestChoiceField
              label={t("editor.quest.scope")}
              value={quest.scope}
              options={[
                { value: "party", label: t("editor.quest.scope.party") },
                { value: "personal", label: t("editor.quest.scope.personal") },
              ]}
              onChange={(scope) => onChange({ ...quest, scope: scope as typeof quest.scope })}
            />
            <QuestChoiceField
              label={t("editor.quest.acceptance")}
              value={quest.acceptance}
              options={[
                { value: "manual", label: t("editor.quest.acceptance.manual") },
                { value: "automatic", label: t("editor.quest.acceptance.automatic") },
              ]}
              onChange={(acceptance) =>
                onChange({ ...quest, acceptance: acceptance as typeof quest.acceptance })
              }
            />
            <QuestChoiceField
              label={t("editor.quest.completion")}
              value={quest.completion}
              options={[
                { value: "turn-in", label: t("editor.quest.completion.turnIn") },
                { value: "automatic", label: t("editor.quest.completion.automatic") },
              ]}
              onChange={(completion) =>
                onChange({ ...quest, completion: completion as typeof quest.completion })
              }
            />
            {quest.acceptance === "manual" && (
              <QuestChoiceField
                label={t("editor.quest.giver")}
                value={eventReferenceValue(quest.giver) || "none"}
                options={[{ value: "none", label: t("editor.quest.none") }, ...eventOptions]}
                onChange={(value) =>
                  onChange({
                    ...quest,
                    giver: value === "none" ? null : eventReferenceFromValue(value),
                  })
                }
              />
            )}
            {quest.completion === "turn-in" && (
              <QuestChoiceField
                label={t("editor.quest.turnInTarget")}
                value={eventReferenceValue(quest.turnInTarget) || "none"}
                options={[{ value: "none", label: t("editor.quest.none") }, ...eventOptions]}
                onChange={(value) =>
                  onChange({
                    ...quest,
                    turnInTarget: value === "none" ? null : eventReferenceFromValue(value),
                  })
                }
              />
            )}
          </section>

          <section className="flex flex-wrap gap-x-5 gap-y-3 rounded-lg border border-border p-4">
            <QuestToggleField
              label={t("editor.quest.repeatable")}
              checked={quest.repeatable}
              onChange={(repeatable) => onChange({ ...quest, repeatable })}
            />
            <QuestToggleField
              label={t("editor.quest.abandonable")}
              checked={quest.abandonable}
              onChange={(abandonable) => onChange({ ...quest, abandonable })}
            />
          </section>
        </div>
      </TabsContent>

      <TabsContent value="objectives" className="overflow-y-auto p-5">
        <div className="flex flex-col gap-4">
          <header className="flex flex-wrap items-end justify-between gap-3">
            <div className="w-64">
              <QuestChoiceField
                label={t("editor.quest.objectiveMode")}
                value={quest.objectiveMode}
                options={[
                  { value: "simultaneous", label: t("editor.quest.objectiveMode.simultaneous") },
                  { value: "sequential", label: t("editor.quest.objectiveMode.sequential") },
                ]}
                onChange={(objectiveMode) =>
                  onChange({ ...quest, objectiveMode: objectiveMode as typeof quest.objectiveMode })
                }
              />
            </div>
            <Button
              type="button"
              size="sm"
              disabled={
                quest.objectives.length >= MAX_QUEST_OBJECTIVES ||
                mintRegistryId(quest.objectives) === null
              }
              onClick={addObjective}
            >
              <Plus />
              {t("editor.quest.addObjective")}
            </Button>
          </header>
          {quest.objectives.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              {t("editor.quest.objective.empty")}
            </p>
          ) : (
            quest.objectives.map((objective, index) => (
              <QuestObjectiveEditor
                key={objective.id}
                objective={objective}
                maps={maps}
                sequential={quest.objectiveMode === "sequential"}
                canMoveUp={index > 0}
                canMoveDown={index < quest.objectives.length - 1}
                onChange={(next) => replaceObjective(index, next)}
                onDelete={() =>
                  onChange({
                    ...quest,
                    objectives: quest.objectives.filter(
                      (_, currentIndex) => currentIndex !== index,
                    ),
                  })
                }
                onMove={(direction) => moveObjective(index, direction)}
              />
            ))
          )}
        </div>
      </TabsContent>

      <TabsContent value="prerequisites" className="overflow-y-auto p-5">
        <QuestPrerequisitesEditor
          quest={quest}
          quests={quests}
          registry={registry}
          onChange={onChange}
        />
      </TabsContent>

      <TabsContent value="dialogues" className="overflow-y-auto p-5">
        <QuestDialoguesEditor quest={quest} onChange={onChange} />
      </TabsContent>

      <TabsContent value="rewards" className="overflow-y-auto p-5">
        <QuestRewardsEditor
          quest={quest}
          quests={quests}
          registry={registry}
          maps={maps}
          onChange={onChange}
        />
      </TabsContent>

      <TabsContent value="validation" className="overflow-y-auto p-5">
        <div className="flex max-w-3xl flex-col gap-4">
          <div className="flex items-center gap-2">
            <Badge variant={errors.length === 0 ? "secondary" : "destructive"}>
              {errors.length === 0
                ? t("editor.quest.validation.valid")
                : t("editor.quest.validation.errorCount", { count: errors.length })}
            </Badge>
            {warnings.length > 0 && (
              <Badge variant="outline">
                {t("editor.quest.validation.warningCount", { count: warnings.length })}
              </Badge>
            )}
          </div>
          {diagnostics.length === 0 ? (
            <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
              {t("editor.quest.validation.ready")}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {diagnosticRows.map(({ item: diagnostic, key }) => (
                <li
                  key={key}
                  className={
                    diagnostic.severity === "error"
                      ? "rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900"
                      : "rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
                  }
                >
                  <span className="font-semibold">
                    {diagnostic.severity === "error"
                      ? t("editor.quest.validation.error")
                      : t("editor.quest.validation.warning")}
                    {" · "}
                  </span>
                  {questDiagnosticText(diagnostic)}
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">
            {t("editor.quest.validation.saveDraftHint")}
          </p>
        </div>
      </TabsContent>
    </Tabs>
  );
}
