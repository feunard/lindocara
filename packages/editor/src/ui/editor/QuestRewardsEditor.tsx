import { t, useLocale } from "@lindocara/client/i18n.js";
import type { AdventureRegistry } from "@lindocara/engine/adventure-state.js";
import { mintRegistryId } from "@lindocara/engine/adventure-state.js";
import { CONSUMABLE_IDS, type ConsumableId } from "@lindocara/engine/consumables.js";
import type { MessageKey } from "@lindocara/engine/i18n/index.js";
import {
  type AuthoredQuestDefinition,
  MAX_QUEST_REWARD_CHOICES,
  MAX_QUEST_REWARD_ITEMS,
  type QuestItemReward,
  type QuestRewardChoice,
  type QuestRewards,
  type QuestStateReward,
} from "@lindocara/engine/quests.js";
import { Button } from "@lindocara/ui/components/button.js";
import { Input } from "@lindocara/ui/components/input.js";
import { Label } from "@lindocara/ui/components/label.js";
import { Plus, Trash2 } from "lucide-react";
import { EventCommandEditor } from "./EventCommandEditor.js";
import { QuestChoiceField } from "./QuestChoiceField.js";
import { QuestNumberInput } from "./QuestNumberInput.js";
import type { QuestMapCatalog } from "./quest-editor-model.js";
import { useStableObjectKeys } from "./use-stable-object-keys.js";

interface QuestRewardsEditorProps {
  quest: AuthoredQuestDefinition;
  quests: readonly AuthoredQuestDefinition[];
  registry: AdventureRegistry;
  maps: readonly QuestMapCatalog[];
  onChange(quest: AuthoredQuestDefinition): void;
}

function itemLabel(itemId: ConsumableId): string {
  return t(`consumable.${itemId}.name` as MessageKey);
}

function unnamed(kind: "switch" | "variable", index: number): string {
  return t(
    kind === "switch"
      ? "editor.quest.prerequisite.unnamedSwitch"
      : "editor.quest.prerequisite.unnamedVariable",
    { number: index + 1 },
  );
}

function itemOptions() {
  return CONSUMABLE_IDS.map((itemId) => ({ value: itemId, label: itemLabel(itemId) }));
}

