import type * as React from "react";
import { useState } from "react";
import type { ExitDestination } from "../../../shared/adventure.js";
import {
  type AdventureDraft,
  bindExit,
  draftComplete,
  draftValidationIssues,
  toAdventureInput,
} from "../../adventure-draft.js";
import { authErrorText, deleteAdventureApi, errorCode, updateAdventureApi } from "../../api.js";
import { t, useLocale } from "../../i18n.js";
import { useUiStore } from "../../store.js";
import { Button } from "../components/button.js";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/dialog.js";
import { Input } from "../components/input.js";
import { Label } from "../components/label.js";

function isSessionError(code: string): boolean {
  return code === "session_expired" || code === "unauthorized";
}

function markerName(labels: Readonly<Record<string, string>>, id: string): string {
  return labels[id] ?? id;
}

/** "end" or "mapId::entryId" — both id alphabets exclude ":". */
function encodeDest(dest: ExitDestination | null): string {
  if (dest === null) return "";
  if (dest === "end") return "end";
  return `${dest.mapId}::${dest.entryId}`;
}

function decodeDest(value: string): ExitDestination | null {
  if (value === "") return null;
  if (value === "end") return "end";
  const [mapId, entryId] = value.split("::");
  if (!mapId || !entryId) return null;
  return { mapId, entryId };
}

/** Dense native select, styled to sit with the shadcn Input in creator surfaces. Native so the
 *  binding pickers stay keyboard- and test-driveable, unlike a portalled listbox. */
function FieldSelect(props: React.ComponentProps<"select">) {
  const { className, ...rest } = props;
  return (
    <select
      className={`h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 ${className ?? ""}`}
      {...rest}
    />
  );
}

interface AdventureSettingsDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** A save or delete landed: the screen refetches names and reloads the session. */
  onSaved(): void;
  onSessionExpired(): void;
}

/**
 * Adventure-level settings for the adventure currently open in the editor (UX wave #2/#5/#6): title,
 * max players, the exit→entry bindings, the graph-validation readout, save and delete. Secondary
 * chrome reached from the menu bar's Fichier menu and the map panel — never a screen of its own.
 *
 * Deliberately slim: membership is implicit now (a map belongs to exactly one adventure, so every
 * owned map is a member — there is no add/remove/reorder), and the starting map is chosen in the
 * Cartes panel, not here. Which adventure is edited is carried by the store's `adventureEditorSession`
 * draft, populated by the picker before the editor mounts.
 */
export function AdventureSettingsDialog({
  open,
  onOpenChange,
  onSaved,
  onSessionExpired,
}: AdventureSettingsDialogProps) {
  useLocale();
  const session = useUiStore((state) => state.adventureEditorSession);
  const setSession = useUiStore((state) => state.setAdventureEditorSession);

  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function fail(caught: unknown): void {
    const code = errorCode(caught);
    if (isSessionError(code)) onSessionExpired();
    else setError(code);
  }

  function updateDraft(draft: AdventureDraft | null): void {
    if (session && draft) setSession({ ...session, draft });
  }

  // Delete the adventure open in the editor session. The server refuses while a party references it.
  // On success the session is cleared, which drops the editor back to the adventure picker.
  async function remove(): Promise<void> {
    if (!session?.adventureId) return;
    setError(null);
    try {
      await deleteAdventureApi(session.adventureId);
      setConfirmingDelete(false);
      onOpenChange(false);
      setSession(null);
      onSaved();
    } catch (caught) {
      setConfirmingDelete(false);
      fail(caught);
    }
  }

  async function save(): Promise<void> {
    if (!session?.adventureId || saving) return;
    const input = toAdventureInput(session.draft);
    if (!input) return;
    setSaving(true);
    setError(null);
    try {
      await updateAdventureApi(session.adventureId, input);
      onOpenChange(false);
      onSaved();
    } catch (caught) {
      fail(caught);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("adventure.title")}</DialogTitle>
        </DialogHeader>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {authErrorText(error)}
          </p>
        )}

        {session && (
          <EditForm
            draft={session.draft}
            saving={saving}
            onUpdate={updateDraft}
            onSave={() => void save()}
            onDelete={() => setConfirmingDelete(true)}
          />
        )}

        <Dialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {t("adventure.delete.title", { name: session?.draft.title ?? "" })}
              </DialogTitle>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmingDelete(false)}>
                {t("adventure.delete.cancel")}
              </Button>
              <Button variant="destructive" onClick={() => void remove()}>
                {t("editor.delete.confirm")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}

