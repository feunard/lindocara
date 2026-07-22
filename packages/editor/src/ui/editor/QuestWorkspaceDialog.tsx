import type { AdventureDraft } from "@lindocara/client/adventure-draft.js";
import { toAdventureInput } from "@lindocara/client/adventure-draft.js";
import {
  authErrorText,
  errorCode,
  fetchMap,
  fetchMaps,
  updateAdventureApi,
} from "@lindocara/client/api.js";
import { t, useLocale } from "@lindocara/client/i18n.js";
import { useUiStore } from "@lindocara/client/store.js";
import { mintRegistryId } from "@lindocara/engine/adventure-state.js";
import {
  type AuthoredQuestDefinition,
  createAuthoredQuestDefinition,
  MAX_AUTHORED_QUESTS,
  type QuestDiagnostic,
  reconcileAuthoredQuestVersions,
  validateAuthoredQuests,
} from "@lindocara/engine/quests.js";
import { Badge } from "@lindocara/ui/components/badge.js";
import { Button } from "@lindocara/ui/components/button.js";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@lindocara/ui/components/dialog.js";
import { Input } from "@lindocara/ui/components/input.js";
import { Copy, LoaderCircle, Plus, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { QuestDefinitionEditor } from "./QuestDefinitionEditor.js";
import {
  duplicateAuthoredQuest,
  type QuestMapCatalog,
  questValidationContext,
} from "./quest-editor-model.js";

interface QuestWorkspaceDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  onSessionExpired(): void;
  /** Current in-memory map, including unsaved event edits. It replaces that map's stored payload in
   * the reference catalogue so a just-created NPC can immediately become a giver. */
  currentMap: QuestMapCatalog | null;
  /** When the stage is ready, map + adventure registry are committed in the editor's existing
   * revision-fenced transaction. Without a live map, the adventure shell can still be saved alone. */
  onSaveDraft?(draft: AdventureDraft): Promise<AdventureDraft | null>;
}

function isSessionError(code: string): boolean {
  return code === "session_expired" || code === "unauthorized";
}

function questSearchText(quest: AuthoredQuestDefinition): string {
  return `${quest.title} ${quest.description} ${quest.journalSummary}`.toLocaleLowerCase();
}

function questDiagnostics(
  diagnostics: readonly QuestDiagnostic[],
  questId: string,
): QuestDiagnostic[] {
  return diagnostics.filter((diagnostic) => diagnostic.questId === questId);
}

