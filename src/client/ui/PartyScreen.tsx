import { useEffect, useState } from "react";
import { TinyButton } from "@/ui/tiny-swords/TinyButton.js";
import { TinyFieldSelect } from "@/ui/tiny-swords/TinyFieldSelect.js";
import { TinyInput } from "@/ui/tiny-swords/TinyInput.js";
import { TinyLabel } from "@/ui/tiny-swords/TinyLabel.js";
import type { PlayerClass } from "../../shared/game.js";
import { HERO_CLASSES, MAX_HEROES_PER_PARTY } from "../../shared/hero.js";
import {
  authErrorText,
  createHeroApi,
  deleteHeroApi,
  errorCode,
  fetchHeroes,
  type StoredHero,
} from "../api.js";
import { startGameAsHero } from "../game/session.js";
import { t, useLocale } from "../i18n.js";
import { useUiStore } from "../store.js";

function isSessionError(code: string): boolean {
  return code === "session_expired" || code === "unauthorized";
}

export function PartyScreen() {
  useLocale();
  const party = useUiStore((s) => s.activeParty);
  const setScreen = useUiStore((s) => s.setScreen);
  const setActiveParty = useUiStore((s) => s.setActiveParty);
  const [heroes, setHeroes] = useState<StoredHero[] | null>(null);
  const [name, setName] = useState("");
  const [heroClass, setHeroClass] = useState<PlayerClass>("warrior");
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const partyId = party?.id ?? null;

  // biome-ignore lint/correctness/useExhaustiveDependencies: refetch when the party changes
  useEffect(() => {
    if (!partyId) return;
    void refresh(partyId);
  }, [partyId]);

  // A reload can land here with no active party; send the user back to the list.
  useEffect(() => {
    if (!party) setScreen("parties");
  }, [party, setScreen]);

  function fail(caught: unknown): void {
    const code = errorCode(caught);
    if (isSessionError(code)) setScreen("auth");
    else setError(code);
  }

  async function refresh(id: string): Promise<void> {
    setError(null);
    try {
      setHeroes(await fetchHeroes(id));
    } catch (caught) {
      fail(caught);
      setHeroes((current) => current ?? []);
    }
  }

  function leave(): void {
    setActiveParty(null);
    setScreen("parties");
  }

  async function create(): Promise<void> {
    if (!partyId || name.trim().length === 0 || creating) return;
    setError(null);
    setCreating(true);
    try {
      await createHeroApi(partyId, { name: name.trim(), class: heroClass });
      setName("");
      await refresh(partyId);
    } catch (caught) {
      fail(caught);
    } finally {
      setCreating(false);
    }
  }

  async function remove(heroId: string): Promise<void> {
    if (!partyId) return;
    setError(null);
    try {
      await deleteHeroApi(partyId, heroId);
      setConfirmingId(null);
      await refresh(partyId);
    } catch (caught) {
      fail(caught);
      setConfirmingId(null);
    }
  }

  function play(hero: StoredHero): void {
    if (!party) return;
    setScreen("game");
    void startGameAsHero(hero, party);
  }

  if (!party || heroes === null) return null;
  const deleting = heroes.find((hero) => hero.id === confirmingId);

  return (
    <main className="roster-shell">
      <header className="roster-header">
        <div>
          <span className="eyebrow">{t("party.eyebrow")}</span>
          <h1>{party.name ?? party.adventureTitle}</h1>
        </div>
        <TinyButton type="button" variant="secondary" onClick={leave}>
          {t("party.roster.leave")}
        </TinyButton>
      </header>
      {error && <p role="alert">{authErrorText(error)}</p>}

      <section className="roster-grid" aria-label={t("party.heroes")}>
        {heroes.map((hero) => (
          <article key={hero.id} className="roster-card framed">
            <div className="roster-card__identity">
              <span className={`party-colour party-colour--${party.myColor ?? "blue"}`} />
              <h2>{hero.name}</h2>
              <span>{t(`class.${hero.class}`)}</span>
            </div>
            <div className="roster-card__actions">
              <TinyButton type="button" onClick={() => play(hero)}>
                {t("party.hero.play")}
              </TinyButton>
              <TinyButton
                type="button"
                variant="secondary"
                onClick={() => setConfirmingId(hero.id)}
              >
                {t("editor.delete")}
              </TinyButton>
            </div>
          </article>
        ))}
      </section>

      {heroes.length < MAX_HEROES_PER_PARTY && (
        <section className="roster-card framed" aria-label={t("party.create.title")}>
          <h2>{t("party.create.title")}</h2>
          <TinyLabel htmlFor="hero-name">{t("party.create.name")}</TinyLabel>
          <TinyInput
            id="hero-name"
            type="text"
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
          />
          <TinyLabel htmlFor="hero-class">{t("party.create.class")}</TinyLabel>
          <TinyFieldSelect
            id="hero-class"
            value={heroClass}
            onChange={(event) => setHeroClass(event.currentTarget.value as PlayerClass)}
          >
            {HERO_CLASSES.map((option) => (
              <option key={option} value={option}>
                {t(`class.${option}`)}
              </option>
            ))}
          </TinyFieldSelect>
          <TinyButton
            type="button"
            disabled={creating || name.trim().length === 0}
            onClick={() => void create()}
          >
            {t("party.create.submit")}
          </TinyButton>
        </section>
      )}

      {deleting && (
        <div className="delete-dialog-backdrop">
          <section
            className="delete-dialog parchment framed"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-hero-title"
          >
            <h2 id="delete-hero-title">{t("party.delete.title", { name: deleting.name })}</h2>
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
