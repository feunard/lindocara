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
import { Tooltip, TooltipContent, TooltipTrigger } from "@alepha/ui/components/ui/tooltip";
import {
  createMapApi,
  deleteMapApi,
  errorCode,
  fetchMap,
  fetchMaps,
  isUnauthorizedCode,
  type MapPayload,
  type MapSaveInput,
  type MapSummary,
  updateMapApi,
} from "@lindocara/client/api.js";
import { t, useLocale } from "@lindocara/client/i18n.js";
import { MAX_ADVENTURE_MAPS } from "@lindocara/engine/adventure.js";
import { MAP_MIN_COLS, MAP_MIN_ROWS } from "@lindocara/engine/map-limits.js";
import { nextMapName } from "@lindocara/engine/map-naming.js";
import { Music2, Pencil, Plus, Settings2, SlidersHorizontal, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/** A stored payload made into the create/update body: everything but the server-minted id/revision. */
function saveInputFromPayload(payload: MapPayload): MapSaveInput {
  const { heightfield, id: _id, revision: _revision, ...rest } = payload;
  return { ...rest, ...(heightfield === null ? {} : { heightfield }) };
}

interface MapListPanelProps {
  /** The adventure whose maps this panel lists and creates into. A map belongs to exactly one
   *  adventure, so creation is per-adventure; `null` means the session is an unsaved sandbox —
   *  nothing to list from the server, and creation is disabled until the first save. */
  adventureId: string | null;
  /** The unsaved sandbox's one map, listed in place of the server list while `adventureId` is null.
   *  An empty panel beside a map the author is actively painting reads as a broken list; this shows
   *  the real thing, minus the rename/delete actions, which need a stored row to act on. */
  sandboxMap?: { id: string; name: string; cols: number; rows: number } | undefined;
  /** The map currently mounted in the stage, so the panel marks it and knows what "delete the open
   *  map" targets. */
  activeMapId: string | null;
  /** Whether the open map has unsaved stage edits, so renaming it in place can guard them: rename
   *  persists the *stored* payload and re-mounts, which would otherwise drop those edits silently. */
  dirty: boolean;
  /** A whole-map save is in flight. Map mutations/navigation stay inert until its revision lands. */
  locked: boolean;
  /** Bumped by the screen whenever a save/create lands, so the panel refetches names and dims. */
  refreshNonce: number;
  /** New-map dialog open state, lifted so the menu bar and toolbar can open it too. */
  newMapOpen: boolean;
  onNewMapOpenChange(open: boolean): void;
  /** Delete-confirm target, lifted so the menu/toolbar "Delete map" can target the open map. */
  confirmDeleteId: string | null;
  onConfirmDeleteIdChange(id: string | null): void;
  /** Switch the stage to this map through the screen's load path (its dirty guard included). */
  onRequestOpen(id: string): void;
  /** A freshly created (or renamed-in-place) map to mount in the stage. */
  onOpenPayload(payload: MapPayload): void;
  /** The open map was deleted: the screen decides what to show next. */
  onActiveDeleted(): void;
  onOpenMapAudio(): void;
  onOpenHeroSettings?(): void;
  onOpenSettings(): void;
  onError(code: string): void;
}

/**
 * The wireframe's right pane: the author's maps as a wireframe list (name + `cols×rows` badge),
 * selecting one to switch the stage through the screen's load path, plus new-map creation, rename,
 * delete-with-confirm and the entry to the adventure settings dialog. Stock shadcn + lucide only —
 * the two-tree rule is absolute for creator surfaces.
 *
 * It owns the map-library API calls (create/delete/rename) the Task 7 shell only stubbed; the screen
 * owns the stage load path and the dirty guard, so switching maps always goes through it.
 */
export function MapListPanel({
  adventureId,
  sandboxMap,
  activeMapId,
  dirty,
  locked,
  refreshNonce,
  newMapOpen,
  onNewMapOpenChange,
  confirmDeleteId,
  onConfirmDeleteIdChange,
  onRequestOpen,
  onOpenPayload,
  onActiveDeleted,
  onOpenMapAudio,
  onOpenHeroSettings,
  onOpenSettings,
  onError,
}: MapListPanelProps) {
  useLocale();
  const [maps, setMaps] = useState<MapSummary[]>([]);
  const [renaming, setRenaming] = useState<MapSummary | null>(null);
  const [newName, setNewName] = useState("");
  const [renameValue, setRenameValue] = useState("");
  const [busy, setBusy] = useState(false);
  const refreshGenerationRef = useRef(0);

  function fail(caught: unknown): void {
    const code = errorCode(caught);
    if (isUnauthorizedCode(code)) return;
    onError(code);
  }

  async function refresh(): Promise<void> {
    const generation = ++refreshGenerationRef.current;
    // A map belongs to exactly one adventure: with no adventure loaded there is nothing to list, and
    // `/api/maps` requires the `adventure` param. Show an empty list and skip the fetch.
    if (!adventureId) {
      if (generation === refreshGenerationRef.current) setMaps([]);
      return;
    }
    try {
      const loaded = await fetchMaps(adventureId);
      if (generation === refreshGenerationRef.current) setMaps(loaded);
    } catch (caught) {
      if (generation === refreshGenerationRef.current) fail(caught);
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: refetch names/dims when the screen bumps the nonce or the adventure changes
  useEffect(() => {
    void refresh();
  }, [refreshNonce, adventureId]);

  // UX wave #16: a new map defaults to the lowest free `MapN` — never the adventure title. Prefill the
  // dialog's name field each time it opens (the author can still rename before creating). Computed
  // from the loaded list, so the server stays dumb and simply stores the name it is handed.
  // biome-ignore lint/correctness/useExhaustiveDependencies: seed the default only on the open transition, not on every list churn
  useEffect(() => {
    if (newMapOpen) {
      setNewName(nextMapName(maps.map((map) => map.name)));
    }
  }, [newMapOpen]);

  async function create(): Promise<void> {
    if (!adventureId || maps.length >= MAX_ADVENTURE_MAPS || busy || locked) return;
    onError("");
    setBusy(true);
    try {
      const created = await createMapApi(adventureId, newName.trim(), MAP_MIN_COLS, MAP_MIN_ROWS);
      onNewMapOpenChange(false);
      setNewName("");
      await refresh();
      onOpenPayload(created);
    } catch (caught) {
      fail(caught);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string): Promise<void> {
    if (busy || locked) return;
    setBusy(true);
    try {
      await deleteMapApi(id, true);
      onConfirmDeleteIdChange(null);
      await refresh();
      if (id === activeMapId) onActiveDeleted();
    } catch (caught) {
      onConfirmDeleteIdChange(null);
      fail(caught);
    } finally {
      setBusy(false);
    }
  }

  async function rename(): Promise<void> {
    if (!renaming || busy || locked) return;
    const target = renaming;
    // Renaming the open map re-mounts it from the stored payload, so unsaved stage edits would be
    // lost — guard them the same way the screen's map-switch does.
    if (target.id === activeMapId && dirty && !window.confirm(t("editor.shell.exit.confirm"))) {
      return;
    }
    onError("");
    setBusy(true);
    try {
      const payload = await fetchMap(target.id);
      const updated = await updateMapApi(
        target.id,
        {
          ...saveInputFromPayload(payload),
          name: renameValue.trim(),
        },
        undefined,
        payload.revision,
      );
      setRenaming(null);
      await refresh();
      // Renaming the open map re-mounts it so the stage's in-memory name matches what was persisted.
      if (target.id === activeMapId) onOpenPayload(updated);
    } catch (caught) {
      fail(caught);
    } finally {
      setBusy(false);
    }
  }

  // A sandbox lists its own in-memory map instead of the server's (there is none). Derived in
  // render rather than pushed into `maps` by `refresh`, so a rename in the stage shows immediately.
  const stored = adventureId !== null;
  const listed: MapSummary[] = stored
    ? maps
    : sandboxMap
      ? // No author: nothing has been stored, so no account owns this row yet. The empty string is
        // the sandbox's signature here — a listed map always carries its creator's username.
        [{ ...sandboxMap, author: "", revision: 0, isFirst: true }]
      : [];

  const deleting = maps.find((map) => map.id === confirmDeleteId);

  return (
    <aside
      className="flex h-full flex-col border-l border-zinc-200 bg-zinc-50"
      aria-label={t("editor.shell.maps.aria")}
    >
      <div className="flex h-8 items-center justify-between border-b border-zinc-200 px-3">
        <span className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
          {t("editor.shell.maps.aria")}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("editor.new")}
          disabled={!adventureId || maps.length >= MAX_ADVENTURE_MAPS || busy || locked}
          title={maps.length >= MAX_ADVENTURE_MAPS ? t("editor.error.limit") : undefined}
          onClick={() => onNewMapOpenChange(true)}
        >
          <Plus />
        </Button>
      </div>

      <div className="flex flex-1 flex-col gap-1 overflow-auto p-2">
        {listed.map((map) => {
          return (
            <div
              key={map.id}
              className={`group flex items-center gap-1 rounded-md border px-2 py-1.5 ${
                map.id === activeMapId
                  ? "border-zinc-400 bg-white"
                  : "border-transparent hover:bg-zinc-200/60"
              }`}
            >
              <button
                type="button"
                className="flex min-w-0 flex-1 flex-col items-start text-left"
                aria-label={map.name || t("editor.new")}
                aria-current={map.id === activeMapId}
                disabled={locked}
                onClick={() => onRequestOpen(map.id)}
              >
                <span className="w-full truncate text-[12.5px] font-medium text-zinc-800">
                  {map.name || t("editor.new")}
                </span>
                <span className="flex max-w-full items-center gap-1.5 text-[10px] text-zinc-500">
                  <span className="rounded bg-zinc-200/80 px-1 tabular-nums">
                    {t("editor.shell.maps.dims", { cols: map.cols, rows: map.rows })}
                  </span>
                  {map.author && (
                    <span className="truncate">
                      {t("editor.picker.author", { author: map.author })}
                    </span>
                  )}
                </span>
              </button>
              {/* Rename and delete both act on a STORED row (they PUT/DELETE by id), so the
                  sandbox's in-memory map offers neither: its name is edited in the stage, and
                  "deleting" the only map of an adventure that does not exist yet is meaningless. */}
              {stored && (
                <>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label={`${t("editor.shell.maps.rename")} ${map.name}`}
                          disabled={busy || locked}
                          className="opacity-0 group-hover:opacity-100"
                          onClick={() => {
                            setRenaming(map);
                            setRenameValue(map.name);
                          }}
                        >
                          <Pencil />
                        </Button>
                      }
                    />
                    <TooltipContent>{t("editor.shell.maps.rename")}</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label={`${t("editor.delete")} ${map.name}`}
                          disabled={busy || locked}
                          className="text-destructive opacity-0 group-hover:opacity-100"
                          onClick={() => {
                            onConfirmDeleteIdChange(map.id);
                          }}
                        >
                          <Trash2 />
                        </Button>
                      }
                    />
                    <TooltipContent>{t("editor.delete")}</TooltipContent>
                  </Tooltip>
                </>
              )}
            </div>
          );
        })}
      </div>

      <div className="grid gap-1.5 border-t border-zinc-200 p-2">
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          disabled={!activeMapId || busy || locked}
          onClick={onOpenMapAudio}
        >
          <Music2 />
          {t("editor.audio.mapButton")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          disabled={!activeMapId || busy || locked}
          onClick={() => onOpenHeroSettings?.()}
        >
          <SlidersHorizontal />
          {t("editor.heroSettings.button")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          disabled={busy || locked}
          onClick={onOpenSettings}
        >
          <Settings2 />
          {t("editor.shell.settings")}
        </Button>
      </div>

      <Dialog open={newMapOpen} onOpenChange={onNewMapOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("editor.new")}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-map-name">{t("editor.name")}</Label>
              <Input
                id="new-map-name"
                type="text"
                value={newName}
                onChange={(event) => setNewName(event.currentTarget.value)}
              />
            </div>
            <p className="text-xs text-muted-foreground">{t("editor.shell.maps.ocean_hint")}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => onNewMapOpenChange(false)}>
              {t("editor.delete.cancel")}
            </Button>
            <Button
              disabled={
                !adventureId ||
                maps.length >= MAX_ADVENTURE_MAPS ||
                busy ||
                locked ||
                !newName.trim()
              }
              onClick={() => void create()}
            >
              {t("editor.shell.maps.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={renaming !== null} onOpenChange={(open) => !open && setRenaming(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("editor.shell.maps.rename")}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rename-map-name">{t("editor.name")}</Label>
            <Input
              id="rename-map-name"
              type="text"
              value={renameValue}
              onChange={(event) => setRenameValue(event.currentTarget.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenaming(null)}>
              {t("editor.delete.cancel")}
            </Button>
            <Button disabled={busy || locked || !renameValue.trim()} onClick={() => void rename()}>
              {t("editor.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleting !== undefined}
        onOpenChange={(open) => {
          if (!open) {
            onConfirmDeleteIdChange(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("editor.delete.title", { name: deleting?.name ?? "" })}</DialogTitle>
          </DialogHeader>
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
            <Checkbox id="force-delete-map" checked disabled />
            <div className="grid gap-1">
              <Label htmlFor="force-delete-map">{t("editor.delete.force")}</Label>
              <p className="text-xs text-muted-foreground">{t("editor.delete.force_warning")}</p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                onConfirmDeleteIdChange(null);
              }}
            >
              {t("editor.delete.cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={busy || locked}
              onClick={() => deleting && void remove(deleting.id)}
            >
              {t("editor.delete.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
