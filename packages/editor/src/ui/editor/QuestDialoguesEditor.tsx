import { t, useLocale } from "@lindocara/client/i18n.js";
import type { AuthoredQuestDefinition, QuestDialogues } from "@lindocara/engine/quests.js";
import { Label } from "@lindocara/ui/components/label.js";
import { Textarea } from "@lindocara/ui/components/textarea.js";

interface QuestDialoguesEditorProps {
  quest: AuthoredQuestDefinition;
  onChange(quest: AuthoredQuestDefinition): void;
}

const DIALOGUE_FIELDS = [
  "offer",
  "accepted",
  "refused",
  "reminder",
  "ready",
  "turnIn",
  "completed",
  "unavailable",
] as const satisfies readonly (keyof QuestDialogues)[];

export function QuestDialoguesEditor({ quest, onChange }: QuestDialoguesEditorProps) {
  useLocale();

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {DIALOGUE_FIELDS.map((field) => (
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
      ))}
    </div>
  );
}
