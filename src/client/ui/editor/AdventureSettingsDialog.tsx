import type * as React from "react";
import { useEffect, useState } from "react";
import type { ExitDestination } from "../../../shared/adventure.js";
import {
  type AdventureDraft,
  addMember,
  bindExit,
  type DraftMemberInfo,
  draftComplete,
  draftFromAdventure,
  draftValidationIssues,
  emptyDraft,
  moveMember,
  removeMember,
  setStart,
  toAdventureInput,
} from "../../adventure-draft.js";
import {
  type AdventureSummary,
  authErrorText,
  createAdventureApi,
  deleteAdventureApi,
  errorCode,
  fetchAdventure,
  fetchAdventures,
  fetchMap,
  fetchMaps,
  type MapSummary,
  updateAdventureApi,
} from "../../api.js";
import { solidMaskFromMapPayload } from "../../game/editor-state.js";
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
import { Label } from "../components/label.js";

function isSessionError(code: string): boolean {
  return code === "session_expired" || code === "unauthorized";
}

async function memberInfo(mapId: string): Promise<DraftMemberInfo> {
  const payload = await fetchMap(mapId);
  return {
    mapId,
    name: payload.name,
    revision: payload.revision,
    solid: solidMaskFromMapPayload(payload),
    monsterCount: payload.markers.monsterSpawns.length,
    entryIds: payload.markers.entries.map((marker) => marker.id),
    exitIds: payload.markers.exits.map((marker) => marker.id),
    entryLabels: Object.fromEntries(
      payload.markers.entries.flatMap((marker) =>
        marker.label ? [[marker.id, marker.label] as const] : [],
      ),
    ),
    exitLabels: Object.fromEntries(
      payload.markers.exits.flatMap((marker) =>
        marker.label ? [[marker.id, marker.label] as const] : [],
      ),
    ),
  };
}

function markerName(labels: Readonly<Record<string, string>>, id: string): string {
  return labels[id] ?? id;
}

/** "end" or "mapId::entryId" — both id alphabets exclude ":". */
function encodeDest(dest: ExitDestination | null): string {
  if (dest === null) return "";
  if (dest === "end") return "end";
  return `${dest.mapId}::${dest.entryId}`;
}

function decodeDest(value: string): ExitDestination | null {
  if (value === "") return null;
  if (value === "end") return "end";
  const [mapId, entryId] = value.split("::");
  if (!mapId || !entryId) return null;
  return { mapId, entryId };
}

/** Dense native select, styled to sit with the shadcn Input in creator surfaces. Native so the
 *  membership/start/binding pickers stay keyboard- and test-driveable, unlike a portalled listbox. */
function FieldSelect(props: React.ComponentProps<"select">) {
  const { className, ...rest } = props;
  return (
    <select
      className={`h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 ${className ?? ""}`}
      {...rest}
    />
  );
}

interface AdventureSettingsDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** A membership/save landed: the map panel should refetch names and dims. */
  onSaved(): void;
  onSessionExpired(): void;
}

/**
 * Adventure-level settings, absorbed from the deleted `AdventureEditor` screen: title, max players,
 * map membership (add/remove/reorder), the starting entry, exit→entry bindings, the graph-validation
 * readout and save. Secondary chrome reached from the menu bar's Fichier menu and the map panel — not
 * a screen of its own.
 *
 * Which adventure is being edited is carried by the store's `adventureEditorSession` draft slice —
 * the same seam the old two-screen flow used. With no session, the dialog first lists the account's
 * adventures to pick or create one; once a draft is loaded, it shows the editing form.
 */
