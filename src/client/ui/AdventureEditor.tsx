import { useEffect, useState } from "react";
import type { ExitDestination } from "../../shared/adventure.js";
import {
  type AdventureDraft,
  addMember,
  bindExit,
  type DraftMemberInfo,
  draftComplete,
  draftFromAdventure,
  emptyDraft,
  removeMember,
  setStart,
  toAdventureInput,
} from "../adventure-draft.js";
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
} from "../api.js";
import { t, useLocale } from "../i18n.js";
import { useUiStore } from "../store.js";
import { Button } from "./pixelact-ui/button/index.js";
import { Input } from "./pixelact-ui/input.js";
import { Label } from "./pixelact-ui/label.js";

function isSessionError(code: string): boolean {
  return code === "session_expired" || code === "unauthorized";
}

async function memberInfo(mapId: string): Promise<DraftMemberInfo> {
  const payload = await fetchMap(mapId);
  return {
    mapId,
    name: payload.name,
    entryIds: payload.markers.entries.map((marker) => marker.id),
    exitIds: payload.markers.exits.map((marker) => marker.id),
  };
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

export function AdventureEditor() {
  useLocale();
  const setScreen = useUiStore((state) => state.setScreen);
  const [adventures, setAdventures] = useState<AdventureSummary[] | null>(null);
  const [maps, setMaps] = useState<MapSummary[] | null>(null);
  const [editing, setEditing] = useState<{ id: string | null; draft: AdventureDraft } | null>(null);
  const [addingMapId, setAddingMapId] = useState("");
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only fetch
  useEffect(() => {
    void refresh();
  }, []);

  function fail(caught: unknown): boolean {
    const code = errorCode(caught);
    if (isSessionError(code)) {
      setScreen("auth");
      return true;
    }
    setError(code);
    return false;
  }

  async function refresh(): Promise<void> {
    setError(null);
    try {
      const [list, library] = await Promise.all([fetchAdventures(), fetchMaps()]);
      setAdventures(list);
      setMaps(library);
    } catch (caught) {
      if (!fail(caught)) {
        setAdventures((current) => current ?? []);
        setMaps((current) => current ?? []);
      }
    }
  }

  async function openExisting(id: string): Promise<void> {
    setError(null);
    try {
      const payload = await fetchAdventure(id);
      const infos = new Map<string, DraftMemberInfo>();
      for (const mapId of payload.mapIds) infos.set(mapId, await memberInfo(mapId));
      setEditing({ id, draft: draftFromAdventure(payload, infos) });
    } catch (caught) {
      fail(caught);
    }
  }

  async function addMap(): Promise<void> {
    if (!editing || !addingMapId) return;
    setError(null);
    try {
      const info = await memberInfo(addingMapId);
      const draft = addMember(editing.draft, info);
      if (draft) setEditing({ ...editing, draft });
      setAddingMapId("");
    } catch (caught) {
      fail(caught);
    }
  }

  async function save(): Promise<void> {
    if (!editing || saving) return;
    const input = toAdventureInput(editing.draft);
    if (!input) return;
    setSaving(true);
    setError(null);
    try {
      if (editing.id === null) await createAdventureApi(input);
      else await updateAdventureApi(editing.id, input);
      setEditing(null);
      await refresh();
    } catch (caught) {
      fail(caught);
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string): Promise<void> {
    try {
      await deleteAdventureApi(id);
      setConfirmingId(null);
      await refresh();
    } catch (caught) {
      fail(caught);
      setConfirmingId(null);
    }
  }

  function update(draft: AdventureDraft | null): void {
    if (editing && draft) setEditing({ ...editing, draft });
  }

  if (adventures === null || maps === null) return null;

  if (editing) {
    const draft = editing.draft;
    const available = maps.filter(
      (map) => !draft.members.some((member) => member.mapId === map.id),
    );
    const startMap = draft.members.find((member) => member.mapId === draft.start?.mapId);
    return (
      <main className="roster-shell">
        <header className="roster-header">
          <div>
            <span className="eyebrow">{t("adventure.title")}</span>
            <h1>{draft.title.trim() || t("adventure.new")}</h1>
          </div>
          <Button type="button" variant="secondary" onClick={() => setEditing(null)}>
            {t("editor.back")}
          </Button>
        </header>
        {error && <p role="alert">{authErrorText(error)}</p>}

        <section className="roster-card framed">
          <Label htmlFor="adventure-title">{t("adventure.name")}</Label>
          <Input
            id="adventure-title"
            type="text"
            value={draft.title}
            onChange={(event) => update({ ...draft, title: event.currentTarget.value })}
          />
          <Label htmlFor="adventure-players">{t("adventure.players")}</Label>
          <Input
            id="adventure-players"
            type="number"
            min={1}
            max={4}
            value={draft.maxPlayers}
            onChange={(event) =>
              update({ ...draft, maxPlayers: Number(event.currentTarget.value) })
            }
          />
        </section>

        <section className="roster-card framed" aria-label={t("adventure.maps.title")}>
          <h2>{t("adventure.maps.title")}</h2>
          {draft.members.map((member) => (
            <div key={member.mapId} className="adventure-member">
              <span>{member.name}</span>
              <Button
                type="button"
                variant="secondary"
                onClick={() => update(removeMember(draft, member.mapId))}
              >
                {t("adventure.maps.remove")}
              </Button>
            </div>
          ))}
          <Label htmlFor="adventure-add-map">{t("adventure.maps.add.label")}</Label>
          <select
            id="adventure-add-map"
            value={addingMapId}
            onChange={(event) => setAddingMapId(event.currentTarget.value)}
          >
            <option value="">—</option>
            {available.map((map) => (
              <option key={map.id} value={map.id}>
                {map.name}
              </option>
            ))}
          </select>
          <Button type="button" onClick={() => void addMap()}>
            {t("adventure.maps.add")}
          </Button>
        </section>

        <section className="roster-card framed" aria-label={t("adventure.start.title")}>
          <h2>{t("adventure.start.title")}</h2>
          <Label htmlFor="adventure-start-map">{t("adventure.start.map")}</Label>
          <select
            id="adventure-start-map"
            value={draft.start?.mapId ?? ""}
            onChange={(event) => {
              const member = draft.members.find((m) => m.mapId === event.currentTarget.value);
              const first = member?.entryIds[0];
              if (member && first) update(setStart(draft, member.mapId, first));
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
          </select>
          <Label htmlFor="adventure-start-entry">{t("adventure.start.entry")}</Label>
          <select
            id="adventure-start-entry"
            value={draft.start?.entryId ?? ""}
            onChange={(event) => {
              if (draft.start)
                update(setStart(draft, draft.start.mapId, event.currentTarget.value));
            }}
          >
            <option value="">—</option>
            {(startMap?.entryIds ?? []).map((entryId) => (
              <option key={entryId} value={entryId}>
                {entryId}
              </option>
            ))}
          </select>
        </section>

        <section className="roster-card framed" aria-label={t("adventure.bindings.title")}>
          <h2>{t("adventure.bindings.title")}</h2>
          {draft.bindings.map((binding) => {
            const owner = draft.members.find((member) => member.mapId === binding.mapId);
            const selectId = `binding-${binding.mapId}-${binding.exitId}`;
            return (
              <div key={selectId} className="adventure-binding">
                <span>{owner?.name}</span>
                <Label htmlFor={selectId}>{binding.exitId}</Label>
                <select
                  id={selectId}
                  value={encodeDest(binding.dest)}
                  onChange={(event) =>
                    update(
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
                        {member.name} · {entryId}
                      </option>
                    )),
                  )}
                </select>
              </div>
            );
          })}
        </section>

        {!draftComplete(draft) && <p>{t("adventure.incomplete")}</p>}
        <Button
          type="button"
          disabled={!draftComplete(draft) || saving}
          onClick={() => void save()}
        >
          {t("editor.save")}
        </Button>
      </main>
    );
  }

  const deleting = adventures.find((adventure) => adventure.id === confirmingId);
  return (
    <main className="roster-shell">
      <header className="roster-header">
        <div>
          <span className="eyebrow">{t("adventure.title")}</span>
          <h1>{t("adventure.title")}</h1>
        </div>
        <div>
          <Button type="button" variant="secondary" onClick={() => void refresh()}>
            {t("adventure.refresh")}
          </Button>
          <Button type="button" variant="secondary" onClick={() => setScreen("characters")}>
            {t("editor.back")}
          </Button>
        </div>
      </header>
      {error && <p role="alert">{authErrorText(error)}</p>}
      <section className="roster-grid" aria-label={t("adventure.title")}>
        {adventures.map((adventure) => (
          <article key={adventure.id} className="roster-card framed">
            <div className="roster-card__identity">
              <h2>{adventure.title}</h2>
              <span>{t("adventure.players.count", { count: adventure.maxPlayers })}</span>
            </div>
            <div className="roster-card__actions">
              <Button type="button" onClick={() => void openExisting(adventure.id)}>
                {t("adventure.edit")}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setConfirmingId(adventure.id)}
              >
                {t("editor.delete")}
              </Button>
            </div>
          </article>
        ))}
      </section>
      <Button type="button" onClick={() => setEditing({ id: null, draft: emptyDraft() })}>
        {t("adventure.new")}
      </Button>
      {deleting && (
        <div className="delete-dialog-backdrop">
          <section
            className="delete-dialog parchment framed"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-adventure-title"
          >
            <h2 id="delete-adventure-title">
              {t("adventure.delete.title", { name: deleting.title })}
            </h2>
            <div className="delete-dialog__actions">
              <Button type="button" variant="secondary" onClick={() => setConfirmingId(null)}>
                {t("editor.delete.cancel")}
              </Button>
              <Button type="button" className="danger" onClick={() => void remove(deleting.id)}>
                {t("editor.delete.confirm")}
              </Button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
