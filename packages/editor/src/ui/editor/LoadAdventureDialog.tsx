import {
  type AdventureSummary,
  authErrorText,
  deleteAdventureApi,
  errorCode,
  fetchAdventures,
  isUnauthorizedCode,
} from "@lindocara/client/api.js";
import { t, useLocale } from "@lindocara/client/i18n.js";
import { Button } from "@lindocara/ui/components/button.js";
import { Checkbox } from "@lindocara/ui/components/checkbox.js";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@lindocara/ui/components/dialog.js";
import { Label } from "@lindocara/ui/components/label.js";
import { useEffect, useState } from "react";

interface LoadAdventureDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Load this adventure into the editor. The screen owns the dirty guard and the session swap; a
   *  successful load closes the dialog. */
  onPick(id: string): void;
  /** Keep the editor session coherent when the adventure currently open in the shell was deleted. */
  onDeleted(id: string): void;
}

/**
 * Load an existing adventure (UX wave #15): the editor opens directly on an adventure, so the old
 * picker page is gone — the only way to switch to another saved adventure is here, from the File menu.
 * It lists the account's adventures (title, map count, a playable/draft badge) and hands the chosen id
 * to the screen, which guards unsaved edits before swapping the session. Stock shadcn / native
 * controls: this is a creator surface, so the two-tree rule keeps Tiny Swords out. The dialog portals
 * with `data-slot="dialog-content"`, so the shell's shortcut gate already treats keystrokes inside it
 * as inert.
 */
export function LoadAdventureDialog({
  open,
  onOpenChange,
  onPick,
  onDeleted,
}: LoadAdventureDialogProps) {
  useLocale();
  const [adventures, setAdventures] = useState<AdventureSummary[] | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<AdventureSummary | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setAdventures(null);
    setConfirmingDelete(null);
    void (async () => {
      try {
        setAdventures(await fetchAdventures());
      } catch (caught) {
        const code = errorCode(caught);
        if (!isUnauthorizedCode(code)) setError(code);
      }
    })();
  }, [open]);

  async function remove(adventure: AdventureSummary): Promise<void> {
    if (deletingId !== null) return;
    setDeletingId(adventure.id);
    setError(null);
    try {
      await deleteAdventureApi(adventure.id, true);
      setAdventures(
        (current) => current?.filter((candidate) => candidate.id !== adventure.id) ?? [],
      );
      setConfirmingDelete(null);
      onDeleted(adventure.id);
    } catch (caught) {
      const code = errorCode(caught);
      setConfirmingDelete(null);
      if (!isUnauthorizedCode(code)) setError(code);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("editor.load.title")}</DialogTitle>
        </DialogHeader>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {authErrorText(error)}
          </p>
        )}

        {adventures === null ? (
          <p className="text-sm text-muted-foreground" role="status">
            {t("editor.picker.loading")}
          </p>
        ) : adventures.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("editor.load.empty")}</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {adventures.map((adventure) => (
              <li
                key={adventure.id}
                className="flex items-center gap-3 rounded-md border border-zinc-200 px-3 py-2"
              >
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium">{adventure.title}</span>
                  <span className="flex items-center gap-2 text-xs text-zinc-500">
                    <span>{t("editor.picker.maps", { count: adventure.mapCount })}</span>
                    {adventure.author && (
                      <span className="truncate">
                        {t("editor.picker.author", { author: adventure.author })}
                      </span>
                    )}
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                        adventure.playable
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-amber-100 text-amber-700"
                      }`}
                    >
                      {adventure.playable ? t("editor.picker.playable") : t("editor.picker.draft")}
                    </span>
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Button variant="secondary" size="sm" onClick={() => onPick(adventure.id)}>
                    {t("editor.picker.open")}
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={deletingId !== null}
                    onClick={() => {
                      setConfirmingDelete(adventure);
                    }}
                  >
                    {t("editor.delete")}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <Dialog
          open={confirmingDelete !== null}
          onOpenChange={(next) => {
            if (!next && deletingId === null) {
              setConfirmingDelete(null);
            }
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {t("adventure.delete.title", { name: confirmingDelete?.title ?? "" })}
              </DialogTitle>
            </DialogHeader>
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
              <Checkbox id="force-delete-loaded-adventure" checked disabled />
              <div className="grid gap-1">
                <Label htmlFor="force-delete-loaded-adventure">{t("editor.delete.force")}</Label>
                <p className="text-xs text-muted-foreground">{t("editor.delete.force_warning")}</p>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                disabled={deletingId !== null}
                onClick={() => {
                  setConfirmingDelete(null);
                }}
              >
                {t("adventure.delete.cancel")}
              </Button>
              <Button
                variant="destructive"
                disabled={deletingId !== null}
                onClick={() => {
                  if (confirmingDelete) void remove(confirmingDelete);
                }}
              >
                {t("editor.delete.confirm")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}