export function AdventureSettingsDialog({
  open,
  onOpenChange,
  onSaved,
  onSessionExpired,
}: AdventureSettingsDialogProps) {
  useLocale();
  const session = useUiStore((state) => state.adventureEditorSession);
  const setSession = useUiStore((state) => state.setAdventureEditorSession);

  const [adventures, setAdventures] = useState<AdventureSummary[] | null>(null);
  const [maps, setMaps] = useState<MapSummary[]>([]);
  const [addingMapId, setAddingMapId] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function fail(caught: unknown): void {
    const code = errorCode(caught);
    if (isSessionError(code)) onSessionExpired();
    else setError(code);
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload the picker/map library each open
  useEffect(() => {
    if (!open) return;
    setError(null);
    void (async () => {
      try {
        const [list, library] = await Promise.all([fetchAdventures(), fetchMaps()]);
        setAdventures(list);
        setMaps(library);
      } catch (caught) {
        fail(caught);
      }
    })();
  }, [open]);

  function updateDraft(draft: AdventureDraft | null): void {
    if (session && draft) setSession({ ...session, draft });
  }

  async function openExisting(id: string): Promise<void> {
    setError(null);
    try {
      const payload = await fetchAdventure(id);
      const infos = new Map<string, DraftMemberInfo>();
      for (const mapId of payload.mapIds) infos.set(mapId, await memberInfo(mapId));
      const draft = draftFromAdventure(payload, infos);
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

  function createNew(): void {
    setSession({
      adventureId: null,
      draftId: crypto.randomUUID(),
      draft: emptyDraft(),
      invalidatedLinks: [],
      savedDraft: null,
    });
  }

  async function addMap(): Promise<void> {
    if (!session || !addingMapId) return;
    setError(null);
    try {
      const info = await memberInfo(addingMapId);
      const draft = addMember(session.draft, info);
      if (draft) setSession({ ...session, draft });
      setAddingMapId("");
    } catch (caught) {
      fail(caught);
    }
  }

  // Delete the adventure currently open in the editor session. Confirm-gated in the UI, wired to the
  // account-scoped delete endpoint, and clears the session on success so the dialog falls back to the
  // adventure picker — the server refuses the delete if a party still references the adventure.
  async function remove(): Promise<void> {
    if (!session?.adventureId) return;
    setError(null);
    try {
      await deleteAdventureApi(session.adventureId);
      setConfirmingDelete(false);
      setSession(null);
      onSaved();
      setAdventures(await fetchAdventures());
    } catch (caught) {
      setConfirmingDelete(false);
      fail(caught);
    }
  }

  async function save(): Promise<void> {
    if (!session || saving) return;
    const input = toAdventureInput(session.draft);
    if (!input) return;
    setSaving(true);
    setError(null);
    try {
      if (session.adventureId === null) await createAdventureApi(input);
      else await updateAdventureApi(session.adventureId, input);
      setSession(null);
      onSaved();
      try {
        setAdventures(await fetchAdventures());
      } catch (caught) {
        fail(caught);
      }
    } catch (caught) {
      fail(caught);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("adventure.title")}</DialogTitle>
        </DialogHeader>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {authErrorText(error)}
          </p>
        )}

        {session ? (
          <EditForm
            draft={session.draft}
            maps={maps}
            addingMapId={addingMapId}
            saving={saving}
            canDelete={session.adventureId !== null}
            onAddingMapIdChange={setAddingMapId}
            onUpdate={updateDraft}
            onAddMap={() => void addMap()}
            onSave={() => void save()}
            onDelete={() => setConfirmingDelete(true)}
            onBack={() => setSession(null)}
          />
        ) : (
          <Picker
            adventures={adventures}
            onOpen={(id) => void openExisting(id)}
            onNew={createNew}
          />
        )}

        <Dialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {t("adventure.delete.title", { name: session?.draft.title ?? "" })}
              </DialogTitle>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmingDelete(false)}>
                {t("adventure.delete.cancel")}
              </Button>
              <Button variant="destructive" onClick={() => void remove()}>
                {t("editor.delete.confirm")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}

function Picker({
  adventures,
  onOpen,
  onNew,
}: {
  adventures: AdventureSummary[] | null;
  onOpen(id: string): void;
  onNew(): void;
}) {
  useLocale();
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
        {t("editor.shell.settings.pick")}
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
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-medium">{adventure.title}</span>
              <span className="text-xs text-muted-foreground">
                {t("adventure.players.count", { count: adventure.maxPlayers })}
              </span>
            </div>
            <Button variant="secondary" size="sm" onClick={() => onOpen(adventure.id)}>
              {t("adventure.edit")}
            </Button>
          </div>
        ))}
      </div>
      <Button className="self-start" onClick={onNew}>
        {t("adventure.new")}
      </Button>
    </div>
  );
}

