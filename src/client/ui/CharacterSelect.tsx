import { useEffect, useState } from "react";
import { api, type CharacterSummary, fetchCharacters, logout, MAX_CHARACTERS } from "../api.js";
import { t, useLocale } from "../i18n.js";
import { useUiStore } from "../store.js";
import { CharacterCreator } from "./CharacterCreator.js";
import { CharacterPreview } from "./CharacterPreview.js";
import { Button } from "./pixelact-ui/button/index.js";
import { TinySwordsMenuScene } from "./TinySwordsMenuScene.js";

export function CharacterSelect({ onPlay }: { onPlay(character: CharacterSummary): void }) {
  useLocale();
  const characters = useUiStore((state) => state.characters);
  const setCharacters = useUiStore((state) => state.setCharacters);
  const setScreen = useUiStore((state) => state.setScreen);
  const [creating, setCreating] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewingId, setPreviewingId] = useState<string | null>(null);

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
  const activeId = characters.some((character) => character.id === selectedId)
    ? selectedId
    : (characters[0]?.id ?? null);
  return (
    <main className="roster-shell">
      <TinySwordsMenuScene variant="courtyard" />
      <header className="roster-header">
        <div>
          <span className="eyebrow">{t("chars.roster.eyebrow")}</span>
          <h1>{t("chars.title")}</h1>
          <p>{t("chars.roster.subtitle")}</p>
        </div>
        <div className="roster-header__actions">
          <Button type="button" variant="secondary" onClick={() => setScreen("map-editor")}>
            {t("chars.mapEditor")}
          </Button>
          <Button type="button" variant="secondary" onClick={() => setScreen("adventures")}>
            {t("chars.adventures")}
          </Button>
          <Button type="button" variant="secondary" onClick={() => void logout()}>
            {t("chars.logout")}
          </Button>
        </div>
      </header>

      <section className="roster-grid" aria-label={t("chars.title")} data-count={characters.length}>
        {characters.map((character) => (
          <article
            key={character.id}
            className={`roster-card framed${activeId === character.id ? " roster-card--selected" : ""}`}
            onMouseEnter={() => {
              setSelectedId(character.id);
              setPreviewingId(character.id);
            }}
            onMouseLeave={() => setPreviewingId(null)}
            onFocusCapture={() => setSelectedId(character.id)}
          >
            <button
              type="button"
              className="roster-card__select"
              aria-label={character.name}
              aria-pressed={activeId === character.id}
              onClick={() => setSelectedId(character.id)}
            >
              <span className="roster-card__banner" aria-hidden="true" />
              <span className="roster-card__preview">
                <CharacterPreview
                  appearance={character.appearance}
                  equipment={character.equipment}
                  compact
                  motion={previewingId === character.id ? "attack" : "idle"}
                  label={t("chars.preview.label", {
                    class: t(`class.${character.class}`),
                    color: t(`appearance.${character.appearance.primaryColor}`),
                  })}
                />
              </span>
              <span className="roster-card__identity">
                <span>{t("hud.level", { level: character.level })}</span>
                <strong>{character.name}</strong>
                <small>{t(`class.${character.class}`)}</small>
              </span>
            </button>
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
        {characters.length < MAX_CHARACTERS && (
          <button
            type="button"
            className="roster-card roster-card--new framed"
            onClick={() => setCreating(true)}
          >
            <span aria-hidden="true">+</span>
            <strong>{t("chars.new")}</strong>
            <small>{t("chars.slots", { count: characters.length, max: MAX_CHARACTERS })}</small>
          </button>
        )}
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
            <div className="delete-dialog__actions">
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
