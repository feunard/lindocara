import { useEffect, useState } from "react";
import { Button } from "@/ui/pixelact-ui/button/index.js";
import { Input } from "@/ui/pixelact-ui/input.js";
import { Label } from "@/ui/pixelact-ui/label.js";
import { PLAYER_CLASSES } from "../../shared/game.js";
import {
  api,
  authErrorText,
  type CharacterSummary,
  errorCode,
  fetchCharacters,
  logout,
  MAX_CHARACTERS,
} from "../api.js";
import { t, useLocale } from "../i18n.js";
import { useUiStore } from "../store.js";

const APPEARANCES = ["azure", "ember", "moss", "violet"] as const;

export function CharacterSelect({ onPlay }: { onPlay(character: CharacterSummary): void }) {
  useLocale();
  const characters = useUiStore((s) => s.characters);
  const setCharacters = useUiStore((s) => s.setCharacters);
  const setScreen = useUiStore((s) => s.setScreen);
  const [creating, setCreating] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (characters !== null) return;
    // A 204 response (as a test double may return for every stubbed call, including this
    // refetch) parses to `undefined`, not an empty list — never let that corrupt the
    // "null means loading" sentinel the render guard below relies on.
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
    if (confirmingId !== id) {
      setConfirmingId(id);
      return;
    }
    await api(`/api/characters/${id}`, { method: "DELETE" }).catch(() => undefined);
    setCharacters(null);
    setConfirmingId(null);
  }

  async function submitCreate(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      await api<CharacterSummary>("/api/characters", {
        method: "POST",
        body: JSON.stringify({
          name: data.get("name"),
          appearance: data.get("appearance"),
          class: data.get("class"),
        }),
      });
      form.reset();
      setCreating(false);
      setCharacters(null);
    } catch (caught) {
      setError(errorCode(caught));
    }
  }

  return (
    <div className="fixed inset-0 grid place-items-center">
      <div className="framed parchment flex w-full max-w-2xl flex-col gap-4 p-6">
        <header className="flex items-center justify-between">
          <h2>{t("chars.title")}</h2>
          <Button type="button" onClick={() => void logout()}>
            {t("chars.logout")}
          </Button>
        </header>
        <div id="character-list">
          {characters.map((character) => (
            <article key={character.id} className="character-card">
              <span className={`swatch swatch--${character.appearance}`} aria-hidden="true" />
              <strong>{character.name}</strong>
              <span>{t(`class.${character.class}`)}</span>
              <span>{t("hud.level", { level: character.level })}</span>
              <Button type="button" onClick={() => onPlay(character)}>
                {t("chars.play")}
              </Button>
              <Button type="button" className="danger" onClick={() => void remove(character.id)}>
                {confirmingId === character.id ? t("chars.delete_confirm") : t("chars.delete")}
              </Button>
            </article>
          ))}
          <button
            type="button"
            className="character-card character-card--new"
            disabled={characters.length >= MAX_CHARACTERS}
            onClick={() => setCreating(true)}
          >
            {t("chars.new")}
          </button>
        </div>
        {creating && (
          <form onSubmit={submitCreate} className="flex flex-col gap-3">
            <h3>{t("chars.create.title")}</h3>
            <div>
              <Label htmlFor="character-name">{t("chars.create.name")}</Label>
              <Input
                id="character-name"
                name="name"
                type="text"
                minLength={2}
                maxLength={16}
                pattern="[A-Za-z0-9_\-]{2,16}"
                autoComplete="off"
                required
              />
            </div>
            <fieldset id="appearance-picker">
              <legend>{t("chars.create.appearance")}</legend>
              {APPEARANCES.map((appearance) => (
                <label key={appearance} className={`swatch swatch--${appearance}`}>
                  <input
                    type="radio"
                    name="appearance"
                    value={appearance}
                    defaultChecked={appearance === "azure"}
                  />
                  <span>{t(`appearance.${appearance}`)}</span>
                </label>
              ))}
            </fieldset>
            <fieldset id="class-picker">
              <legend>{t("chars.create.class")}</legend>
              {PLAYER_CLASSES.map((klass) => (
                <label key={klass}>
                  <input
                    type="radio"
                    name="class"
                    value={klass}
                    defaultChecked={klass === "warrior"}
                  />
                  <span>
                    <strong>{t(`class.${klass}`)}</strong>
                    <small>{t(`class.${klass}.blurb`)}</small>
                  </span>
                </label>
              ))}
            </fieldset>
            <Button type="submit">{t("chars.create.submit")}</Button>
            <Button type="button" onClick={() => setCreating(false)}>
              {t("chars.create.cancel")}
            </Button>
            {error && <p role="alert">{authErrorText(error)}</p>}
          </form>
        )}
      </div>
    </div>
  );
}
