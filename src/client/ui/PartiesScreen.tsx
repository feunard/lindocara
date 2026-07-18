import { useEffect, useState } from "react";
import type { PartyColor } from "../../shared/party.js";
import {
  type AdventureSummary,
  authErrorText,
  createPartyApi,
  deletePartyApi,
  errorCode,
  fetchAdventures,
  fetchParties,
  joinPartyApi,
  type PartyListing,
} from "../api.js";
import { t, useLocale } from "../i18n.js";
import { useUiStore } from "../store.js";
import { ColorPicker } from "./ColorPicker.js";
import { Button } from "./pixelact-ui/button/index.js";
import { Input } from "./pixelact-ui/input.js";
import { Label } from "./pixelact-ui/label.js";

function isSessionError(code: string): boolean {
  return code === "session_expired" || code === "unauthorized";
}

export function PartiesScreen() {
  useLocale();
  const accountId = useUiStore((s) => s.accountId);
  const setActiveParty = useUiStore((s) => s.setActiveParty);
  const setScreen = useUiStore((s) => s.setScreen);
  const [parties, setParties] = useState<PartyListing[] | null>(null);
  const [adventures, setAdventures] = useState<AdventureSummary[] | null>(null);
  const [adventureId, setAdventureId] = useState("");
  const [name, setName] = useState("");
  const [colour, setColour] = useState<PartyColor>("blue");
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only fetch
  useEffect(() => {
    void refresh();
  }, []);

  function fail(caught: unknown): void {
    const code = errorCode(caught);
    if (isSessionError(code)) setScreen("auth");
    else setError(code);
  }

  async function refresh(): Promise<void> {
    setError(null);
    try {
      const [list, advs] = await Promise.all([fetchParties(), fetchAdventures()]);
      setParties(list);
      setAdventures(advs);
    } catch (caught) {
      fail(caught);
      setParties((current) => current ?? []);
      setAdventures((current) => current ?? []);
    }
  }

  function enter(party: PartyListing): void {
    setActiveParty(party);
    setScreen("party");
  }

  async function create(): Promise<void> {
    if (!adventureId) return;
    setError(null);
    try {
      const created = await createPartyApi({
        adventureId,
        name: name.trim() || null,
        color: colour,
      });
      const list = await fetchParties();
      setParties(list);
      // Match by the id we just minted, not by adventure: a caller may host several parties of the
      // same adventure ("comme plusieurs serveurs"), so adventureId is not unique to this one.
      const mine = list.find((party) => party.id === created.id);
      if (mine) enter(mine);
    } catch (caught) {
      fail(caught);
    }
  }

  async function join(party: PartyListing, chosen: PartyColor): Promise<void> {
    setError(null);
    try {
      await joinPartyApi(party.id, chosen);
      setJoiningId(null);
      const list = await fetchParties();
      setParties(list);
      const joined = list.find((row) => row.id === party.id);
      if (joined) enter(joined);
    } catch (caught) {
      fail(caught);
    }
  }

  async function remove(id: string): Promise<void> {
    setError(null);
    try {
      await deletePartyApi(id);
      setConfirmingId(null);
      await refresh();
    } catch (caught) {
      fail(caught);
      setConfirmingId(null);
    }
  }

  if (parties === null || adventures === null) return null;
  const deleting = parties.find((party) => party.id === confirmingId);

  return (
    <main className="roster-shell">
      <header className="roster-header">
        <div>
          <span className="eyebrow">{t("parties.title")}</span>
          <h1>{t("parties.title")}</h1>
        </div>
        <div>
          <Button type="button" variant="secondary" onClick={() => void refresh()}>
            {t("parties.refresh")}
          </Button>
          <Button type="button" variant="secondary" onClick={() => setScreen("characters")}>
            {t("editor.back")}
          </Button>
        </div>
      </header>
      {error && <p role="alert">{authErrorText(error)}</p>}

      <section className="roster-card framed" aria-label={t("parties.create.title")}>
        <h2>{t("parties.create.title")}</h2>
        {adventures.length === 0 ? (
          <p>{t("parties.create.none")}</p>
        ) : (
          <>
            <Label htmlFor="party-adventure">{t("parties.create.adventure")}</Label>
            <select
              id="party-adventure"
              value={adventureId}
              onChange={(event) => setAdventureId(event.currentTarget.value)}
            >
              <option value="">—</option>
              {adventures.map((adventure) => (
                <option key={adventure.id} value={adventure.id}>
                  {adventure.title}
                </option>
              ))}
            </select>
            <Label htmlFor="party-name">{t("parties.create.name")}</Label>
            <Input
              id="party-name"
              type="text"
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
            />
            <ColorPicker value={colour} taken={[]} onPick={setColour} />
            <Button type="button" disabled={!adventureId} onClick={() => void create()}>
              {t("parties.create.submit")}
            </Button>
          </>
        )}
      </section>

      <section className="roster-grid" aria-label={t("parties.title")}>
        {parties.map((party) => (
          <article key={party.id} className="roster-card framed">
            <div className="roster-card__identity">
              <h2>{party.name ?? party.adventureTitle}</h2>
              <span>
                {t("parties.slots", { used: party.colors.length, max: party.maxPlayers })}
                {party.status === "completed" ? ` · ${t("parties.completed")}` : ""}
              </span>
              <fieldset className="party-colours" aria-label={t("party.color.label")}>
                {party.colors.map((colour) => (
                  <span key={colour} className={`party-colour party-colour--${colour}`} />
                ))}
              </fieldset>
            </div>
            <div className="roster-card__actions">
              {party.mine ? (
                <Button type="button" onClick={() => enter(party)}>
                  {t("parties.enter")}
                </Button>
              ) : party.colors.length < party.maxPlayers ? (
                joiningId === party.id ? (
                  <ColorPicker
                    value={null}
                    taken={party.colors}
                    onPick={(chosen) => void join(party, chosen)}
                  />
                ) : (
                  <Button type="button" onClick={() => setJoiningId(party.id)}>
                    {t("parties.join")}
                  </Button>
                )
              ) : (
                <span>{t("parties.full")}</span>
              )}
              {party.hostAccountId === accountId && (
                <Button type="button" variant="secondary" onClick={() => setConfirmingId(party.id)}>
                  {t("editor.delete")}
                </Button>
              )}
            </div>
          </article>
        ))}
      </section>

      {deleting && (
        <div className="delete-dialog-backdrop">
          <section
            className="delete-dialog parchment framed"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-party-title"
          >
            <h2 id="delete-party-title">
              {t("parties.delete.title", { name: deleting.name ?? deleting.adventureTitle })}
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
