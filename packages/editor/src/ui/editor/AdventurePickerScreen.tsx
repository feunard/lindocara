import {
  type AdventureSummary,
  authErrorText,
  createAdventureApi,
  errorCode,
  fetchAllAdventures,
} from "@lindocara/client/api.js";
import { t, useLocale } from "@lindocara/client/i18n.js";
import { useUiStore } from "@lindocara/client/store.js";
import { Button } from "@lindocara/ui/components/button.js";
import { Input } from "@lindocara/ui/components/input.js";
import { Label } from "@lindocara/ui/components/label.js";
import { useEffect, useState } from "react";
import { loadAdventureSession } from "./adventure-session.js";

function isSessionError(code: string): boolean {
  return code === "session_expired" || code === "unauthorized";
}

/** Explicit landing page for creator tools: entering the editor never silently picks or creates data. */
export function AdventurePickerScreen() {
  useLocale();
  const setScreen = useUiStore((state) => state.setScreen);
  const setSession = useUiStore((state) => state.setAdventureEditorSession);
  const [adventures, setAdventures] = useState<AdventureSummary[] | null>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
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
        if (isSessionError(code)) setScreen("auth");
        else {
          setAdventures([]);
          setError(code);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setScreen]);

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
      if (isSessionError(code)) setScreen("auth");
      else setError(code);
      setBusy(false);
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
      if (isSessionError(code)) setScreen("auth");
      else setError(code);
      setBusy(false);
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
          <Button variant="outline" onClick={() => setScreen("menu")}>
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
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => void openAdventure(adventure.id)}
                  >
                    {t("editor.picker.open")}
                  </Button>
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
            <Button type="submit" disabled={busy || title.trim().length === 0}>
              {t("editor.picker.create.submit")}
            </Button>
          </form>
        </section>
      </div>
    </main>
  );
}
