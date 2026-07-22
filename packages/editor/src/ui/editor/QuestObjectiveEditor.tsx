import { t, useLocale } from "@lindocara/client/i18n.js";
import { CONSUMABLE_IDS, type ConsumableId } from "@lindocara/engine/consumables.js";
import { CURATED_MONSTER_SPECIES, type MonsterSpecies } from "@lindocara/engine/game.js";
import type { MessageKey } from "@lindocara/engine/i18n/index.js";
import type { AuthoredQuestObjective } from "@lindocara/engine/quests.js";
import { Button } from "@lindocara/ui/components/button.js";
import { Input } from "@lindocara/ui/components/input.js";
import { Label } from "@lindocara/ui/components/label.js";
import { ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import { QuestChoiceField } from "./QuestChoiceField.js";
import { QuestNumberInput } from "./QuestNumberInput.js";
import { QuestToggleField } from "./QuestToggleField.js";
import {
  changeQuestObjectiveType,
  createStructuredQuestObjective,
  creatorSlug,
  eventReferenceFromValue,
  eventReferenceValue,
  type QuestMapCatalog,
  questEventLabel,
  questEventOptions,
  STRUCTURED_OBJECTIVE_TYPES,
  type StructuredObjectiveType,
} from "./quest-editor-model.js";

interface QuestObjectiveEditorProps {
  objective: AuthoredQuestObjective;
  maps: readonly QuestMapCatalog[];
  sequential: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onChange(objective: AuthoredQuestObjective): void;
  onDelete(): void;
  onMove(direction: -1 | 1): void;
}

function monsterLabel(species: MonsterSpecies): string {
  return t(`monster.${species}` as MessageKey);
}

function itemLabel(itemId: ConsumableId): string {
  return t(`consumable.${itemId}.name` as MessageKey);
}

function objectiveTypeLabel(type: AuthoredQuestObjective["type"]): string {
  return t(`editor.quest.objective.type.${type}` as MessageKey);
}

export function QuestObjectiveEditor({
  objective,
  maps,
  sequential,
  canMoveUp,
  canMoveDown,
  onChange,
  onDelete,
  onMove,
}: QuestObjectiveEditorProps) {
  useLocale();
  const allEvents = questEventOptions(maps);
  const monsterEvents = questEventOptions(maps, true);
  const mapOptions = maps.map((map) => ({ value: map.mapId, label: map.name }));
  const eventOptions = allEvents.map((option) => ({
    value: eventReferenceValue(option.reference),
    label: questEventLabel(option),
  }));
  const monsterEventOptions = monsterEvents.map((option) => ({
    value: eventReferenceValue(option.reference),
    label: questEventLabel(option),
  }));
  const killMapIds =
    objective.type === "kill" && objective.mapScope.kind === "maps"
      ? objective.mapScope.mapIds
      : [];

  const updateBase = (patch: Partial<AuthoredQuestObjective>): void =>
    onChange({ ...objective, ...patch } as AuthoredQuestObjective);

  return (
    <article className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3">
      <header className="flex items-start gap-2">
        <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 lg:grid-cols-2">
          <QuestChoiceField
            label={t("editor.quest.objective.type")}
            value={objective.type}
            options={[
              ...(objective.type === "manual"
                ? [
                    {
                      value: "manual",
                      label: t("editor.quest.objective.type.manualLegacy"),
                    },
                  ]
                : []),
              ...STRUCTURED_OBJECTIVE_TYPES.map((type) => ({
                value: type,
                label: objectiveTypeLabel(type),
                disabled: createStructuredQuestObjective(objective.id, type, maps) === null,
              })),
            ]}
            onChange={(value) => {
              if (value === "manual") return;
              const changed = changeQuestObjectiveType(
                objective,
                value as StructuredObjectiveType,
                maps,
              );
              if (changed) onChange(changed);
            }}
          />
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor={`quest-objective-label-${objective.id}`}>
              {t("editor.quest.objective.customLabel")}
            </Label>
            <Input
              id={`quest-objective-label-${objective.id}`}
              value={objective.label}
              placeholder={t("editor.quest.objective.automaticLabel")}
              onChange={(event) => updateBase({ label: event.currentTarget.value })}
            />
          </div>
        </div>
        <div className="flex gap-1 pt-5">
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            disabled={!canMoveUp}
            aria-label={t("editor.quest.objective.moveUp")}
            onClick={() => onMove(-1)}
          >
            <ChevronUp />
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            disabled={!canMoveDown}
            aria-label={t("editor.quest.objective.moveDown")}
            onClick={() => onMove(1)}
          >
            <ChevronDown />
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            className="text-destructive"
            aria-label={t("editor.quest.deleteObjective")}
            onClick={onDelete}
          >
            <Trash2 />
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {objective.type === "kill" && (
          <>
            <QuestChoiceField
              label={t("editor.quest.objective.monster")}
              value={objective.species}
              options={CURATED_MONSTER_SPECIES.map((species) => ({
                value: species,
                label: monsterLabel(species),
              }))}
              onChange={(species) => onChange({ ...objective, species: species as MonsterSpecies })}
            />
            <QuestChoiceField
              label={t("editor.quest.objective.credit")}
              value={objective.credit}
              options={[
                { value: "killer", label: t("editor.quest.credit.killer") },
                { value: "contributors", label: t("editor.quest.credit.contributors") },
                { value: "nearby-party", label: t("editor.quest.credit.nearbyParty") },
              ]}
              onChange={(credit) =>
                onChange({ ...objective, credit: credit as typeof objective.credit })
              }
            />
            <QuestChoiceField
              label={t("editor.quest.objective.location")}
              value={objective.mapScope.kind}
              options={[
                { value: "any", label: t("editor.quest.location.any") },
                { value: "maps", label: t("editor.quest.location.maps") },
              ]}
              disabled={maps.length === 0}
              onChange={(kind) =>
                onChange({
                  ...objective,
                  mapScope:
                    kind === "maps" && maps[0]
                      ? { kind: "maps", mapIds: [maps[0].mapId] }
                      : { kind: "any" },
                })
              }
            />
            {objective.mapScope.kind === "maps" && (
              <fieldset className="flex flex-col gap-2 rounded-md border border-border p-2">
                <legend className="px-1 text-xs font-medium">
                  {t("editor.quest.objective.allowedMaps")}
                </legend>
                {maps.map((map) => {
                  const checked = killMapIds.includes(map.mapId);
                  return (
                    <QuestToggleField
                      key={map.mapId}
                      label={map.name}
                      checked={checked}
                      disabled={checked && killMapIds.length === 1}
                      onChange={(next) =>
                        onChange({
                          ...objective,
                          mapScope: {
                            kind: "maps",
                            mapIds: next
                              ? [...killMapIds, map.mapId]
                              : killMapIds.filter((id) => id !== map.mapId),
                          },
                        })
                      }
                    />
                  );
                })}
              </fieldset>
            )}
          </>
        )}

        {objective.type === "defeat-target" && (
          <>
            <QuestChoiceField
              label={t("editor.quest.objective.preciseTarget")}
              value={eventReferenceValue(objective.targetRef)}
              options={monsterEventOptions}
              onChange={(value) => {
                const targetRef = eventReferenceFromValue(value);
                if (targetRef) onChange({ ...objective, targetRef });
              }}
            />
            <QuestChoiceField
              label={t("editor.quest.objective.credit")}
              value={objective.credit}
              options={[
                { value: "killer", label: t("editor.quest.credit.killer") },
                { value: "contributors", label: t("editor.quest.credit.contributors") },
                { value: "nearby-party", label: t("editor.quest.credit.nearbyParty") },
              ]}
              onChange={(credit) =>
                onChange({ ...objective, credit: credit as typeof objective.credit })
              }
            />
          </>
        )}

        {(objective.type === "collect" ||
          objective.type === "deliver" ||
          objective.type === "use-item") && (
          <QuestChoiceField
            label={t("editor.quest.objective.item")}
            value={objective.itemId}
            options={CONSUMABLE_IDS.map((itemId) => ({
              value: itemId,
              label: itemLabel(itemId),
            }))}
            onChange={(itemId) => onChange({ ...objective, itemId })}
          />
        )}

        {objective.type === "collect" && (
          <QuestChoiceField
            label={t("editor.quest.objective.counting")}
            value={objective.counting}
            options={[
              { value: "inventory", label: t("editor.quest.counting.inventory") },
              { value: "acquired", label: t("editor.quest.counting.acquired") },
            ]}
            onChange={(counting) =>
              onChange({ ...objective, counting: counting as typeof objective.counting })
            }
          />
        )}

        {objective.type === "deliver" && (
          <div className="flex items-end pb-2">
            <QuestToggleField
              label={t("editor.quest.objective.consumeItems")}
              checked={objective.consume}
              onChange={(consume) => onChange({ ...objective, consume })}
            />
          </div>
        )}

        {objective.type === "interact" && (
          <>
            <QuestChoiceField
              label={t("editor.quest.objective.interaction")}
              value={objective.interaction}
              options={[
                { value: "talk", label: t("editor.quest.interaction.talk") },
                { value: "interact", label: t("editor.quest.interaction.interact") },
              ]}
              onChange={(interaction) =>
                onChange({ ...objective, interaction: interaction as typeof objective.interaction })
              }
            />
            <QuestChoiceField
              label={t("editor.quest.objective.interactionTarget")}
              value={eventReferenceValue(objective.targetRef)}
              options={eventOptions}
              onChange={(value) => {
                const targetRef = eventReferenceFromValue(value);
                if (targetRef) onChange({ ...objective, targetRef });
              }}
            />
          </>
        )}

        {objective.type === "reach" && (
          <>
            <QuestChoiceField
              label={t("editor.quest.objective.destinationType")}
              value={objective.destination.kind}
              options={[
                { value: "map", label: t("editor.quest.destination.map") },
                { value: "area", label: t("editor.quest.destination.area") },
              ]}
              onChange={(kind) =>
                onChange({
                  ...objective,
                  destination:
                    kind === "area"
                      ? {
                          kind: "area",
                          mapId: objective.destination.mapId,
                          areaId: "area",
                        }
                      : { kind: "map", mapId: objective.destination.mapId },
                })
              }
            />
            <QuestChoiceField
              label={t("editor.quest.objective.destinationMap")}
              value={objective.destination.mapId}
              options={mapOptions}
              onChange={(mapId) =>
                onChange({
                  ...objective,
                  destination: { ...objective.destination, mapId },
                })
              }
            />
            {objective.destination.kind === "area" && (
              <div className="flex flex-col gap-1.5 lg:col-span-2">
                <Label htmlFor={`quest-objective-area-${objective.id}`}>
                  {t("editor.quest.objective.areaName")}
                </Label>
                <Input
                  id={`quest-objective-area-${objective.id}`}
                  value={objective.destination.areaId.replaceAll("_", " ")}
                  onChange={(event) =>
                    onChange({
                      ...objective,
                      destination: {
                        kind: "area",
                        mapId: objective.destination.mapId,
                        areaId: creatorSlug(event.currentTarget.value, "area"),
                      },
                    })
                  }
                />
              </div>
            )}
          </>
        )}

        {objective.type === "use-item" && (
          <>
            <QuestChoiceField
              label={t("editor.quest.objective.useContext")}
              value={objective.context?.kind ?? "any"}
              options={[
                { value: "any", label: t("editor.quest.location.any") },
                { value: "map", label: t("editor.quest.destination.map") },
                { value: "event", label: t("editor.quest.interaction.interact") },
              ]}
              onChange={(kind) => {
                if (kind === "any") onChange({ ...objective, context: null });
                else if (kind === "map" && maps[0]) {
                  onChange({ ...objective, context: { kind: "map", mapId: maps[0].mapId } });
                } else if (kind === "event" && allEvents[0]) {
                  onChange({
                    ...objective,
                    context: { kind: "event", ...allEvents[0].reference },
                  });
                }
              }}
            />
            {objective.context?.kind === "map" && (
              <QuestChoiceField
                label={t("editor.quest.objective.destinationMap")}
                value={objective.context.mapId}
                options={mapOptions}
                onChange={(mapId) => onChange({ ...objective, context: { kind: "map", mapId } })}
              />
            )}
            {objective.context?.kind === "event" && (
              <QuestChoiceField
                label={t("editor.quest.objective.interactionTarget")}
                value={eventReferenceValue(objective.context)}
                options={eventOptions}
                onChange={(value) => {
                  const reference = eventReferenceFromValue(value);
                  if (reference)
                    onChange({ ...objective, context: { kind: "event", ...reference } });
                }}
              />
            )}
          </>
        )}

        {objective.type === "activity" && (
          <div className="flex flex-col gap-1.5 lg:col-span-2">
            <Label htmlFor={`quest-objective-activity-${objective.id}`}>
              {t("editor.quest.objective.activityName")}
            </Label>
            <Input
              id={`quest-objective-activity-${objective.id}`}
              value={objective.activityId.replaceAll("_", " ")}
              onChange={(event) =>
                onChange({ ...objective, activityId: creatorSlug(event.currentTarget.value) })
              }
            />
          </div>
        )}
      </div>

      {objective.type === "manual" && (
        <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-900">
          {t("editor.quest.objective.manualWarning")}
        </p>
      )}

      <footer className="grid grid-cols-1 gap-3 border-t border-border pt-3 sm:grid-cols-[8rem_1fr]">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`quest-objective-target-${objective.id}`}>
            {t("editor.quest.target")}
          </Label>
          <QuestNumberInput
            id={`quest-objective-target-${objective.id}`}
            min={1}
            max={9999}
            disabled={objective.type === "defeat-target" || objective.type === "reach"}
            value={objective.target}
            onValueChange={(target) => updateBase({ target: target ?? 1 })}
          />
        </div>
        <div className="flex flex-wrap items-end gap-x-4 gap-y-2 pb-2">
          <QuestToggleField
            label={t("editor.quest.objective.optional")}
            checked={objective.optional}
            onChange={(optional) => updateBase({ optional })}
          />
          <QuestToggleField
            label={t("editor.quest.objective.hidden")}
            checked={objective.hidden}
            onChange={(hidden) => updateBase({ hidden })}
          />
          {sequential && (
            <div className="flex items-center gap-2 text-xs">
              <Label htmlFor={`quest-objective-stage-${objective.id}`}>
                {t("editor.quest.objective.stage")}
              </Label>
              <QuestNumberInput
                id={`quest-objective-stage-${objective.id}`}
                className="h-7 w-16"
                min={0}
                max={15}
                value={objective.stage}
                onValueChange={(stage) => updateBase({ stage: stage ?? 0 })}
              />
            </div>
          )}
        </div>
      </footer>
    </article>
  );
}
