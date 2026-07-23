import { t, useLocale } from "@lindocara/client/i18n.js";
import type { AuthoredQuestDefinition } from "@lindocara/engine/adventure-state.js";
import type { EventCommand } from "@lindocara/engine/event-commands.js";
import type { MessageKey } from "@lindocara/engine/i18n/index.js";
import { type EditorAssetId, editorAsset } from "@lindocara/engine/tiny-swords-catalog.js";
import { Button } from "@lindocara/ui/components/button.js";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@lindocara/ui/components/dialog.js";
import { Input } from "@lindocara/ui/components/input.js";
import { useState } from "react";
import type { ElementEventBinding } from "../../game/editor-state.js";
import { EditorAssetPreview } from "./CatalogueAssetPicker.js";

type BindingKind =
  | "dialogue"
  | "loot"
  | "quest-giver"
  | "quest-objective"
  | "quest-turn-in"
  | "custom";

interface ObjectBindingDialogProps {
  assetId: EditorAssetId;
  quests: readonly AuthoredQuestDefinition[];
  onBind(binding: ElementEventBinding): void;
  onCancel(): void;
  onOpenQuestDatabase(): void;
}

/** The friendly bridge between visual scenery and the existing event language. It only creates a
 * useful starter program; Save then opens the full event editor for dialogue and conditions. */
export function ObjectBindingDialog({
  assetId,
  quests,
  onBind,
  onCancel,
  onOpenQuestDatabase,
}: ObjectBindingDialogProps) {
  useLocale();
  const [kind, setKind] = useState<BindingKind>("dialogue");
  const [name, setName] = useState("");
  const [questId, setQuestId] = useState(quests[0]?.id ?? "");
  const selectedQuest = quests.find((quest) => quest.id === questId) ?? quests[0];
  const interactionObjectives =
    selectedQuest?.objectives.filter((objective) => objective.type === "interact") ?? [];
  const [objectiveId, setObjectiveId] = useState(interactionObjectives[0]?.id ?? "");
  const [amount, setAmount] = useState(1);
  const asset = editorAsset(assetId);
  const questBinding = kind.startsWith("quest-");
  const canBind =
    !questBinding || Boolean(selectedQuest && (kind !== "quest-objective" || objectiveId));

  const bind = (): void => {
    const commands: EventCommand[] = [];
    let once = false;
    if (kind === "dialogue") commands.push({ t: "say", name: name || null, text: "" });
    if (kind === "loot") {
      commands.push({ t: "say", name: null, text: "" }, { t: "changeGold", amount });
      once = true;
    }
    const questLink =
      kind === "quest-giver" && selectedQuest
        ? ({ kind: "giver", questId: selectedQuest.id } as const)
        : kind === "quest-turn-in" && selectedQuest
          ? ({ kind: "turn-in", questId: selectedQuest.id } as const)
          : kind === "quest-objective" && selectedQuest && objectiveId
            ? ({
                kind: "objective",
                questId: selectedQuest.id,
                objectiveId,
                interaction:
                  asset?.domain === "character" ? ("talk" as const) : ("interact" as const),
              } as const)
            : undefined;
    onBind({
      name: name.trim(),
      commands,
      once,
      ...(questLink ? { questBinding: questLink } : {}),
    });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("editor.binding.title")}</DialogTitle>
        </DialogHeader>
        <div className="flex items-center gap-3 rounded-lg border border-zinc-200 p-2">
          {asset && (
            <div className="w-20">
              <EditorAssetPreview asset={asset} size={64} />
            </div>
          )}
          <div>
            <strong className="text-sm">{t("editor.binding.caption")}</strong>
            <p className="text-xs text-muted-foreground">{t("editor.binding.hint")}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              "dialogue",
              "loot",
              "quest-giver",
              "quest-objective",
              "quest-turn-in",
              "custom",
            ] as const
          ).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={kind === option}
              className={`rounded-lg border p-2 text-left text-xs ${kind === option ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 hover:border-zinc-400"}`}
              onClick={() => setKind(option)}
            >
              <strong className="block">{t(`editor.binding.kind.${option}`)}</strong>
              <span className={kind === option ? "text-zinc-300" : "text-muted-foreground"}>
                {t(`editor.binding.kind.${option}.hint`)}
              </span>
            </button>
          ))}
        </div>
        {(kind === "dialogue" || kind === "quest-giver" || kind === "quest-turn-in") && (
          <Input
            aria-label={t("editor.binding.name")}
            placeholder={t("editor.binding.name")}
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
          />
        )}
        {questBinding && (
          <div className="flex flex-col gap-2 rounded-lg bg-zinc-50 p-3">
            {quests.length === 0 ? (
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">{t("editor.binding.noQuest")}</p>
                <Button size="sm" variant="outline" onClick={onOpenQuestDatabase}>
                  {t("editor.binding.createQuest")}
                </Button>
              </div>
            ) : (
              <>
                <select
                  aria-label={t("editor.event.cmd.field.quest")}
                  className="h-8 rounded-md border border-input bg-white px-2 text-xs"
                  value={selectedQuest?.id ?? ""}
                  onChange={(event) => {
                    const id = event.currentTarget.value;
                    setQuestId(id);
                    setObjectiveId(
                      quests
                        .find((quest) => quest.id === id)
                        ?.objectives.find((objective) => objective.type === "interact")?.id ?? "",
                    );
                  }}
                >
                  {quests.map((quest) => (
                    <option key={quest.id} value={quest.id}>
                      {quest.title || quest.id}
                    </option>
                  ))}
                </select>
                {kind === "quest-objective" && (
                  <select
                    aria-label={t("editor.event.cmd.field.objective")}
                    className="h-8 rounded-md border border-input bg-white px-2 text-xs"
                    value={objectiveId}
                    onChange={(event) => setObjectiveId(event.currentTarget.value)}
                  >
                    {interactionObjectives.map((objective) => (
                      <option key={objective.id} value={objective.id}>
                        {objective.label ||
                          t(`editor.quest.objective.type.${objective.type}` as MessageKey)}
                      </option>
                    ))}
                  </select>
                )}
              </>
            )}
          </div>
        )}
        {kind === "loot" && (
          <Input
            type="number"
            min={1}
            aria-label={t("editor.binding.gold")}
            value={amount}
            onChange={(event) =>
              setAmount(Math.max(1, Math.trunc(Number(event.currentTarget.value) || 1)))
            }
          />
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {t("editor.event.cancel")}
          </Button>
          <Button disabled={!canBind} onClick={bind}>
            {t("editor.binding.continue")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