function EditForm({
  draft,
  saving,
  onUpdate,
  onSave,
  onDelete,
}: {
  draft: AdventureDraft;
  saving: boolean;
  onUpdate(draft: AdventureDraft | null): void;
  onSave(): void;
  onDelete(): void;
}) {
  useLocale();
  const validationIssues = draftValidationIssues(draft);
  const canSave = draftComplete(draft);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="adventure-title">{t("adventure.name")}</Label>
        <Input
          id="adventure-title"
          type="text"
          value={draft.title}
          onChange={(event) => onUpdate({ ...draft, title: event.currentTarget.value })}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="adventure-players">{t("adventure.players")}</Label>
        <Input
          id="adventure-players"
          type="number"
          min={1}
          max={4}
          value={draft.maxPlayers}
          onChange={(event) =>
            onUpdate({ ...draft, maxPlayers: Number(event.currentTarget.value) })
          }
        />
      </div>

      <section className="flex flex-col gap-2" aria-label={t("adventure.bindings.title")}>
        <h3 className="text-sm font-semibold">{t("adventure.bindings.title")}</h3>
        {draft.bindings.map((binding) => {
          const owner = draft.members.find((member) => member.mapId === binding.mapId);
          const selectId = `binding-${binding.mapId}-${binding.exitId}`;
          return (
            <div key={selectId} className="flex flex-col gap-1.5">
              <Label htmlFor={selectId}>
                {owner?.name} · {markerName(owner?.exitLabels ?? {}, binding.exitId)}
              </Label>
              <FieldSelect
                id={selectId}
                value={encodeDest(binding.dest)}
                onChange={(event) =>
                  onUpdate(
                    bindExit(
                      draft,
                      binding.mapId,
                      binding.exitId,
                      decodeDest(event.currentTarget.value),
                    ),
                  )
                }
              >
                <option value="">{t("adventure.bindings.unbound")}</option>
                <option value="end">{t("adventure.bindings.end")}</option>
                {draft.members.flatMap((member) =>
                  member.entryIds.map((entryId) => (
                    <option
                      key={`${member.mapId}::${entryId}`}
                      value={`${member.mapId}::${entryId}`}
                    >
                      {member.name} · {markerName(member.entryLabels, entryId)}
                    </option>
                  )),
                )}
              </FieldSelect>
            </div>
          );
        })}
      </section>

      <section className="flex flex-col gap-1" aria-label={t("adventure.validation.title")}>
        <h3 className="text-sm font-semibold">{t("adventure.validation.title")}</h3>
        {validationIssues.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("adventure.validation.valid")}</p>
        ) : (
          <ul className="flex flex-col gap-0.5 text-sm text-destructive">
            {validationIssues.map((issue) => {
              const member =
                "mapId" in issue
                  ? draft.members.find((candidate) => candidate.mapId === issue.mapId)
                  : undefined;
              const exit =
                issue.code === "unbound_exit"
                  ? markerName(member?.exitLabels ?? {}, issue.exitId)
                  : "";
              return (
                <li key={`${issue.code}:${"mapId" in issue ? issue.mapId : ""}:${exit}`}>
                  {t(`adventure.validation.${issue.code}`, { map: member?.name ?? "", exit })}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {!canSave && <p className="text-sm text-muted-foreground">{t("adventure.incomplete")}</p>}

      <div className="flex items-center justify-end gap-2">
        <Button variant="destructive" onClick={onDelete}>
          {t("editor.delete")}
        </Button>
        <Button disabled={!canSave || saving} onClick={onSave}>
          {t("editor.save")}
        </Button>
      </div>
    </div>
  );
}
