import { Pencil, Plus, Settings2, Star, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { nextMapName } from "../../../shared/map-naming.js";
import {
  createMapApi,
  deleteMapApi,
  errorCode,
  fetchMap,
  fetchMaps,
  type MapPayload,
  type MapSaveInput,
  type MapSummary,
  updateMapApi,
} from "../../api.js";
import { t, useLocale } from "../../i18n.js";
import { Button } from "../components/button.js";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/dialog.js";
import { Input } from "../components/input.js";
import { Label } from "../components/label.js";

/** A stored payload made into the create/update body: everything but the server-minted id/revision. */
function saveInputFromPayload(payload: MapPayload): MapSaveInput {
  const { id: _id, revision: _revision, ...rest } = payload;
  return rest;
}

interface MapListPanelProps {
  /** The adventure whose maps this panel lists and creates into. A map belongs to exactly one
   *  adventure, so creation is per-adventure; `null` means no adventure is loaded — the list is empty
   *  and creation is disabled. */
  adventureId: string | null;
  /** The map currently mounted in the stage, so the panel marks it and knows what "delete the open
   *  map" targets. */
  activeMapId: string | null;
  /** The adventure's starting map (UX wave #6), so the panel fills that row's start affordance. Null
   *  for a draft with no start authored. */
  startMapId: string | null;
  /** The maps that CAN be the start — those with at least one entry for the graph to point at. The
   *  start star is disabled (with a hint) on every other map, so an entry-less map gives feedback
   *  instead of the misleading `adventure_maps` error the star used to raise. */
  startableMapIds: ReadonlySet<string>;
  /** Whether the open map has unsaved stage edits, so renaming it in place can guard them: rename
   *  persists the *stored* payload and re-mounts, which would otherwise drop those edits silently. */
  dirty: boolean;
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
  /** Make this map the adventure's starting map (via its first entry), persisted by the screen. */
  onSetStart(mapId: string): void;
  onOpenSettings(): void;
  onError(code: string): void;
  onSessionExpired(): void;
}

function isSessionError(code: string): boolean {
  return code === "session_expired" || code === "unauthorized";
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
  activeMapId,
  startMapId,
  startableMapIds,
  dirty,
  refreshNonce,
  newMapOpen,
  onNewMapOpenChange,
  confirmDeleteId,
  onConfirmDeleteIdChange,
  onRequestOpen,
  onOpenPayload,
  onActiveDeleted,
  onSetStart,
  onOpenSettings,
  onError,
  onSessionExpired,
}: MapListPanelProps) {
  useLocale();
  const [maps, setMaps] = useState<MapSummary[]>([]);
  const [renaming, setRenaming] = useState<MapSummary | null>(null);
  const [newName, setNewName] = useState("");
  const [renameValue, setRenameValue] = useState("");

  function fail(caught: unknown): void {
    const code = errorCode(caught);
    if (isSessionError(code)) onSessionExpired();
    else onError(code);
  }

  async function refresh(): Promise<void> {
    // A map belongs to exactly one adventure: with no adventure loaded there is nothing to list, and
    // `/api/maps` requires the `adventure` param. Show an empty list and skip the fetch.
    if (!adventureId) {
      setMaps([]);
      return;
    }
    try {
      setMaps(await fetchMaps(adventureId));
    } catch (caught) {
      fail(caught);
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
    if (newMapOpen) setNewName(nextMapName(maps.map((map) => map.name)));
  }, [newMapOpen]);

  async function create(): Promise<void> {
    if (!adventureId) return;
    onError("");
    try {
      const created = await createMapApi(adventureId, newName.trim());
      onNewMapOpenChange(false);
      setNewName("");
      await refresh();
      onOpenPayload(created);
    } catch (caught) {
      fail(caught);
    }
  }

  async function remove(id: string): Promise<void> {
    try {
      await deleteMapApi(id);
      onConfirmDeleteIdChange(null);
      await refresh();
      if (id === activeMapId) onActiveDeleted();
    } catch (caught) {
      onConfirmDeleteIdChange(null);
      fail(caught);
    }
  }

  async function rename(): Promise<void> {
    if (!renaming) return;
    const target = renaming;
    // Renaming the open map re-mounts it from the stored payload, so unsaved stage edits would be
    // lost — guard them the same way the screen's map-switch does.
    if (target.id === activeMapId && dirty && !window.confirm(t("editor.shell.exit.confirm"))) {
      return;
    }
    onError("");
    try {
      const payload = await fetchMap(target.id);
      const updated = await updateMapApi(target.id, {
        ...saveInputFromPayload(payload),
        name: renameValue.trim(),
      });
      setRenaming(null);
      await refresh();
      // Renaming the open map re-mounts it so the stage's in-memory name matches what was persisted.
      if (target.id === activeMapId) onOpenPayload(updated);
    } catch (caught) {
      fail(caught);
    }
  }

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
          onClick={() => onNewMapOpenChange(true)}
        >
          <Plus />
        </Button>
      </div>

      <div className="flex flex-1 flex-col gap-1 overflow-auto p-2">
        {maps.map((map) => {
          const isStart = map.id === startMapId;
          // A map with no entry cannot be the start (the graph start binds an entry). Disable the star
          // there with a hint, rather than raising the misleading `adventure_maps` error on click.
          const canStart = isStart || startableMapIds.has(map.id);
          return (
            <div
              key={map.id}
              className={`group flex items-center gap-1 rounded-md border px-2 py-1.5 ${
                map.id === activeMapId
                  ? "border-zinc-400 bg-white"
                  : "border-transparent hover:bg-zinc-200/60"
              }`}
            >
              <Button
                variant="ghost"
                size="icon-xs"
                disabled={!canStart}
                aria-label={
                  isStart ? t("editor.shell.maps.start.active") : t("editor.shell.maps.start")
                }
                title={canStart ? undefined : t("editor.shell.maps.start.noEntry")}
                aria-pressed={isStart}
                className={isStart ? "text-amber-500" : "text-zinc-300 hover:text-zinc-500"}
                onClick={() => onSetStart(map.id)}
              >
                <Star fill={isStart ? "currentColor" : "none"} />
              </Button>
              <button
                type="button"
                className="flex min-w-0 flex-1 flex-col items-start text-left"
                aria-label={map.name || t("editor.new")}
                aria-current={map.id === activeMapId}
                onClick={() => onRequestOpen(map.id)}
              >
                <span className="w-full truncate text-[12.5px] font-medium text-zinc-800">
                  {map.name || t("editor.new")}
                </span>
                <span className="rounded bg-zinc-200/80 px-1 text-[10px] tabular-nums text-zinc-500">
                  {t("editor.shell.maps.dims", { cols: map.cols, rows: map.rows })}
                </span>
              </button>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`${t("editor.shell.maps.rename")} ${map.name}`}
                className="opacity-0 group-hover:opacity-100"
                onClick={() => {
                  setRenaming(map);
                  setRenameValue(map.name);
                }}
              >
                <Pencil />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`${t("editor.delete")} ${map.name}`}
                className="text-destructive opacity-0 group-hover:opacity-100"
                onClick={() => onConfirmDeleteIdChange(map.id)}
              >
                <Trash2 />
              </Button>
            </div>
          );
        })}
      </div>

      <div className="border-t border-zinc-200 p-2">
        <Button variant="outline" size="sm" className="w-full" onClick={onOpenSettings}>
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
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => onNewMapOpenChange(false)}>
              {t("editor.delete.cancel")}
            </Button>
            <Button disabled={!adventureId} onClick={() => void create()}>
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
            <Button onClick={() => void rename()}>{t("editor.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleting !== undefined}
        onOpenChange={(open) => !open && onConfirmDeleteIdChange(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("editor.delete.title", { name: deleting?.name ?? "" })}</DialogTitle>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => onConfirmDeleteIdChange(null)}>
              {t("editor.delete.cancel")}
            </Button>
            <Button variant="destructive" onClick={() => deleting && void remove(deleting.id)}>
              {t("editor.delete.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
