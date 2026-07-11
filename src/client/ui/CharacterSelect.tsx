import { useEffect, useState } from "react";
import { api, type CharacterSummary, fetchCharacters, logout, MAX_CHARACTERS } from "../api.js";
import { t, useLocale } from "../i18n.js";
import { useUiStore } from "../store.js";
import { CharacterCreator } from "./CharacterCreator.js";
import { CharacterPreview } from "./CharacterPreview.js";
import { Button } from "./pixelact-ui/button/index.js";

export function CharacterSelect({ onPlay }: { onPlay(character: CharacterSummary): void }) {
  useLocale();
  const characters = useUiStore((state) => state.characters);
  const setCharacters = useUiStore((state) => state.setCharacters);
  const setScreen = useUiStore((state) => state.setScreen);
  const [creating, setCreating] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  useEffect(() => {
    if (characters !== null) return;
    fetchCharacters().then(
      (fetched) => setCharacters(fetched ?? []),
      () => setScreen("auth"),
    );
  }, [characters, setCharacters, setScreen]);

  useEffect(() => {
    if (characters !== null && characters.length === 0) setCreating(true);
  }, [characters]);

  if (characters === null) return null;

  async function remove(id: string): Promise<void> {
    await api(`/api/characters/${id}`, { method: "DELETE" }).catch(() => undefined);
    setConfirmingId(null);
    setCharacters(null);
  }

  if (creating) {
    return (
      <CharacterCreator
        onCancel={() => setCreating(false)}
        onCreated={(character) => {
          setCharacters([...characters, character]);
          setCreating(false);
        }}
      />
    );
  }

  const deleting = characters.find((character) => character.id === confirmingId);
  return (
    <main className="roster-shell">
      <header className="roster-header">
        <div>
          <span className="eyebrow">{t("chars.roster.eyebrow")}</span>
          <h1>{t("chars.title")}</h1>
          <p>{t("chars.roster.subtitle")}</p>
        </div>
        <Button type="button" variant="secondary" onClick={() => void logout()}>
          {t("chars.logout")}
        </Button>
      </header>

      <section className="roster-grid" aria-label={t("chars.title")}>
        {characters.map((character) => (
          <article key={character.id} className="roster-card framed">
            <div className="roster-card__preview">
              <CharacterPreview
                appearance={character.appearance}
                equipment={character.equipment}
                compact
                label={t("chars.preview.label", {
                  class: t(`class.${character.class}`),
                  color: t(`appearance.${character.appearance.primaryColor}`),
                })}
              />
            </div>
            <div className="roster-card__identity">
              <span>{t("hud.level", { level: character.level })}</span>
              <h2>{character.name}</h2>
              <p>{t(`class.${character.class}`)}</p>
            </div>
            <dl>
              <div>
                <dt>{t("chars.weapon")}</dt>
                <dd>{t(`item.${character.equipment.mainHand}`)}</dd>
              </div>
              <div>
                <dt>{t("chars.appearance")}</dt>
                <dd>{t(`appearance.${character.appearance.primaryColor}`)}</dd>
              </div>
            </dl>
            <div className="roster-card__actions">
              <Button type="button" onClick={() => onPlay(character)}>
                {t("chars.play")}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setConfirmingId(character.id)}
              >
                {t("chars.delete")}
              </Button>
            </div>
          </article>
        ))}
        <button
          type="button"
          className="roster-card roster-card--new framed"
          disabled={characters.length >= MAX_CHARACTERS}
          onClick={() => setCreating(true)}
        >
          <span aria-hidden="true">+</span>
          <strong>{t("chars.new")}</strong>
          <small>{t("chars.slots", { count: characters.length, max: MAX_CHARACTERS })}</small>
        </button>
      </section>

      {deleting && (
        <div className="delete-dialog-backdrop">
          <section
            className="delete-dialog parchment framed"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-title"
          >
            <span className="eyebrow">{t("chars.delete.warning")}</span>
            <h2 id="delete-title">{t("chars.delete.title", { name: deleting.name })}</h2>
            <p>{t("chars.delete.copy")}</p>
            <div>
              <Button type="button" variant="secondary" onClick={() => setConfirmingId(null)}>
                {t("chars.delete.cancel")}
              </Button>
              <Button type="button" className="danger" onClick={() => void remove(deleting.id)}>
                {t("chars.delete.confirm")}
              </Button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
