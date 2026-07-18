import { useEffect, useState } from "react";
import { TinyButton } from "@/ui/tiny-swords/TinyButton.js";
import { TinyFieldSelect } from "@/ui/tiny-swords/TinyFieldSelect.js";
import { TinyInput } from "@/ui/tiny-swords/TinyInput.js";
import { TinyLabel } from "@/ui/tiny-swords/TinyLabel.js";
import type { ExitDestination } from "../../shared/adventure.js";
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
} from "../adventure-draft.js";
import {
  type AdventureSummary,
  authErrorText,
  createAdventureApi,
  createPartyApi,
  deleteAdventureApi,
  errorCode,
  fetchAdventure,
  fetchAdventures,
  fetchMap,
  fetchMaps,
  fetchParties,
  type MapSummary,
  updateAdventureApi,
} from "../api.js";
import { t, useLocale } from "../i18n.js";
import { useUiStore } from "../store.js";

function isSessionError(code: string): boolean {
  return code === "session_expired" || code === "unauthorized";
}

async function memberInfo(mapId: string): Promise<DraftMemberInfo> {
  const payload = await fetchMap(mapId);
  return {
    mapId,
    name: payload.name,
    revision: payload.revision,
    blocks: payload.blocks,
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

function MapDraftThumbnail({ member }: { member: DraftMemberInfo }) {
  const rows = member.blocks.length;
  const cols = member.blocks[0]?.length ?? 0;
  const water = member.blocks
    .flatMap((row, rowIndex) =>
      [...row].flatMap((cell, colIndex) =>
        cell === "#" ? [`M${colIndex} ${rowIndex}h1v1h-1z`] : [],
      ),
    )
    .join("");
  return (
    <svg
      className="adventure-map-thumbnail"
      viewBox={`0 0 ${Math.max(1, cols)} ${Math.max(1, rows)}`}
      role="img"
      aria-label={member.name}
      preserveAspectRatio="xMidYMid slice"
    >
      <rect width={cols} height={rows} fill="#6fa76b" />
      <path d={water} fill="#4b9eb4" />
    </svg>
  );
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
  const setActiveParty = useUiStore((state) => state.setActiveParty);
  const storedSession = useUiStore((state) => state.adventureEditorSession);
  const setStoredSession = useUiStore((state) => state.setAdventureEditorSession);
  const setEditorReturnContext = useUiStore((state) => state.setEditorReturnContext);
  const [adventures, setAdventures] = useState<AdventureSummary[] | null>(null);
  const [maps, setMaps] = useState<MapSummary[] | null>(null);
  const [editing, setEditing] = useState<{
    id: string | null;
    draftId: string;
    draft: AdventureDraft;
  } | null>(
    storedSession
      ? {
          id: storedSession.adventureId,
          draftId: storedSession.draftId,
          draft: storedSession.draft,
        }
      : null,
  );
  const [addingMapId, setAddingMapId] = useState("");
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [savedDraft, setSavedDraft] = useState<string | null>(storedSession?.savedDraft ?? null);
  const [error, setError] = useState<string | null>(null);

  function remember(
    next: typeof editing,
    invalidatedLinks: string[] = [],
    saved = savedDraft,
  ): void {
    setEditing(next);
    setStoredSession(
      next
        ? {
            adventureId: next.id,
            draftId: next.draftId,
            draft: next.draft,
            invalidatedLinks,
            savedDraft: saved,
          }
        : null,
    );
  }

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
      const draft = draftFromAdventure(payload, infos);
      const saved = JSON.stringify(draft);
      setSavedDraft(saved);
      remember({ id, draftId: crypto.randomUUID(), draft }, [], saved);
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
      if (draft) remember({ ...editing, draft });
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
      remember(null);
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

  async function testAdventure(): Promise<void> {
    if (!editing?.id || testing || savedDraft !== JSON.stringify(editing.draft)) return;
    setTesting(true);
    setError(null);
    try {
      const created = await createPartyApi({
        adventureId: editing.id,
        name: `${editing.draft.title} · Test`,
        color: "blue",
      });
      const listing = (await fetchParties()).find((party) => party.id === created.id);
      if (!listing) throw new Error("party_not_found");
      setActiveParty(listing);
      setScreen("party");
    } catch (caught) {
      fail(caught);
    } finally {
      setTesting(false);
    }
  }

  function update(draft: AdventureDraft | null): void {
    if (editing && draft) remember({ ...editing, draft });
  }

  function openMapEditor(mapId: string | null, addCreatedMap: boolean): void {
    if (!editing) return;
    remember(editing, storedSession?.invalidatedLinks ?? []);
    setEditorReturnContext({
      screen: "adventure",
      adventureId: editing.id,
      draftId: editing.draftId,
      mapId,
      addCreatedMap,
    });
    setScreen("map-editor");
  }

  if (adventures === null || maps === null) return null;

  if (editing) {
    const draft = editing.draft;
    const validationIssues = draftValidationIssues(draft);
    const available = maps.filter(
      (map) => !draft.members.some((member) => member.mapId === map.id),
    );
    const startMap = draft.members.find((member) => member.mapId === draft.start?.mapId);
    return (
      <main className="creator-shell">
        <header className="creator-header">
          <div>
            <span className="eyebrow">{t("adventure.title")}</span>
            <h1>{draft.title.trim() || t("adventure.new")}</h1>
          </div>
          <TinyButton type="button" variant="secondary" onClick={() => remember(null)}>
            {t("editor.back")}
          </TinyButton>
        </header>
        {error && <p role="alert">{authErrorText(error)}</p>}

        <section className="creator-panel">
          <TinyLabel htmlFor="adventure-title">{t("adventure.name")}</TinyLabel>
          <TinyInput
            id="adventure-title"
            type="text"
            value={draft.title}
            onChange={(event) => update({ ...draft, title: event.currentTarget.value })}
          />
          <TinyLabel htmlFor="adventure-players">{t("adventure.players")}</TinyLabel>
          <TinyInput
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

        <section className="creator-panel" aria-label={t("adventure.maps.title")}>
          <h2>{t("adventure.maps.title")}</h2>
          {draft.members.map((member) => (
            <div key={member.mapId} className="adventure-member">
              <MapDraftThumbnail member={member} />
              <div>
                <strong>{member.name}</strong>
                <span>
                  {member.entryIds.length} {t("adventure.maps.entries")} · {member.exitIds.length}{" "}
                  {t("adventure.maps.exits")} · {member.monsterCount} {t("adventure.maps.monsters")}
                </span>
              </div>
              <TinyButton
                type="button"
                variant="secondary"
                onClick={() => openMapEditor(member.mapId, false)}
              >
                {t("adventure.maps.edit")}
              </TinyButton>
              <TinyButton
                type="button"
                variant="secondary"
                onClick={() => update(moveMember(draft, member.mapId, -1))}
              >
                {t("adventure.maps.up")}
              </TinyButton>
              <TinyButton
                type="button"
                variant="secondary"
                onClick={() => update(moveMember(draft, member.mapId, 1))}
              >
                {t("adventure.maps.down")}
              </TinyButton>
              <TinyButton
                type="button"
                variant="secondary"
                onClick={() => update(removeMember(draft, member.mapId))}
              >
                {t("adventure.maps.remove")}
              </TinyButton>
            </div>
          ))}
          <TinyButton type="button" onClick={() => openMapEditor(null, true)}>
            {t("adventure.maps.new")}
          </TinyButton>
          <TinyLabel htmlFor="adventure-add-map">{t("adventure.maps.add.label")}</TinyLabel>
          <TinyFieldSelect
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
          </TinyFieldSelect>
          <TinyButton type="button" onClick={() => void addMap()}>
            {t("adventure.maps.add")}
          </TinyButton>
        </section>

        <section className="creator-panel" aria-label={t("adventure.start.title")}>
          <h2>{t("adventure.start.title")}</h2>
          <TinyLabel htmlFor="adventure-start-map">{t("adventure.start.map")}</TinyLabel>
          <TinyFieldSelect
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
          </TinyFieldSelect>
          <TinyLabel htmlFor="adventure-start-entry">{t("adventure.start.entry")}</TinyLabel>
          <TinyFieldSelect
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
                {markerName(startMap?.entryLabels ?? {}, entryId)}
              </option>
            ))}
          </TinyFieldSelect>
        </section>

        <section className="creator-panel" aria-label={t("adventure.bindings.title")}>
          <h2>{t("adventure.bindings.title")}</h2>
          {draft.bindings.map((binding) => {
            const owner = draft.members.find((member) => member.mapId === binding.mapId);
            const selectId = `binding-${binding.mapId}-${binding.exitId}`;
            return (
              <div key={selectId} className="adventure-binding">
                <span>{owner?.name}</span>
                <TinyLabel htmlFor={selectId}>
                  {markerName(owner?.exitLabels ?? {}, binding.exitId)}
                </TinyLabel>
                <TinyFieldSelect
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
                        {member.name} · {markerName(member.entryLabels, entryId)}
                      </option>
                    )),
                  )}
                </TinyFieldSelect>
              </div>
            );
          })}
        </section>

        <section className="creator-panel" aria-label={t("adventure.validation.title")}>
          <h2>{t("adventure.validation.title")}</h2>
          {validationIssues.length === 0 && (storedSession?.invalidatedLinks.length ?? 0) === 0 ? (
            <p>{t("adventure.validation.valid")}</p>
          ) : (
            <ul>
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
                    {t(`adventure.validation.${issue.code}`, {
                      map: member?.name ?? "",
                      exit,
                    })}
                  </li>
                );
              })}
              {storedSession?.invalidatedLinks.map((link) => (
                <li key={`invalidated:${link}`}>{t("adventure.validation.marker_changed")}</li>
              ))}
            </ul>
          )}
        </section>
        {!draftComplete(draft) && <p>{t("adventure.incomplete")}</p>}
        <TinyButton
          type="button"
          disabled={!draftComplete(draft) || saving}
          onClick={() => void save()}
        >
          {t("editor.save")}
        </TinyButton>
        <TinyButton
          type="button"
          variant="secondary"
          disabled={
            editing.id === null ||
            !draftComplete(draft) ||
            savedDraft !== JSON.stringify(draft) ||
            testing
          }
          onClick={() => void testAdventure()}
        >
          {t("adventure.test")}
        </TinyButton>
      </main>
    );
  }

  const deleting = adventures.find((adventure) => adventure.id === confirmingId);
  return (
    <main className="creator-shell">
      <header className="creator-header">
        <div>
          <span className="eyebrow">{t("adventure.title")}</span>
          <h1>{t("adventure.title")}</h1>
        </div>
        <div>
          <TinyButton type="button" variant="secondary" onClick={() => void refresh()}>
            {t("adventure.refresh")}
          </TinyButton>
          <TinyButton type="button" variant="secondary" onClick={() => setScreen("parties")}>
            {t("editor.back")}
          </TinyButton>
        </div>
      </header>
      {error && <p role="alert">{authErrorText(error)}</p>}
      <section className="creator-grid" aria-label={t("adventure.title")}>
        {adventures.map((adventure) => (
          <article key={adventure.id} className="creator-panel creator-list-item">
            <div className="creator-item__identity">
              <h2>{adventure.title}</h2>
              <span>{t("adventure.players.count", { count: adventure.maxPlayers })}</span>
            </div>
            <div className="creator-actions">
              <TinyButton type="button" onClick={() => void openExisting(adventure.id)}>
                {t("adventure.edit")}
              </TinyButton>
              <TinyButton
                type="button"
                variant="secondary"
                onClick={() => setConfirmingId(adventure.id)}
              >
                {t("editor.delete")}
              </TinyButton>
            </div>
          </article>
        ))}
      </section>
      <TinyButton
        type="button"
        onClick={() => remember({ id: null, draftId: crypto.randomUUID(), draft: emptyDraft() })}
      >
        {t("adventure.new")}
      </TinyButton>
      {deleting && (
        <div className="delete-dialog-backdrop">
          <section
            className="delete-dialog creator-dialog creator-panel"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-adventure-title"
          >
            <h2 id="delete-adventure-title">
              {t("adventure.delete.title", { name: deleting.title })}
            </h2>
            <div className="delete-dialog__actions">
              <TinyButton type="button" variant="secondary" onClick={() => setConfirmingId(null)}>
                {t("editor.delete.cancel")}
              </TinyButton>
              <TinyButton type="button" className="danger" onClick={() => void remove(deleting.id)}>
                {t("editor.delete.confirm")}
              </TinyButton>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
