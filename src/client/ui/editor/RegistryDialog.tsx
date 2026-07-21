import { useEffect, useState } from "react";
import {
  type AdventureRegistry,
  MAX_REGISTRY_SWITCHES,
  MAX_REGISTRY_VARIABLES,
  mintRegistryId,
  REGISTRY_ENTRY_NAME_MAX,
  type RegistryEntry,
} from "../../../shared/adventure-state.js";
import { draftFromAdventure, toAdventureInput } from "../../adventure-draft.js";
import {
  type AdventureSummary,
  authErrorText,
  errorCode,
  fetchAdventure,
  fetchAdventures,
  updateAdventureApi,
} from "../../api.js";
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
import { QuestRegistryEditor } from "./QuestRegistryEditor.js";

function isSessionError(code: string): boolean {
  return code === "session_expired" || code === "unauthorized";
}

/** The two registry kinds share every list operation — which array of the registry they touch is the
 *  only difference — so the dialog keys its handlers on this. */
type RegistryKind = "switches" | "variables";

const KIND_MAX: Record<RegistryKind, number> = {
  switches: MAX_REGISTRY_SWITCHES,
  variables: MAX_REGISTRY_VARIABLES,
};

interface RegistryDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  onSessionExpired(): void;
}

/**
 * The adventure "database": two dense lists of switches and variables that ride the adventure row.
 * Reached from the menu's Jeu → « Base de données… », it edits the same `adventureEditorSession`
 * draft the settings dialog uses — so its `registry` is carried by that draft — and persists through
 * the adventure PUT (`updateAdventureApi`, whose body now includes the registry). With no session it
 * first lists the account's adventures to load one; ids are minted `0001`-monotonic and never reused.
 *
 * A registry id is identity: an event page references it by string, so deleting an entry is allowed
 * (`activePageIndex` reads any orphaned id as off/0 — the fail-closed default) but the confirm says
 * so. Stock shadcn / native controls, no Tiny Swords chrome — this is a creator surface.
 */