function RewardItems({
  items,
  onChange,
}: {
  items: readonly QuestItemReward[];
  onChange(items: readonly QuestItemReward[]): void;
}) {
  const itemRows = useStableObjectKeys(items, "reward-item");
  return (
    <div className="flex flex-col gap-2">
      {itemRows.map(({ item, key }, index) => (
        <div key={key} className="grid grid-cols-[1fr_7rem_auto] items-end gap-2">
          <QuestChoiceField
            label={t("editor.quest.reward.item")}
            value={item.itemId}
            options={itemOptions()}
            onChange={(itemId) =>
              onChange(
                items.map((current, currentIndex) =>
                  currentIndex === index ? { ...current, itemId } : current,
                ),
              )
            }
          />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`quest-reward-quantity-${key}`}>
              {t("editor.quest.reward.quantity")}
            </Label>
            <QuestNumberInput
              id={`quest-reward-quantity-${key}`}
              min={1}
              max={9999}
              value={item.quantity}
              onValueChange={(quantity) =>
                onChange(
                  items.map((current, currentIndex) =>
                    currentIndex === index ? { ...current, quantity: quantity ?? 1 } : current,
                  ),
                )
              }
            />
          </div>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            className="mb-0.5 text-destructive"
            aria-label={t("editor.quest.reward.deleteItem")}
            onClick={() => onChange(items.filter((_, currentIndex) => currentIndex !== index))}
          >
            <Trash2 />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="w-fit"
        disabled={items.length >= MAX_QUEST_REWARD_ITEMS}
        onClick={() => onChange([...items, { itemId: CONSUMABLE_IDS[0], quantity: 1 }])}
      >
        <Plus />
        {t("editor.quest.reward.addItem")}
      </Button>
    </div>
  );
}

export function QuestRewardsEditor({
  quest,
  quests,
  registry,
  maps,
  onChange,
}: QuestRewardsEditorProps) {
  useLocale();
  const rewards = quest.rewards;
  const stateRows = useStableObjectKeys(rewards.stateChanges, "state-reward");
  const update = (patch: Partial<QuestRewards>): void =>
    onChange({ ...quest, rewards: { ...rewards, ...patch } });

  const replaceChoice = (index: number, choice: QuestRewardChoice): void =>
    update({
      choices: rewards.choices.map((current, currentIndex) =>
        currentIndex === index ? choice : current,
      ),
    });

  const replaceState = (index: number, change: QuestStateReward): void =>
    update({
      stateChanges: rewards.stateChanges.map((current, currentIndex) =>
        currentIndex === index ? change : current,
      ),
    });

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <div>
          <h3 className="text-sm font-semibold">{t("editor.quest.reward.guaranteed")}</h3>
          <p className="text-xs text-muted-foreground">{t("editor.quest.reward.guaranteedHint")}</p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`quest-reward-xp-${quest.id}`}>
              {t("editor.quest.reward.experience")}
            </Label>
            <QuestNumberInput
              id={`quest-reward-xp-${quest.id}`}
              min={0}
              value={rewards.experience}
              onValueChange={(experience) => update({ experience: experience ?? 0 })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`quest-reward-gold-${quest.id}`}>{t("editor.quest.reward.gold")}</Label>
            <QuestNumberInput
              id={`quest-reward-gold-${quest.id}`}
              min={0}
              value={rewards.gold}
              onValueChange={(gold) => update({ gold: gold ?? 0 })}
            />
          </div>
        </div>
        <RewardItems items={rewards.items} onChange={(items) => update({ items })} />
      </section>

      <section className="flex flex-col gap-3 border-t border-border pt-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">{t("editor.quest.reward.choice")}</h3>
            <p className="text-xs text-muted-foreground">{t("editor.quest.reward.choiceHint")}</p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={
              rewards.choices.length >= MAX_QUEST_REWARD_CHOICES ||
              mintRegistryId(rewards.choices) === null
            }
            onClick={() => {
              const id = mintRegistryId(rewards.choices);
              if (!id) return;
              update({
                choices: [...rewards.choices, { id, label: "", experience: 0, gold: 0, items: [] }],
              });
            }}
          >
            <Plus />
            {t("editor.quest.reward.addChoice")}
          </Button>
        </div>
        {rewards.choices.length === 0 ? (
          <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
            {t("editor.quest.reward.noChoice")}
          </p>
        ) : (
          rewards.choices.map((choice, index) => (
            <article
              key={choice.id}
              className="flex flex-col gap-3 rounded-lg border border-border p-3"
            >
              <header className="flex items-end gap-2">
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <Label htmlFor={`quest-reward-choice-${quest.id}-${choice.id}`}>
                    {t("editor.quest.reward.choiceLabel")}
                  </Label>
                  <Input
                    id={`quest-reward-choice-${quest.id}-${choice.id}`}
                    value={choice.label}
                    placeholder={t("editor.quest.reward.choiceLabelPlaceholder")}
                    onChange={(event) =>
                      replaceChoice(index, { ...choice, label: event.currentTarget.value })
                    }
                  />
                </div>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  className="mb-0.5 text-destructive"
                  aria-label={t("editor.quest.reward.deleteChoice")}
                  onClick={() =>
                    update({
                      choices: rewards.choices.filter((_, currentIndex) => currentIndex !== index),
                    })
                  }
                >
                  <Trash2 />
                </Button>
              </header>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`quest-reward-choice-xp-${quest.id}-${choice.id}`}>
                    {t("editor.quest.reward.experience")}
                  </Label>
                  <QuestNumberInput
                    id={`quest-reward-choice-xp-${quest.id}-${choice.id}`}
                    min={0}
                    value={choice.experience}
                    onValueChange={(experience) =>
                      replaceChoice(index, {
                        ...choice,
                        experience: experience ?? 0,
                      })
                    }
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`quest-reward-choice-gold-${quest.id}-${choice.id}`}>
                    {t("editor.quest.reward.gold")}
                  </Label>
                  <QuestNumberInput
                    id={`quest-reward-choice-gold-${quest.id}-${choice.id}`}
                    min={0}
                    value={choice.gold}
                    onValueChange={(gold) =>
                      replaceChoice(index, {
                        ...choice,
                        gold: gold ?? 0,
                      })
                    }
                  />
                </div>
              </div>
              <RewardItems
                items={choice.items}
                onChange={(items) => replaceChoice(index, { ...choice, items })}
              />
            </article>
          ))
        )}
      </section>

      <section className="flex flex-col gap-3 border-t border-border pt-5">
        <h3 className="text-sm font-semibold">{t("editor.quest.reward.chainAndState")}</h3>
        <QuestChoiceField
          label={t("editor.quest.reward.nextQuest")}
          value={rewards.nextQuestId ?? "none"}
          options={[
            { value: "none", label: t("editor.quest.none") },
            ...quests
              .filter((candidate) => candidate.id !== quest.id)
              .map((candidate) => ({
                value: candidate.id,
                label: candidate.title || t("editor.quest.untitled"),
              })),
          ]}
          onChange={(nextQuestId) =>
            update({ nextQuestId: nextQuestId === "none" ? null : nextQuestId })
          }
        />
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={registry.switches.length === 0 || rewards.stateChanges.length >= 8}
            onClick={() => {
              const entry = registry.switches[0];
              if (entry)
                update({
                  stateChanges: [
                    ...rewards.stateChanges,
                    { type: "switch", switchId: entry.id, value: true },
                  ],
                });
            }}
          >
            {t("editor.quest.reward.addSwitch")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={registry.variables.length === 0 || rewards.stateChanges.length >= 8}
            onClick={() => {
              const entry = registry.variables[0];
              if (entry)
                update({
                  stateChanges: [
                    ...rewards.stateChanges,
                    { type: "variable", variableId: entry.id, op: "add", value: 1 },
                  ],
                });
            }}
          >
            {t("editor.quest.reward.addVariable")}
          </Button>
        </div>
        {stateRows.map(({ item: change, key }, index) => (
          <div
            key={key}
            className="grid grid-cols-[1fr_1fr_auto] items-end gap-2 rounded-md border border-border p-3"
          >
            {change.type === "switch" ? (
              <>
                <QuestChoiceField
                  label={t("editor.quest.prerequisite.switch")}
                  value={change.switchId}
                  options={registry.switches.map((entry, entryIndex) => ({
                    value: entry.id,
                    label: entry.name || unnamed("switch", entryIndex),
                  }))}
                  onChange={(switchId) => replaceState(index, { ...change, switchId })}
                />
                <QuestChoiceField
                  label={t("editor.quest.prerequisite.expected")}
                  value={change.value ? "on" : "off"}
                  options={[
                    { value: "on", label: t("editor.quest.prerequisite.on") },
                    { value: "off", label: t("editor.quest.prerequisite.off") },
                  ]}
                  onChange={(value) => replaceState(index, { ...change, value: value === "on" })}
                />
              </>
            ) : (
              <>
                <QuestChoiceField
                  label={t("editor.quest.prerequisite.variable")}
                  value={change.variableId}
                  options={registry.variables.map((entry, entryIndex) => ({
                    value: entry.id,
                    label: entry.name || unnamed("variable", entryIndex),
                  }))}
                  onChange={(variableId) => replaceState(index, { ...change, variableId })}
                />
                <div className="grid grid-cols-[7rem_1fr] gap-2">
                  <QuestChoiceField
                    label={t("editor.quest.reward.operation")}
                    value={change.op}
                    options={[
                      { value: "add", label: t("editor.quest.reward.operation.add") },
                      { value: "set", label: t("editor.quest.reward.operation.set") },
                    ]}
                    onChange={(op) => replaceState(index, { ...change, op: op as "add" | "set" })}
                  />
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`quest-reward-state-value-${key}`}>
                      {t("editor.quest.reward.value")}
                    </Label>
                    <QuestNumberInput
                      id={`quest-reward-state-value-${key}`}
                      value={change.value}
                      onValueChange={(value) =>
                        replaceState(index, { ...change, value: value ?? 0 })
                      }
                    />
                  </div>
                </div>
              </>
            )}
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              className="mb-0.5 text-destructive"
              aria-label={t("editor.quest.reward.deleteState")}
              onClick={() =>
                update({
                  stateChanges: rewards.stateChanges.filter(
                    (_, currentIndex) => currentIndex !== index,
                  ),
                })
              }
            >
              <Trash2 />
            </Button>
          </div>
        ))}
      </section>

      <details className="border-t border-border pt-5">
        <summary className="cursor-pointer text-sm font-semibold">
          {t("editor.quest.reward.advanced")}
        </summary>
        <p className="mb-3 mt-1 text-xs text-muted-foreground">
          {t("editor.quest.reward.advancedHint")}
        </p>
        <EventCommandEditor
          commands={rewards.customCommands}
          switches={registry.switches}
          variables={registry.variables}
          quests={quests}
          maps={maps}
          onChange={(customCommands) => update({ customCommands })}
        />
      </details>
    </div>
  );
}