function EditForm({
  draft,
  maps,
  addingMapId,
  saving,
  canDelete,
  onAddingMapIdChange,
  onUpdate,
  onAddMap,
  onSave,
  onDelete,
  onBack,
}: {
  draft: AdventureDraft;
  maps: MapSummary[];
  addingMapId: string;
  saving: boolean;
  canDelete: boolean;
  onAddingMapIdChange(id: string): void;
  onUpdate(draft: AdventureDraft | null): void;
  onAddMap(): void;
  onSave(): void;
  onDelete(): void;
  onBack(): void;
}) {
  useLocale();
  const validationIssues = draftValidationIssues(draft);
  const available = maps.filter((map) => !draft.members.some((member) => member.mapId === map.id));
  const startMap = draft.members.find((member) => member.mapId === draft.start?.mapId);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="adventure-title">{t("adventure.name")}</Label>
        <Input
          id="adventure-title"
          type="text"
          value={draft.title}
          onChange={(event) => onUpdate({ ...draft, title: event.currentTarget.value })}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="adventure-players">{t("adventure.players")}</Label>
        <Input
          id="adventure-players"
          type="number"
          min={1}
          max={4}
          value={draft.maxPlayers}
          onChange={(event) =>
            onUpdate({ ...draft, maxPlayers: Number(event.currentTarget.value) })
          }
        />
      </div>

      <section className="flex flex-col gap-2" aria-label={t("adventure.maps.title")}>
        <h3 className="text-sm font-semibold">{t("adventure.maps.title")}</h3>
        {draft.members.map((member) => (
          <div
            key={member.mapId}
            className="flex items-center gap-2 rounded-md border border-zinc-200 px-2 py-1.5"
          >
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-medium">{member.name}</span>
              <span className="text-xs text-muted-foreground">
                {member.entryIds.length} {t("adventure.maps.entries")} · {member.exitIds.length}{" "}
                {t("adventure.maps.exits")} · {member.monsterCount} {t("adventure.maps.monsters")}
              </span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onUpdate(moveMember(draft, member.mapId, -1))}
            >
              {t("adventure.maps.up")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onUpdate(moveMember(draft, member.mapId, 1))}
            >
              {t("adventure.maps.down")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onUpdate(removeMember(draft, member.mapId))}
            >
              {t("adventure.maps.remove")}
            </Button>
          </div>
        ))}
        <div className="flex items-end gap-2">
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="adventure-add-map">{t("adventure.maps.add.label")}</Label>
            <FieldSelect
              id="adventure-add-map"
              value={addingMapId}
              onChange={(event) => onAddingMapIdChange(event.currentTarget.value)}
            >
              <option value="">—</option>
              {available.map((map) => (
                <option key={map.id} value={map.id}>
                  {map.name}
                </option>
              ))}
            </FieldSelect>
          </div>
          <Button variant="secondary" onClick={onAddMap}>
            {t("adventure.maps.add")}
          </Button>
        </div>
      </section>

      <section className="flex flex-col gap-2" aria-label={t("adventure.start.title")}>
        <h3 className="text-sm font-semibold">{t("adventure.start.title")}</h3>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="adventure-start-map">{t("adventure.start.map")}</Label>
          <FieldSelect
            id="adventure-start-map"
            value={draft.start?.mapId ?? ""}
            onChange={(event) => {
              const member = draft.members.find((m) => m.mapId === event.currentTarget.value);
              const first = member?.entryIds[0];
              if (member && first) onUpdate(setStart(draft, member.mapId, first));
            }}
          >
            <option value="">—</option>
            {draft.members
              .filter((member) => member.entryIds.length > 0)
              .map((member) => (
                <option key={member.mapId} value={member.mapId}>
                  {member.name}
                </option>
              ))}
          </FieldSelect>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="adventure-start-entry">{t("adventure.start.entry")}</Label>
          <FieldSelect
            id="adventure-start-entry"
            value={draft.start?.entryId ?? ""}
            onChange={(event) => {
              if (draft.start)
                onUpdate(setStart(draft, draft.start.mapId, event.currentTarget.value));
            }}
          >
            <option value="">—</option>
            {(startMap?.entryIds ?? []).map((entryId) => (
              <option key={entryId} value={entryId}>
                {markerName(startMap?.entryLabels ?? {}, entryId)}
              </option>
            ))}
          </FieldSelect>
        </div>
      </section>

      <section className="flex flex-col gap-2" aria-label={t("adventure.bindings.title")}>
        <h3 className="text-sm font-semibold">{t("adventure.bindings.title")}</h3>
        {draft.bindings.map((binding) => {
          const owner = draft.members.find((member) => member.mapId === binding.mapId);
          const selectId = `binding-${binding.mapId}-${binding.exitId}`;
          return (
            <div key={selectId} className="flex flex-col gap-1.5">
              <Label htmlFor={selectId}>
                {owner?.name} · {markerName(owner?.exitLabels ?? {}, binding.exitId)}
              </Label>
              <FieldSelect
                id={selectId}
                value={encodeDest(binding.dest)}
                onChange={(event) =>
                  onUpdate(
                    bindExit(
                      draft,
                      binding.mapId,
                      binding.exitId,
                      decodeDest(event.currentTarget.value),
                    ),
                  )
                }
              >
                <option value="">{t("adventure.bindings.unbound")}</option>
                <option value="end">{t("adventure.bindings.end")}</option>
                {draft.members.flatMap((member) =>
                  member.entryIds.map((entryId) => (
                    <option
                      key={`${member.mapId}::${entryId}`}
                      value={`${member.mapId}::${entryId}`}
                    >
                      {member.name} · {markerName(member.entryLabels, entryId)}
                    </option>
                  )),
                )}
              </FieldSelect>
            </div>
          );
        })}
      </section>

      <section className="flex flex-col gap-1" aria-label={t("adventure.validation.title")}>
        <h3 className="text-sm font-semibold">{t("adventure.validation.title")}</h3>
        {validationIssues.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("adventure.validation.valid")}</p>
        ) : (
          <ul className="flex flex-col gap-0.5 text-sm text-destructive">
            {validationIssues.map((issue) => {
              const member =
                "mapId" in issue
                  ? draft.members.find((candidate) => candidate.mapId === issue.mapId)
                  : undefined;
              const exit =
                issue.code === "unbound_exit"
                  ? markerName(member?.exitLabels ?? {}, issue.exitId)
                  : "";
              return (
                <li key={`${issue.code}:${"mapId" in issue ? issue.mapId : ""}:${exit}`}>
                  {t(`adventure.validation.${issue.code}`, { map: member?.name ?? "", exit })}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {!draftComplete(draft) && (
        <p className="text-sm text-muted-foreground">{t("adventure.incomplete")}</p>
      )}

      <div className="flex items-center justify-between gap-2">
        <Button variant="outline" onClick={onBack}>
          {t("editor.back")}
        </Button>
        <div className="flex gap-2">
          {canDelete && (
            <Button variant="destructive" onClick={onDelete}>
              {t("editor.delete")}
            </Button>
          )}
          <Button disabled={!draftComplete(draft) || saving} onClick={onSave}>
            {t("editor.save")}
          </Button>
        </div>
      </div>
    </div>
  );
}