export function RegistryDialog({ open, onOpenChange, onSessionExpired }: RegistryDialogProps) {
  useLocale();
  const session = useUiStore((state) => state.adventureEditorSession);
  const setSession = useUiStore((state) => state.setAdventureEditorSession);

  const [adventures, setAdventures] = useState<AdventureSummary[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [registry, setRegistry] = useState<AdventureRegistry | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<{
    kind: RegistryKind;
    entry: RegistryEntry;
  } | null>(null);

  useEffect(() => {
    if (!open) return;
    setRegistry(session?.draft.registry ?? null);
    setError(null);
  }, [open, session?.draft.registry]);

  function fail(caught: unknown): void {
    const code = errorCode(caught);
    if (isSessionError(code)) onSessionExpired();
    else setError(code);
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload the picker each time it opens
  useEffect(() => {
    if (!open || session) return;
    setError(null);
    void (async () => {
      try {
        setAdventures(await fetchAdventures());
      } catch (caught) {
        fail(caught);
      }
    })();
  }, [open, session]);

  async function openExisting(id: string): Promise<void> {
    setError(null);
    try {
      const payload = await fetchAdventure(id);
      // Registry editing does not need member map thumbnails, so an empty infos map is enough: the
      // draft carries the shell + registry, and Save is gated only on a valid title/player count.
      const draft = draftFromAdventure(payload, new Map());
      setSession({
        adventureId: id,
        draftId: crypto.randomUUID(),
        draft,
        invalidatedLinks: [],
        savedDraft: JSON.stringify(draft),
      });
    } catch (caught) {
      fail(caught);
    }
  }

  function updateRegistry(next: AdventureRegistry): void {
    setRegistry(next);
  }

  function addEntry(kind: RegistryKind): void {
    if (!registry) return;
    const list = registry[kind];
    if (list.length >= KIND_MAX[kind]) return;
    const id = mintRegistryId(list);
    if (id === null) return;
    updateRegistry({ ...registry, [kind]: [...list, { id, name: "" }] });
  }

  function renameEntry(kind: RegistryKind, id: string, name: string): void {
    if (!registry) return;
    const list = registry[kind].map((entry) => (entry.id === id ? { ...entry, name } : entry));
    updateRegistry({ ...registry, [kind]: list });
  }

  function deleteEntry(kind: RegistryKind, id: string): void {
    if (!registry) return;
    const list = registry[kind].filter((entry) => entry.id !== id);
    updateRegistry({ ...registry, [kind]: list });
    setConfirmingDelete(null);
  }

  async function save(): Promise<void> {
    if (!session?.adventureId || !registry || saving) return;
    const savedDraft = { ...session.draft, registry };
    const input = toAdventureInput(savedDraft);
    if (!input) return;
    setSaving(true);
    setError(null);
    try {
      await updateAdventureApi(session.adventureId, input);
      // Keep the adventure loaded so the event dialog's condition pickers reflect the saved
      // registry, refresh the saved snapshot, then close like a conventional Save action.
      setSession({ ...session, draft: savedDraft, savedDraft: JSON.stringify(savedDraft) });
      onOpenChange(false);
    } catch (caught) {
      fail(caught);
    } finally {
      setSaving(false);
    }
  }

  const input =
    session?.adventureId && registry ? toAdventureInput({ ...session.draft, registry }) : null;
  const saveHint =
    session === null || session.adventureId !== null
      ? input === null && session?.adventureId
        ? t("editor.registry.incomplete")
        : null
      : t("editor.registry.new.hint");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("editor.registry.title")}</DialogTitle>
        </DialogHeader>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {authErrorText(error)}
          </p>
        )}

        {session && registry ? (
          <div className="flex flex-col gap-5">
            <RegistryList
              kind="switches"
              heading={t("editor.registry.switches")}
              entries={registry.switches}
              atCap={registry.switches.length >= MAX_REGISTRY_SWITCHES}
              onAdd={() => addEntry("switches")}
              onRename={(id, name) => renameEntry("switches", id, name)}
              onDelete={(entry) => setConfirmingDelete({ kind: "switches", entry })}
            />
            <QuestRegistryEditor
              quests={registry.quests ?? []}
              onChange={(quests) => updateRegistry({ ...registry, quests })}
            />
            <RegistryList
              kind="variables"
              heading={t("editor.registry.variables")}
              entries={registry.variables}
              atCap={registry.variables.length >= MAX_REGISTRY_VARIABLES}
              onAdd={() => addEntry("variables")}
              onRename={(id, name) => renameEntry("variables", id, name)}
              onDelete={(entry) => setConfirmingDelete({ kind: "variables", entry })}
            />

            <div className="flex items-center justify-between gap-2">
              {/* Close the dialog (Escape/× semantics) — never `setSession(null)`, which with the
                  picker gone (UX wave #15) would unload the whole editor out from under the author. */}
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t("editor.back")}
              </Button>
              <div className="flex items-center gap-3">
                {saveHint && <span className="text-xs text-muted-foreground">{saveHint}</span>}
                <Button disabled={input === null || saving} onClick={() => void save()}>
                  {t("editor.registry.save")}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
              {t("editor.registry.pick")}
            </p>
            {adventures && adventures.length === 0 && (
              <p className="text-sm text-muted-foreground">{t("editor.shell.settings.empty")}</p>
            )}
            <div className="flex flex-col gap-1">
              {adventures?.map((adventure) => (
                <div
                  key={adventure.id}
                  className="flex items-center gap-2 rounded-md border border-zinc-200 px-2 py-1.5"
                >
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {adventure.title}
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void openExisting(adventure.id)}
                  >
                    {t("adventure.edit")}
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        <Dialog open={confirmingDelete !== null} onOpenChange={() => setConfirmingDelete(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {t("editor.registry.delete.confirm.title", {
                  id: confirmingDelete?.entry.id ?? "",
                  name: confirmingDelete?.entry.name ?? "",
                })}
              </DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              {t("editor.registry.delete.confirm.body")}
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmingDelete(null)}>
                {t("editor.event.cancel")}
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  if (confirmingDelete)
                    deleteEntry(confirmingDelete.kind, confirmingDelete.entry.id);
                }}
              >
                {t("editor.registry.delete")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}

function RegistryList({
  kind,
  heading,
  entries,
  atCap,
  onAdd,
  onRename,
  onDelete,
}: {
  kind: RegistryKind;
  heading: string;
  entries: readonly RegistryEntry[];
  atCap: boolean;
  onAdd(): void;
  onRename(id: string, name: string): void;
  onDelete(entry: RegistryEntry): void;
}) {
  useLocale();
  return (
    <section className="flex flex-col gap-2" aria-label={heading}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{heading}</h3>
        <Button
          size="sm"
          variant="secondary"
          disabled={atCap}
          onClick={onAdd}
          aria-label={`${t("editor.registry.add")} ${heading}`}
        >
          {t("editor.registry.add")}
        </Button>
      </div>
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("editor.registry.empty")}</p>
      ) : (
        <div className="flex flex-col gap-1">
          {entries.map((entry) => (
            <div
              key={`${kind}:${entry.id}`}
              className="flex items-center gap-2 rounded-md border border-zinc-200 px-2 py-1"
            >
              <code className="flex-none text-xs tabular-nums text-zinc-500">{entry.id}</code>
              <span className="flex-none text-xs text-zinc-400">·</span>
              <Input
                aria-label={`${t("editor.registry.name.aria")} ${entry.id}`}
                className="h-7 flex-1 text-xs"
                maxLength={REGISTRY_ENTRY_NAME_MAX}
                value={entry.name}
                onChange={(event) => onRename(entry.id, event.currentTarget.value)}
              />
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-destructive"
                aria-label={`${t("editor.registry.delete")} ${entry.id}`}
                onClick={() => onDelete(entry)}
              >
                {t("editor.registry.delete")}
              </Button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
