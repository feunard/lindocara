import { useEffect, useState } from "react";
import {
  type AdventureSummary,
  authErrorText,
  createAdventureApi,
  errorCode,
  fetchAdventures,
} from "../../api.js";
import { t, useLocale } from "../../i18n.js";
import type { AdventureEditorSession } from "../../store.js";
import { Button } from "../components/button.js";
import { Input } from "../components/input.js";
import { Label } from "../components/label.js";
import { loadAdventureSession } from "./adventure-session.js";

function isSessionError(code: string): boolean {
  return code === "session_expired" || code === "unauthorized";
}

interface AdventurePickerProps {
  /** An adventure was chosen or created: hand the loaded session to the screen, which mounts the
   *  editor around it. */
  onOpen(session: AdventureEditorSession): void;
  /** Leave the editor entirely (back to the parties screen). */
  onExit(): void;
  onSessionExpired(): void;
}

/**
 * The editor's front door (UX wave #2/#4): opening the editor lands here, never on a bare stage.
 * You must pick an adventure to edit or create one — there is no editor surface without an
 * adventure. Creating one is a single explicit "Create adventure" button (the "save" the user asked
 * for), which POSTs the adventure AND its default map atomically and drops you straight into the
 * editor. Stock shadcn only — this is a creator surface, so the two-tree rule keeps Tiny Swords out.
 */
export function AdventurePicker({ onOpen, onExit, onSessionExpired }: AdventurePickerProps) {
  useLocale();
  const [adventures, setAdventures] = useState<AdventureSummary[] | null>(null);
  const [title, setTitle] = useState("");
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function fail(caught: unknown): void {
    const code = errorCode(caught);
    if (isSessionError(code)) onSessionExpired();
    else setError(code);
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only load; the list refreshes by re-entering the picker
  useEffect(() => {
    void (async () => {
      try {
        setAdventures(await fetchAdventures());
      } catch (caught) {
        fail(caught);
      }
    })();
  }, []);

  async function open(id: string): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      onOpen(await loadAdventureSession(id));
    } catch (caught) {
      fail(caught);
    } finally {
      setBusy(false);
    }
  }

  async function create(): Promise<void> {
    const trimmed = title.trim();
    if (trimmed.length === 0 || busy) return;
    setError(null);
    setBusy(true);
    try {
      const created = await createAdventureApi({ title: trimmed, maxPlayers });
      onOpen(await loadAdventureSession(created.id));
    } catch (caught) {
      fail(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="editor-root flex h-screen flex-col overflow-y-auto bg-zinc-50 text-zinc-950">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-6 py-10">
        <header className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-lg font-semibold">{t("editor.picker.title")}</h1>
            <p className="text-sm text-zinc-500">{t("editor.picker.subtitle")}</p>
          </div>
          <Button variant="outline" size="sm" onClick={onExit}>
            {t("editor.back")}
          </Button>
        </header>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {authErrorText(error)}
          </p>
        )}

        <section className="flex flex-col gap-2" aria-label={t("editor.picker.title")}>
          {adventures === null ? (
            <p className="text-sm text-zinc-500" role="status">
              {t("editor.picker.loading")}
            </p>
          ) : adventures.length === 0 ? (
            <p className="text-sm text-zinc-500">{t("editor.picker.empty")}</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {adventures.map((adventure) => (
                <li
                  key={adventure.id}
                  className="flex items-center gap-3 rounded-md border border-zinc-200 bg-white px-3 py-2"
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
                        {adventure.playable
                          ? t("editor.picker.playable")
                          : t("editor.picker.draft")}
                      </span>
                    </span>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    onClick={() => void open(adventure.id)}
                  >
                    {t("editor.picker.open")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section
          className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4"
          aria-label={t("editor.picker.create.heading")}
        >
          <h2 className="text-sm font-semibold">{t("editor.picker.create.heading")}</h2>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="picker-title">{t("adventure.name")}</Label>
            <Input
              id="picker-title"
              type="text"
              value={title}
              onChange={(event) => setTitle(event.currentTarget.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="picker-players">{t("adventure.players")}</Label>
            <Input
              id="picker-players"
              type="number"
              min={1}
              max={4}
              value={maxPlayers}
              onChange={(event) => setMaxPlayers(Number(event.currentTarget.value))}
            />
          </div>
          <Button
            className="self-start"
            disabled={busy || title.trim().length === 0}
            onClick={() => void create()}
          >
            {t("editor.picker.create.submit")}
          </Button>
        </section>
      </div>
    </div>
  );
}
