import { Button } from "@alepha/ui/components/ui/button";
import {
  type AdventureSummary,
  authErrorText,
  errorCode,
  fetchAdventures,
  fetchMaps,
  isUnauthorizedCode,
  type MapSummary,
} from "@lindocara/client/api.js";
import { t, useLocale } from "@lindocara/client/i18n.js";
import { adventureEditorSessionAtom } from "@lindocara/client/state/atoms.js";
import { useStore } from "alepha/react";
import { useRouter } from "alepha/react/router";
import { useEffect, useRef, useState } from "react";
import { ensureScratchAdventure, loadAdventureSession } from "./adventure-session.js";

interface MapChoice {
  adventure: AdventureSummary;
  map: MapSummary;
}

async function loadMapChoices(): Promise<MapChoice[]> {
  const adventures = await fetchAdventures();
  const mapsByAdventure = await Promise.all(
    adventures.map(async (adventure) => ({
      adventure,
      maps: await fetchMaps(adventure.id),
    })),
  );
  return mapsByAdventure.flatMap(({ adventure, maps }) => maps.map((map) => ({ adventure, map })));
}

/** Explicit creator-tools landing: entering the route reads existing maps but never creates data. */
export function MapPickerScreen() {
  useLocale();
  const router = useRouter();
  const [, setSession] = useStore(adventureEditorSessionAtom);
  const [choices, setChoices] = useState<MapChoice[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadRef = useRef<Promise<MapChoice[]> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const request = loadRef.current ?? loadMapChoices();
    loadRef.current = request;
    void request
      .then((loaded) => {
        if (!cancelled) setChoices(loaded);
      })
      .catch((caught) => {
        if (cancelled) return;
        const code = errorCode(caught);
        if (isUnauthorizedCode(code)) return;
        setChoices([]);
        setError(code);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function openMap(choice: MapChoice): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setSession(await loadAdventureSession(choice.adventure.id, choice.map.id));
    } catch (caught) {
      const code = errorCode(caught);
      if (!isUnauthorizedCode(code)) setError(code);
    } finally {
      setBusy(false);
    }
  }

  async function createMap(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setSession(await ensureScratchAdventure());
    } catch (caught) {
      const code = errorCode(caught);
      if (!isUnauthorizedCode(code)) setError(code);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="editor-root editor-chrome min-h-screen overflow-y-auto bg-zinc-50 px-6 py-10 text-zinc-950">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">{t("editor.picker.title")}</h1>
            <p className="mt-1 text-sm text-zinc-500">{t("editor.picker.subtitle")}</p>
          </div>
          <Button variant="outline" onClick={() => void router.push("menu")}>
            {t("editor.shell.quit")}
          </Button>
        </header>

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {authErrorText(error)}
          </p>
        ) : null}

        <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold">{t("editor.picker.existing")}</h2>
              <p className="mt-0.5 text-xs text-zinc-500">{t("editor.picker.existingHint")}</p>
            </div>
            <Button disabled={busy} onClick={() => void createMap()}>
              {t("editor.picker.create")}
            </Button>
          </div>

          {choices === null ? (
            <p role="status" className="text-sm text-zinc-500">
              {t("editor.picker.loading")}
            </p>
          ) : choices.length === 0 ? (
            <div className="rounded-md border border-dashed border-zinc-300 px-4 py-8 text-center">
              <p className="text-sm font-medium">{t("editor.picker.empty")}</p>
              <p className="mt-1 text-xs text-zinc-500">{t("editor.picker.emptyHint")}</p>
            </div>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {choices.map((choice) => (
                <li key={choice.map.id}>
                  <button
                    type="button"
                    className="group flex h-full w-full flex-col rounded-md border border-zinc-200 bg-zinc-50 p-4 text-left transition hover:border-zinc-400 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-700 disabled:cursor-wait disabled:opacity-60"
                    disabled={busy}
                    onClick={() => void openMap(choice)}
                  >
                    <span className="text-sm font-semibold text-zinc-900 group-hover:text-zinc-950">
                      {choice.map.name}
                    </span>
                    <span className="mt-1 truncate text-xs text-zinc-500">
                      {choice.adventure.title}
                    </span>
                    <span className="mt-3 text-[11px] tabular-nums text-zinc-400">
                      {t("editor.shell.maps.dims", {
                        cols: choice.map.cols,
                        rows: choice.map.rows,
                      })}
                    </span>
                    <span className="mt-4 text-xs font-medium text-zinc-700">
                      {t("editor.picker.open")}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
