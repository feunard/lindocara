import { Button } from "@alepha/ui/components/ui/button";
import { Checkbox } from "@alepha/ui/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@alepha/ui/components/ui/dialog";
import { Input } from "@alepha/ui/components/ui/input";
import { Label } from "@alepha/ui/components/ui/label";
import {
  type AdventureDraft,
  draftSaveable,
  toAdventureInput,
} from "@lindocara/client/adventure-draft.js";
import {
  authErrorText,
  deleteAdventureApi,
  errorCode,
  isUnauthorizedCode,
  updateAdventureApi,
} from "@lindocara/client/api.js";
import { t, useLocale } from "@lindocara/client/i18n.js";
import { adventureEditorSessionAtom } from "@lindocara/client/state/atoms.js";
import { useAlepha, useStore } from "alepha/react";
import { useEffect, useState } from "react";
import { AudioConfigFields } from "./AudioConfigFields.js";

interface AdventureSettingsDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** A save or delete landed: the screen refetches names and reloads the session. */
  onSaved(): void;
  /** The merged editor can atomically persist its live map and this graph. Returning the saved draft
   * closes the dialog; null keeps it open and leaves the surfaced error in the parent. */
  onSaveDraft?(draft: AdventureDraft): Promise<AdventureDraft | null>;
}

/**
 * Adventure-level settings for the adventure currently open in the editor: title, max players, save
 * and delete. Secondary chrome reached from the menu bar's Fichier menu and the map panel — never a
 * screen of its own.
 *
 * Deliberately slim since the graph teardown: there are no exit→entry bindings, no start picker and
 * no graph-validation readout any more — the adventure graph is no longer authored. Membership is
 * implicit (a map belongs to exactly one adventure, so every owned map is a member — no
 * add/remove/reorder), and where a hero spawns is derived server-side from a placed spawn event.
 * Which adventure is edited is carried by the store's `adventureEditorSession` draft.
 */
export function AdventureSettingsDialog({
  open,
  onOpenChange,
  onSaved,
  onSaveDraft,
}: AdventureSettingsDialogProps) {
  useLocale();
  const alepha = useAlepha();
  const [session, setSession] = useStore(adventureEditorSessionAtom);

  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<AdventureDraft | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(session?.draft ?? null);
    setError(null);
  }, [open, session?.draft]);

  function fail(caught: unknown): void {
    const code = errorCode(caught);
    if (isUnauthorizedCode(code)) return;
    setError(code);
  }

  // Delete the adventure open in the editor session. The server refuses while a party references it.
  // On success the session is cleared, which drops the editor back to the adventure picker.
  async function remove(): Promise<void> {
    if (!session?.adventureId || saving) return;
    setSaving(true);
    setError(null);
    try {
      await deleteAdventureApi(session.adventureId, true);
      setConfirmingDelete(false);
      onOpenChange(false);
      setSession(null);
      onSaved();
    } catch (caught) {
      setConfirmingDelete(false);
      fail(caught);
    } finally {
      setSaving(false);
    }
  }

  async function save(): Promise<void> {
    if (!session || saving) return;
    if (!draft) return;
    const input = toAdventureInput(draft);
    if (!input) return;
    // An unsaved sandbox has no adventure to PUT: naming it here IS its first save, and only the
    // editor's own `onSaveDraft` can perform that (it creates the adventure and the map together).
    // Without that seam there is nothing this dialog could write.
    if (!session.adventureId && !onSaveDraft) return;
    setSaving(true);
    setError(null);
    try {
      let savedDraft: AdventureDraft | null;
      if (onSaveDraft) savedDraft = await onSaveDraft(draft);
      else if (session.adventureId) {
        await updateAdventureApi(session.adventureId, input);
        savedDraft = draft;
      } else savedDraft = null;
      if (!savedDraft) return;
      const latest = alepha.store.get(adventureEditorSessionAtom);
      if (latest) {
        setSession({
          ...latest,
          draft: savedDraft,
          savedDraft: JSON.stringify(savedDraft),
          invalidatedLinks: [],
        });
      }
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

        {session && draft && (
          <EditForm
            draft={draft}
            saving={saving}
            // Nothing to delete while the session is an unsaved sandbox: no row exists yet, and a
            // dead destructive button reads as a broken one.
            deletable={session?.adventureId != null}
            onUpdate={(next) => {
              if (next) setDraft(next);
            }}
            onSave={() => void save()}
            onDelete={() => {
              setConfirmingDelete(true);
            }}
          />
        )}

        <Dialog
          open={confirmingDelete}
          onOpenChange={(next) => {
            setConfirmingDelete(next);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {t("adventure.delete.title", { name: draft?.title ?? session?.draft.title ?? "" })}
              </DialogTitle>
            </DialogHeader>
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
              <Checkbox id="force-delete-current-adventure" checked disabled />
              <div className="grid gap-1">
                <Label htmlFor="force-delete-current-adventure">{t("editor.delete.force")}</Label>
                <p className="text-xs text-muted-foreground">{t("editor.delete.force_warning")}</p>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setConfirmingDelete(false);
                }}
              >
                {t("adventure.delete.cancel")}
              </Button>
              <Button variant="destructive" disabled={saving} onClick={() => void remove()}>
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
  deletable,
  onUpdate,
  onSave,
  onDelete,
}: {
  draft: AdventureDraft;
  saving: boolean;
  /** False for an unsaved sandbox: there is no stored adventure to delete. */
  deletable: boolean;
  onUpdate(draft: AdventureDraft | null): void;
  onSave(): void;
  onDelete(): void;
}) {
  useLocale();
  // Save is gated on title/players only — there is no graph to validate any more.
  const canSave = draftSaveable(draft);

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

      <section className="grid gap-2 rounded-md border border-zinc-200 p-3">
        <div>
          <h3 className="text-sm font-medium">{t("editor.audio.heading")}</h3>
          <p className="text-xs text-muted-foreground">{t("editor.audio.adventureHint")}</p>
        </div>
        <AudioConfigFields
          variant="adventure"
          value={draft.audio}
          onChange={(audio) => onUpdate({ ...draft, audio })}
        />
      </section>

      <div className="flex items-center justify-end gap-2">
        {deletable && (
          <Button variant="destructive" disabled={saving} onClick={onDelete}>
            {t("editor.delete")}
          </Button>
        )}
        <Button disabled={!canSave || saving} onClick={onSave}>
          {t("editor.save")}
        </Button>
      </div>
    </div>
  );
}
