import { useEffect, useState } from "react";
import { type AdventureSummary, authErrorText, errorCode, fetchAdventures } from "../../api.js";
import { t, useLocale } from "../../i18n.js";
import { Button } from "../components/button.js";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/dialog.js";

function isSessionError(code: string): boolean {
  return code === "session_expired" || code === "unauthorized";
}

interface LoadAdventureDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Load this adventure into the editor. The screen owns the dirty guard and the session swap; a
   *  successful load closes the dialog. */
  onPick(id: string): void;
  onSessionExpired(): void;
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
  onSessionExpired,
}: LoadAdventureDialogProps) {
  useLocale();
  const [adventures, setAdventures] = useState<AdventureSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload the list each time the dialog opens
  useEffect(() => {
    if (!open) return;
    setError(null);
    setAdventures(null);
    void (async () => {
      try {
        setAdventures(await fetchAdventures());
      } catch (caught) {
        const code = errorCode(caught);
        if (isSessionError(code)) onSessionExpired();
        else setError(code);
      }
    })();
  }, [open]);

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
                <Button variant="secondary" size="sm" onClick={() => onPick(adventure.id)}>
                  {t("editor.picker.open")}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
