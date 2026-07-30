import {
  type AdventureSummary,
  authErrorText,
  createAdventureApi,
  deleteAdventureApi,
  errorCode,
  fetchAllAdventures,
} from "@lindocara/client/api.js";
import { t, useLocale } from "@lindocara/client/i18n.js";
import { adventureEditorSessionAtom } from "@lindocara/client/state/atoms.js";
import { Button } from "@lindocara/ui/components/button.js";
import { Checkbox } from "@lindocara/ui/components/checkbox.js";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@lindocara/ui/components/dialog.js";
import { Input } from "@lindocara/ui/components/input.js";
import { Label } from "@lindocara/ui/components/label.js";
import { useStore } from "alepha/react";
import { useRouter } from "alepha/react/router";
import { useEffect, useState } from "react";
import { loadAdventureSession } from "./adventure-session.js";

/**
 * A dead/expired session (`session_expired`, `unauthorized`) is caught here only to SKIP surfacing a
 * generic error banner while the client's global 401 seam (`packages/client/src/api.ts`'s `api()`
 * helper, `state/navigation.ts`'s `onUnauthorized`) is already redirecting to `/auth` — that redirect
 * itself is no longer this screen's job (Task 6 removed the editor's local `setScreen("auth")`
 * navigation once the global hook was confirmed to cover every one of the editor's own machine
 * codes, `unauthorized` included).
 */
function isSessionError(code: string): boolean {
  return code === "session_expired" || code === "unauthorized";
}

/** Explicit landing page for creator tools: entering the editor never silently picks or creates data. */
export function AdventurePickerScreen() {
  useLocale();
  const router = useRouter();
  const [, setSession] = useStore(adventureEditorSessionAtom);
  const [adventures, setAdventures] = useState<AdventureSummary[] | null>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState<AdventureSummary | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await fetchAllAdventures();
        if (!cancelled) setAdventures(loaded);
      } catch (caught) {
        if (cancelled) return;
        const code = errorCode(caught);
        if (isSessionError(code)) return;
        setAdventures([]);
        setError(code);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function openAdventure(id: string): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const loaded = await loadAdventureSession(id);
      setBusy(false);
      setSession(loaded);
    } catch (caught) {
      const code = errorCode(caught);
      setBusy(false);
      if (isSessionError(code)) return;
      setError(code);
    }
  }

  async function createAdventure(): Promise<void> {
    const trimmed = title.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const created = await createAdventureApi({ title: trimmed, maxPlayers: 4 });
      const loaded = await loadAdventureSession(created.id);
      setBusy(false);
      setSession(loaded);
    } catch (caught) {
      const code = errorCode(caught);
      setBusy(false);
      if (isSessionError(code)) return;
      setError(code);
    }
  }

  async function removeAdventure(adventure: AdventureSummary): Promise<void> {
    if (deletingId !== null) return;
    setDeletingId(adventure.id);
    setError(null);
    try {
      await deleteAdventureApi(adventure.id, true);
      setAdventures(
        (current) => current?.filter((candidate) => candidate.id !== adventure.id) ?? [],
      );
      setConfirmingDelete(null);
    } catch (caught) {
      const code = errorCode(caught);
      setConfirmingDelete(null);
      if (isSessionError(code)) return;
      setError(code);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <main className="editor-root editor-chrome min-h-screen overflow-y-auto bg-zinc-50 px-6 py-10 text-zinc-950">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">{t("editor.picker.title")}</h1>
            <p className="mt-1 text-sm text-zinc-500">{t("editor.picker.subtitle")}</p>
          </div>
          <Button variant="outline" onClick={() => void router.push("menu")}>
            {t("editor.shell.quit")}
          </Button>
        </header>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {authErrorText(error)}
          </p>
        )}

        <section className="rounded-lg border border-zinc-200 bg-white p-4">
          {adventures === null ? (
            <p role="status" className="text-sm text-zinc-500">
              {t("editor.picker.loading")}
            </p>
          ) : adventures.length === 0 ? (
            <p className="text-sm text-zinc-500">{t("editor.picker.empty")}</p>
          ) : (
            <ul className="grid gap-2">
              {adventures.map((adventure) => (
                <li
                  key={adventure.id}
                  className="flex items-center gap-3 rounded-md border border-zinc-200 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{adventure.title}</p>
                    <p className="flex flex-wrap gap-x-2 text-xs text-zinc-500">
                      <span>{t("editor.picker.maps", { count: adventure.mapCount })}</span>
                      {adventure.author && (
                        <span>{t("editor.picker.author", { author: adventure.author })}</span>
                      )}
                      <span>
                        {adventure.playable
                          ? t("editor.picker.playable")
                          : t("editor.picker.draft")}
                      </span>
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy || deletingId !== null}
                      onClick={() => void openAdventure(adventure.id)}
                    >
                      {t("editor.picker.open")}
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={busy || deletingId !== null}
                      onClick={() => setConfirmingDelete(adventure)}
                    >
                      {t("editor.delete")}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-lg border border-zinc-200 bg-white p-4">
          <h2 className="text-base font-semibold">{t("editor.picker.create.heading")}</h2>
          <form
            className="mt-3 flex items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void createAdventure();
            }}
          >
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Label htmlFor="new-adventure-title">{t("adventure.name")}</Label>
              <Input
                id="new-adventure-title"
                value={title}
                maxLength={48}
                onChange={(event) => setTitle(event.currentTarget.value)}
              />
            </div>
            <Button
              type="submit"
              disabled={busy || deletingId !== null || title.trim().length === 0}
            >
              {t("editor.picker.create.submit")}
            </Button>
          </form>
        </section>
      </div>

      <Dialog
        open={confirmingDelete !== null}
        onOpenChange={(next) => {
          if (!next && deletingId === null) setConfirmingDelete(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("adventure.delete.title", { name: confirmingDelete?.title ?? "" })}
            </DialogTitle>
          </DialogHeader>
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
            <Checkbox id="force-delete-picker-adventure" checked disabled />
            <div className="grid gap-1">
              <Label htmlFor="force-delete-picker-adventure">{t("editor.delete.force")}</Label>
              <p className="text-xs text-muted-foreground">{t("editor.delete.force_warning")}</p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={deletingId !== null}
              onClick={() => setConfirmingDelete(null)}
            >
              {t("adventure.delete.cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={deletingId !== null}
              onClick={() => {
                if (confirmingDelete) void removeAdventure(confirmingDelete);
              }}
            >
              {t("editor.delete.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
