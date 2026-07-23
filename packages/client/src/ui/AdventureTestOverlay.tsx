import { Badge } from "@lindocara/ui/components/badge.js";
import { Button } from "@lindocara/ui/components/button.js";
import { useEffect, useState } from "react";
import {
  ApiError,
  authErrorText,
  createAdventureTestSessionApi,
  deleteAdventureTestSessionApi,
  errorCode,
} from "../api.js";
import { startGameAsHero, stopActiveGameSession } from "../game/session.js";
import { t, useLocale } from "../i18n.js";
import { useUiStore } from "../store.js";

/**
 * Creator controls that sit over the real game runtime. The session itself is a disposable D1
 * party, so these buttons never simulate progress client-side: reset creates another authoritative
 * session and return deletes the current one.
 */
export function AdventureTestOverlay() {
  useLocale();
  const session = useUiStore((state) => state.adventureTestSession);
  const editorSession = useUiStore((state) => state.adventureEditorSession);
  const setTestSession = useUiStore((state) => state.setAdventureTestSession);
  const setActiveParty = useUiStore((state) => state.setActiveParty);
  const setScreen = useUiStore((state) => state.setScreen);
  const [busy, setBusy] = useState<"reset" | "exit" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    const sessionId = session.id;
    const cleanup = (): void => {
      // Best effort for tab close/reload. The server TTL remains the backstop if the browser drops
      // the request, and this endpoint can delete only the signed-in creator's own test envelope.
      void fetch(`/api/adventure-test-sessions/${sessionId}`, {
        method: "DELETE",
        keepalive: true,
      });
    };
    window.addEventListener("pagehide", cleanup);
    return () => window.removeEventListener("pagehide", cleanup);
  }, [session]);

  if (!session) return null;

  const startName =
    session.startMapId === null
      ? t("editor.test.start.adventure")
      : (editorSession?.draft.members.find((member) => member.mapId === session.startMapId)?.name ??
        t("editor.test.start.mapFallback"));

  async function reset(): Promise<void> {
    if (!session || busy) return;
    setBusy("reset");
    setError(null);
    try {
      const replacement = await createAdventureTestSessionApi(session.adventureId, {
        startMapId: session.startMapId,
        heroClass: session.hero.class,
      });
      setTestSession(replacement);
      await startGameAsHero(replacement.hero, replacement.party);
    } catch (caught) {
      setError(authErrorText(errorCode(caught)));
    } finally {
      setBusy(null);
    }
  }

  async function exit(): Promise<void> {
    if (!session || busy) return;
    setBusy("exit");
    setError(null);
    try {
      await deleteAdventureTestSessionApi(session.id);
    } catch (caught) {
      // Expiration already achieved the desired deletion; every other failure stays visible and
      // leaves the creator in the test rather than falsely promising a clean return.
      if (!(caught instanceof ApiError) || caught.code !== "adventure_test_not_found") {
        setError(authErrorText(errorCode(caught)));
        setBusy(null);
        return;
      }
    }
    stopActiveGameSession();
    setTestSession(null);
    setActiveParty(null);
    setScreen("adventure-editor");
  }

  return (
    <aside className="fixed inset-x-0 top-3 z-[90] flex justify-center px-3 pointer-events-none">
      <div className="pointer-events-auto flex max-w-[calc(100vw-1.5rem)] flex-wrap items-center gap-2 rounded-lg border border-amber-300/60 bg-zinc-950/95 p-2 text-zinc-50 shadow-2xl backdrop-blur">
        <Badge className="bg-amber-400 text-zinc-950 hover:bg-amber-400">
          {t("editor.test.overlay.badge")}
        </Badge>
        <div className="min-w-0 px-1 text-xs leading-tight">
          <strong className="block truncate">{t("editor.test.overlay.title")}</strong>
          <span className="text-zinc-300">
            {t("editor.test.overlay.start", { name: startName })}
          </span>
        </div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={busy !== null}
          onClick={() => void reset()}
        >
          {busy === "reset" ? t("editor.test.resetting") : t("editor.test.reset")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy !== null}
          onClick={() => void exit()}
        >
          {busy === "exit" ? t("editor.test.exiting") : t("editor.test.exit")}
        </Button>
        {error && (
          <p className="basis-full px-1 text-xs text-red-300" role="alert">
            {error}
          </p>
        )}
      </div>
    </aside>
  );
}