export function QuestWorkspaceDialog({
  open,
  onOpenChange,
  onSessionExpired,
  currentMap,
  onSaveDraft,
}: QuestWorkspaceDialogProps) {
  useLocale();
  const session = useUiStore((state) => state.adventureEditorSession);
  const setSession = useUiStore((state) => state.setAdventureEditorSession);
  const [quests, setQuests] = useState<readonly AuthoredQuestDefinition[]>([]);
  const [baseline, setBaseline] = useState("[]");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [maps, setMaps] = useState<readonly QuestMapCatalog[] | null>(null);
  const [loadingMaps, setLoadingMaps] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const savingRef = useRef(false);

  const registry = session?.draft.registry;
  const dirty = JSON.stringify(quests) !== baseline;
  const context = useMemo(
    () => (registry && maps ? questValidationContext(registry, maps) : {}),
    [registry, maps],
  );
  const diagnostics = useMemo(() => validateAuthoredQuests(quests, context), [quests, context]);
  const errorCount = diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
  const warningCount = diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length;
  const selectedQuest = quests.find((quest) => quest.id === selectedId) ?? null;
  const filteredQuests = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return query === "" ? quests : quests.filter((quest) => questSearchText(quest).includes(query));
  }, [quests, search]);

  // Opening is a fresh editing transaction. The current map is intentionally sampled once here:
  // all changes made before opening are captured, while edits inside this modal cannot also mutate
  // the Pixi stage because its pointer/focus surface is covered.
  // biome-ignore lint/correctness/useExhaustiveDependencies: initialize once per open/adventure
  useEffect(() => {
    if (!open || !session?.adventureId) return;
    const adventureId = session.adventureId;
    const initial = session.draft.registry.quests ?? [];
    setQuests(initial);
    setBaseline(JSON.stringify(initial));
    setSelectedId(initial[0]?.id ?? null);
    setSearch("");
    setError(null);
    setConfirmDeleteId(null);
    setMaps(null);
    setLoadingMaps(true);
    let cancelled = false;
    void (async () => {
      try {
        const summaries = await fetchMaps(adventureId);
        const loaded = await Promise.all(
          summaries.map(async (summary): Promise<QuestMapCatalog> => {
            if (currentMap?.mapId === summary.id) return currentMap;
            const payload = await fetchMap(summary.id);
            return {
              mapId: payload.id,
              name: payload.name,
              cols: payload.cols,
              rows: payload.rows,
              events: payload.events,
            };
          }),
        );
        if (!cancelled) setMaps(loaded);
      } catch (caught) {
        if (cancelled) return;
        const code = errorCode(caught);
        if (isSessionError(code)) onSessionExpired();
        else setError(code);
      } finally {
        if (!cancelled) setLoadingMaps(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, session?.adventureId]);

  function requestClose(): void {
    if (savingRef.current) return;
    if (dirty && !window.confirm(t("editor.quest.closeConfirm"))) return;
    onOpenChange(false);
  }

  function updateQuest(updated: AuthoredQuestDefinition): void {
    setQuests((current) => current.map((quest) => (quest.id === updated.id ? updated : quest)));
  }

  function createQuest(): void {
    if (quests.length >= MAX_AUTHORED_QUESTS) return;
    const id = mintRegistryId(quests);
    if (!id) return;
    const created = createAuthoredQuestDefinition(id, t("editor.quest.newTitle"));
    setQuests((current) => [...current, created]);
    setSelectedId(id);
    setSearch("");
  }

  function duplicateQuest(): void {
    if (!selectedQuest || quests.length >= MAX_AUTHORED_QUESTS) return;
    const id = mintRegistryId(quests);
    if (!id) return;
    const duplicate = duplicateAuthoredQuest(
      selectedQuest,
      id,
      t("editor.quest.copyTitle", { title: selectedQuest.title || t("editor.quest.untitled") }),
    );
    setQuests((current) => [...current, duplicate]);
    setSelectedId(id);
    setSearch("");
  }

  function deleteQuest(id: string): void {
    setQuests((current) => current.filter((quest) => quest.id !== id));
    setSelectedId((current) => {
      if (current !== id) return current;
      return quests.find((quest) => quest.id !== id)?.id ?? null;
    });
    setConfirmDeleteId(null);
  }

  function fail(caught: unknown): void {
    const code = errorCode(caught);
    if (isSessionError(code)) onSessionExpired();
    else setError(code);
  }

  async function save(): Promise<void> {
    if (!session?.adventureId || !registry || savingRef.current) return;
    const versioned = reconcileAuthoredQuestVersions(registry.quests ?? [], quests);
    const nextDraft: AdventureDraft = {
      ...session.draft,
      registry: { ...registry, quests: versioned },
    };
    const input = toAdventureInput(nextDraft);
    if (!input) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      if (onSaveDraft) {
        const saved = await onSaveDraft(nextDraft);
        if (!saved) {
          setError("generic");
          return;
        }
      } else {
        const payload = await updateAdventureApi(session.adventureId, input);
        const savedDraft = { ...nextDraft, registry: payload.registry };
        const latest = useUiStore.getState().adventureEditorSession;
        if (latest) {
          setSession({
            ...latest,
            draft: savedDraft,
            savedDraft: JSON.stringify(savedDraft),
          });
        }
      }
      setQuests(versioned);
      setBaseline(JSON.stringify(versioned));
      onOpenChange(false);
    } catch (caught) {
      fail(caught);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  const canSave = session !== null && toAdventureInput(session.draft) !== null && !saving;
  const deletingQuest = quests.find((quest) => quest.id === confirmDeleteId) ?? null;

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : requestClose())}>
      <DialogContent className="flex h-[92vh] max-h-[92vh] w-[96vw] max-w-[96vw] flex-col gap-0 overflow-hidden p-0 sm:max-w-[96vw]">
        <DialogHeader className="border-b border-border px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3 pr-8">
            <div>
              <DialogTitle>{t("editor.quest.workspace.title")}</DialogTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("editor.quest.workspace.subtitle")}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {errorCount === 0 ? (
                <Badge variant="secondary">{t("editor.quest.validation.valid")}</Badge>
              ) : (
                <Badge variant="destructive">
                  {t("editor.quest.validation.errorCount", { count: errorCount })}
                </Badge>
              )}
              {warningCount > 0 && (
                <Badge variant="outline">
                  {t("editor.quest.validation.warningCount", { count: warningCount })}
                </Badge>
              )}
            </div>
          </div>
        </DialogHeader>

        {error && (
          <p
            role="alert"
            className="border-b border-red-200 bg-red-50 px-5 py-2 text-sm text-red-800"
          >
            {authErrorText(error)}
          </p>
        )}

        <div className="grid min-h-0 flex-1 grid-cols-[18rem_minmax(0,1fr)]">
          <aside className="flex min-h-0 flex-col border-r border-border bg-muted/20">
            <div className="flex flex-col gap-3 border-b border-border p-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-8"
                  type="search"
                  value={search}
                  aria-label={t("editor.quest.search")}
                  placeholder={t("editor.quest.search")}
                  onChange={(event) => setSearch(event.currentTarget.value)}
                />
              </div>
              <Button
                type="button"
                size="sm"
                onClick={createQuest}
                disabled={quests.length >= MAX_AUTHORED_QUESTS}
              >
                <Plus />
                {t("editor.quest.add")}
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {filteredQuests.length === 0 ? (
                <p className="p-4 text-center text-sm text-muted-foreground">
                  {quests.length === 0 ? t("editor.quest.empty") : t("editor.quest.searchEmpty")}
                </p>
              ) : (
                <div className="flex flex-col gap-1">
                  {filteredQuests.map((quest) => {
                    const ownDiagnostics = questDiagnostics(diagnostics, quest.id);
                    const ownErrors = ownDiagnostics.filter(
                      (diagnostic) => diagnostic.severity === "error",
                    ).length;
                    return (
                      <button
                        key={quest.id}
                        type="button"
                        className={`flex w-full items-start gap-2 rounded-md border px-3 py-2 text-left transition-colors ${
                          selectedId === quest.id
                            ? "border-zinc-400 bg-background shadow-sm"
                            : "border-transparent hover:bg-background/70"
                        }`}
                        onClick={() => setSelectedId(quest.id)}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            {quest.title || t("editor.quest.untitled")}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {quest.objectives.length === 0
                              ? t("editor.quest.noObjectives")
                              : t("editor.quest.objectiveCount", {
                                  count: quest.objectives.length,
                                })}
                          </span>
                        </span>
                        {ownErrors > 0 ? (
                          <Badge variant="destructive">{ownErrors}</Badge>
                        ) : (
                          <Badge variant="secondary">{t("editor.quest.validShort")}</Badge>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="flex gap-2 border-t border-border p-3">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="flex-1"
                disabled={!selectedQuest || quests.length >= MAX_AUTHORED_QUESTS}
                onClick={duplicateQuest}
              >
                <Copy />
                {t("editor.quest.duplicate")}
              </Button>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                className="text-destructive"
                disabled={!selectedQuest}
                aria-label={t("editor.quest.delete")}
                onClick={() => setConfirmDeleteId(selectedQuest?.id ?? null)}
              >
                <Trash2 />
              </Button>
            </div>
          </aside>

          <main className="flex min-h-0 min-w-0 flex-col">
            {loadingMaps ? (
              <div
                className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground"
                role="status"
              >
                <LoaderCircle className="size-4 animate-spin" />
                {t("editor.quest.loadingReferences")}
              </div>
            ) : selectedQuest && registry ? (
              <QuestDefinitionEditor
                key={selectedQuest.id}
                quest={selectedQuest}
                quests={quests}
                registry={registry}
                maps={maps ?? []}
                diagnostics={questDiagnostics(diagnostics, selectedQuest.id)}
                onChange={updateQuest}
              />
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
                <p className="max-w-md text-sm text-muted-foreground">
                  {t("editor.quest.workspace.emptySelection")}
                </p>
                {quests.length === 0 && (
                  <Button type="button" size="sm" onClick={createQuest}>
                    <Plus />
                    {t("editor.quest.add")}
                  </Button>
                )}
              </div>
            )}
          </main>
        </div>

        <DialogFooter className="border-t border-border px-5 py-3">
          <div className="flex w-full flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {dirty ? t("editor.quest.unsaved") : t("editor.quest.saved")}
            </p>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" onClick={requestClose} disabled={saving}>
                {t("editor.event.cancel")}
              </Button>
              <Button type="button" onClick={() => void save()} disabled={!canSave}>
                {saving ? t("editor.shell.saving") : t("editor.quest.save")}
              </Button>
            </div>
          </div>
        </DialogFooter>

        <Dialog
          open={confirmDeleteId !== null}
          onOpenChange={(next) => !next && setConfirmDeleteId(null)}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {t("editor.quest.deleteConfirm.title", {
                  title: deletingQuest?.title || t("editor.quest.untitled"),
                })}
              </DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">{t("editor.quest.deleteConfirm.body")}</p>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setConfirmDeleteId(null)}>
                {t("editor.event.cancel")}
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => deletingQuest && deleteQuest(deletingQuest.id)}
              >
                {t("editor.quest.delete")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}
