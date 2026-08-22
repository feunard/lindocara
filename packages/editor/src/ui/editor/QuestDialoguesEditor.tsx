import { Label } from "@alepha/ui/components/ui/label";
import { Textarea } from "@alepha/ui/components/ui/textarea";
import { t, useLocale } from "@lindocara/client/i18n.js";
import type { AuthoredQuestDefinition, QuestDialogues } from "@lindocara/engine/quests.js";

import {
  eventReferenceValue,
  type QuestMapCatalog,
  questEventLabel,
  questEventOptions,
} from "./quest-editor-model.js";

interface QuestDialoguesEditorProps {
  quest: AuthoredQuestDefinition;
  maps: readonly QuestMapCatalog[];
  onChange(quest: AuthoredQuestDefinition): void;
}

const GIVER_FIELDS = [
  "offer",
  "accepted",
  "refused",
  "reminder",
  "unavailable",
] as const satisfies readonly (keyof QuestDialogues)[];

const TURN_IN_FIELDS = [
  "ready",
  "turnIn",
  "completed",
] as const satisfies readonly (keyof QuestDialogues)[];

export function QuestDialoguesEditor({ quest, maps, onChange }: QuestDialoguesEditorProps) {
  useLocale();
  const options = questEventOptions(maps);

  function speakerName(reference: AuthoredQuestDefinition["giver"]): string {
    const value = eventReferenceValue(reference);
    const option = options.find((candidate) => eventReferenceValue(candidate.reference) === value);
    return option ? questEventLabel(option) : t("editor.quest.dialogue.speakerMissing");
  }

  function renderFields(fields: readonly (keyof QuestDialogues)[]) {
    return fields.map((field) => (
      <div key={field} className="flex flex-col gap-1.5">
        <Label htmlFor={`quest-dialogue-${quest.id}-${field}`}>
          {t(`editor.quest.dialogue.${field}`)}
        </Label>
        <Textarea
          id={`quest-dialogue-${quest.id}-${field}`}
          rows={4}
          maxLength={2000}
          value={quest.dialogues[field]}
          placeholder={t(`editor.quest.dialogue.${field}.placeholder`)}
          onChange={(event) =>
            onChange({
              ...quest,
              dialogues: { ...quest.dialogues, [field]: event.currentTarget.value },
            })
          }
        />
      </div>
    ));
  }

  return (
    <div className="flex max-w-5xl flex-col gap-5">
      <p className="rounded-lg border border-violet-200 bg-violet-50 p-3 text-sm leading-relaxed text-violet-950">
        {t("editor.quest.dialogue.intro")}
      </p>

      <section className="border-border rounded-lg border p-4">
        <header className="mb-4">
          <h3 className="font-semibold">
            {t("editor.quest.dialogue.giverGroup", {
              speaker:
                quest.acceptance === "manual"
                  ? speakerName(quest.giver)
                  : t("editor.quest.dialogue.automaticSpeaker"),
            })}
          </h3>
          <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
            {t("editor.quest.dialogue.giverGroupHint")}
          </p>
        </header>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">{renderFields(GIVER_FIELDS)}</div>
      </section>

      <section className="border-border rounded-lg border p-4">
        <header className="mb-4">
          <h3 className="font-semibold">
            {t("editor.quest.dialogue.turnInGroup", {
              speaker:
                quest.completion === "turn-in"
                  ? speakerName(quest.turnInTarget)
                  : t("editor.quest.dialogue.automaticSpeaker"),
            })}
          </h3>
          <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
            {t("editor.quest.dialogue.turnInGroupHint")}
          </p>
        </header>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">{renderFields(TURN_IN_FIELDS)}</div>
      </section>
    </div>
  );
}
