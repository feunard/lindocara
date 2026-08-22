import { Alert, AlertDescription, AlertTitle } from "@alepha/ui/components/ui/alert";
import { Button } from "@alepha/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@alepha/ui/components/ui/dialog";
import { Label } from "@alepha/ui/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@alepha/ui/components/ui/select";
import { t, useLocale } from "@lindocara/client/i18n.js";
import type { PlayerClass } from "@lindocara/engine/game.js";
import { HERO_CLASSES, isHeroClass } from "@lindocara/engine/hero.js";
import type { AuthoredQuestDefinition, QuestDiagnostic } from "@lindocara/engine/quests.js";
import { AlertTriangle, FlaskConical, Footprints } from "lucide-react";
import { useEffect, useId, useState } from "react";

import { questDiagnosticText } from "./QuestDefinitionEditor.js";

const ADVENTURE_START = "adventure-start";

export interface AdventureTestOptions {
  readonly startMapId: string | null;
  readonly heroClass: PlayerClass;
}

interface AdventureTestDialogProps {
  open: boolean;
  maps: readonly { mapId: string; name: string }[];
  currentMapId: string | null;
  quests: readonly AuthoredQuestDefinition[];
  dirty: boolean;
  busy: boolean;
  error: string | null;
  diagnostics: readonly QuestDiagnostic[];
  onOpenChange(open: boolean): void;
  onQuickPreview(): void;
  onLaunch(options: AdventureTestOptions): void;
}

export function AdventureTestDialog({
  open,
  maps,
  currentMapId,
  quests,
  dirty,
  busy,
  error,
  diagnostics,
  onOpenChange,
  onQuickPreview,
  onLaunch,
}: AdventureTestDialogProps) {
  useLocale();
  const startId = useId();
  const classId = useId();
  const [start, setStart] = useState(ADVENTURE_START);
  const [heroClass, setHeroClass] = useState<PlayerClass>("warrior");

  useEffect(() => {
    if (!open) return;
    setStart(ADVENTURE_START);
  }, [open]);

  const classLabel = t(`class.${heroClass}`);
  const startLabel =
    start === ADVENTURE_START
      ? t("editor.test.start.adventure")
      : (maps.find((map) => map.mapId === start)?.name ?? t("editor.test.start.mapFallback"));

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("editor.test.title")}</DialogTitle>
          <DialogDescription>{t("editor.test.description")}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 py-2">
          <Alert>
            <FlaskConical aria-hidden="true" />
            <AlertTitle>{t("editor.test.isolated.title")}</AlertTitle>
            <AlertDescription>{t("editor.test.isolated.description")}</AlertDescription>
          </Alert>

          <div className="grid gap-2">
            <Label htmlFor={startId}>{t("editor.test.start.label")}</Label>
            <Select
              value={start}
              disabled={busy}
              onValueChange={(value) => {
                if (typeof value === "string") setStart(value);
              }}
            >
              <SelectTrigger id={startId} className="w-full">
                <SelectValue>{startLabel}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ADVENTURE_START}>{t("editor.test.start.adventure")}</SelectItem>
                {maps.map((map) => (
                  <SelectItem key={map.mapId} value={map.mapId}>
                    {map.name} · {t("editor.test.start.mapFallback")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-xs">
              {start === ADVENTURE_START
                ? t("editor.test.start.adventureHint")
                : t("editor.test.start.mapHint")}
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor={classId}>{t("editor.test.class.label")}</Label>
            <Select
              value={heroClass}
              disabled={busy}
              onValueChange={(value) => {
                if (isHeroClass(value)) setHeroClass(value);
              }}
            >
              <SelectTrigger id={classId} className="w-full">
                <SelectValue>{classLabel}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {HERO_CLASSES.map((candidate) => (
                  <SelectItem key={candidate} value={candidate}>
                    {t(`class.${candidate}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {dirty && (
            <Alert>
              <AlertTriangle aria-hidden="true" />
              <AlertTitle>{t("editor.test.save.title")}</AlertTitle>
              <AlertDescription>{t("editor.test.save.description")}</AlertDescription>
            </Alert>
          )}

          {diagnostics.length > 0 && (
            <Alert variant="destructive">
              <AlertTriangle aria-hidden="true" />
              <AlertTitle>{t("editor.test.validation.title")}</AlertTitle>
              <AlertDescription>
                <ul className="mt-2 list-disc space-y-1 pl-4">
                  {diagnostics.map((diagnostic) => {
                    const quest = quests.find((candidate) => candidate.id === diagnostic.questId);
                    return (
                      <li
                        key={`${diagnostic.questId}:${diagnostic.objectiveId ?? "-"}:${diagnostic.code}:${diagnostic.reference ?? "-"}`}
                      >
                        {quest?.title ? `${quest.title} — ` : ""}
                        {questDiagnosticText(diagnostic)}
                      </li>
                    );
                  })}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {error && (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          )}

          <div className="bg-muted/40 rounded-lg border p-4">
            <div className="flex items-start gap-3">
              <Footprints className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <div className="grid gap-1">
                <strong className="text-sm">{t("editor.test.quick.title")}</strong>
                <p className="text-muted-foreground text-xs">
                  {t("editor.test.quick.description")}
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              className="mt-3"
              disabled={busy || currentMapId === null}
              onClick={onQuickPreview}
            >
              {t("editor.test.quick.action")}
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            disabled={busy || maps.length === 0}
            onClick={() =>
              onLaunch({
                startMapId: start === ADVENTURE_START ? null : start,
                heroClass,
              })
            }
          >
            {busy ? t("editor.test.launching") : t("editor.test.launch")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
