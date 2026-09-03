/**
 * Hero creation, controller-first: a name (auto-suggested, editable — never a blocking prompt) and a
 * class chosen from cards. Selecting a class with A both picks it and launches, so a new hero is one
 * D-pad sweep and one button away. Reached from "New" (with an adventure) or "Join" (with a party).
 */

import type { BodyVariant } from "@lindocara/engine/character.js";
import { CLASS_STATS, type PlayerClass } from "@lindocara/engine/game.js";
import { HERO_CLASSES } from "@lindocara/engine/hero.js";
import { playerPortrait } from "@lindocara/renderer/portrait-art.js";
import { type CSSProperties, useState } from "react";

import {
  createHeroApi,
  createPartyApi,
  fetchParties,
  joinPartyApi,
  type PartyListing,
} from "../api.js";
import { t } from "../i18n.js";
import { Hint, MenuHints } from "./MenuHints.js";
import { MenuNav, useMenuItem } from "./tiny-swords/menu-nav.js";

const NAME_POOL = [
  "Elowen",
  "Cade",
  "Brynn",
  "Rowan",
  "Sorrel",
  "Fenn",
  "Wren",
  "Aldric",
  "Maeve",
  "Torin",
];

function suggestName(): string {
  // No Math.random in shared code, but this is client-only UI glue — a throwaway suggestion.
  return NAME_POOL[Math.floor(Math.random() * NAME_POOL.length)] as string;
}

/**
 * The dice re-roll. Draws from the pool minus whatever is on screen, so a click always visibly
 * changes the field — a suggestion that re-suggests itself reads as a broken button.
 */
function rollName(current: string): string {
  const others = NAME_POOL.filter((n) => n !== current.trim());
  const pool = others.length > 0 ? others : NAME_POOL;
  return pool[Math.floor(Math.random() * pool.length)] as string;
}

const CLASS_EMBLEM: Record<PlayerClass, string> = {
  warrior: "⚔",
  ranger: "🏹",
  priest: "✚",
  rogue: "‡",
  peasant: "⚒",
};

const CLASS_PREVIEW_COLOR = {
  warrior: "ember",
  ranger: "moss",
  priest: "azure",
  rogue: "violet",
  peasant: "moss",
} as const;

const BONUS_HERO_PRESENTATION = {
  runic_guardian: {
    name: "hero.bonus.runicGuardian",
    blurb: "hero.bonus.runicGuardian.blurb",
    color: "azure",
  },
  assassin: {
    name: "hero.bonus.assassin",
    blurb: "hero.bonus.assassin.blurb",
    color: "violet",
  },
  peasant: {
    name: "hero.bonus.peasant",
    blurb: "hero.bonus.peasant.blurb",
    color: "moss",
  },
  ranger: {
    name: "hero.bonus.ranger",
    blurb: "hero.bonus.ranger.blurb",
    color: "moss",
  },
} as const satisfies Readonly<
  Record<Exclude<BodyVariant, "wayfarer">, { name: string; blurb: string; color: string }>
>;

/** Player-facing comparison; the editable numeric authority remains `CLASS_STATS`. */
export function classMovementPercent(heroClass: PlayerClass): number {
  return Math.round(
    (CLASS_STATS[heroClass].movementSpeed / CLASS_STATS.warrior.movementSpeed) * 100,
  );
}

function ClassCard({
  heroClass,
  body = "wayfarer",
  order,
  onPick,
  disabled,
}: {
  heroClass: PlayerClass;
  body?: BodyVariant;
  order: number;
  onPick: () => void;
  disabled: boolean;
}) {
  const { focused, ref, itemProps } = useMenuItem({ onActivate: onPick, order, disabled });
  const bonus = body === "wayfarer" ? null : BONUS_HERO_PRESENTATION[body];
  const portrait = playerPortrait(heroClass, {
    body,
    primaryColor: bonus?.color ?? CLASS_PREVIEW_COLOR[heroClass],
  });
  const portraitStyle = {
    backgroundImage: `url("${portrait.source}")`,
    backgroundSize: `${portrait.frames * 100}% ${portrait.directionRows * 100}%`,
  } satisfies CSSProperties;
  return (
    <button
      ref={ref}
      type="button"
      className={`class-card${focused ? " class-card--focused" : ""}`}
      {...itemProps}
    >
      <span
        className="class-card__portrait"
        data-hero-class={heroClass}
        data-hero-body={body}
        aria-hidden="true"
      >
        <span className="class-card__portrait-sprite" style={portraitStyle} />
        <span className="class-card__emblem">{bonus ? "✦" : CLASS_EMBLEM[heroClass]}</span>
      </span>
      <span className="class-card__name">{bonus ? t(bonus.name) : t(`class.${heroClass}`)}</span>
      <span className="class-card__blurb">
        {bonus ? t(bonus.blurb) : t(`class.${heroClass}.blurb`)}
      </span>
      <span className="class-card__stat">
        {t("hero.create.movementSpeed", { percent: classMovementPercent(heroClass) })}
      </span>
    </button>
  );
}

export function HeroCreate({
  adventureId,
  party,
  onBack,
}: {
  /** New game: create a party for this adventure, then the hero. */
  adventureId?: string;
  /** Join: an existing open party to join, then create the hero in it. */
  party?: PartyListing;
  onBack: () => void;
}) {
  const [name, setName] = useState(suggestName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function launch(heroClass: PlayerClass, body: BodyVariant = "wayfarer") {
    const trimmed = name.trim() || suggestName();
    setBusy(true);
    setError(null);
    try {
      let listing: PartyListing | undefined = party;
      if (adventureId) {
        const created = await createPartyApi({ adventureId });
        // The server assigns our colour; fetch the listing back so we launch with the real record.
        listing = (await fetchParties()).find((p) => p.id === created.id);
      } else if (party) {
        await joinPartyApi(party.id);
      }
      if (!listing) throw new Error("party_missing");
      const hero = await createHeroApi(listing.id, {
        name: trimmed,
        class: heroClass,
        ...(body === "wayfarer" ? {} : { body }),
      });
      const { startGameAsHero } = await import("../game/session.js");
      await startGameAsHero(hero, listing);
    } catch {
      setError(t("hero.create.error"));
      setBusy(false);
    }
  }

  return (
    <main className="hero-create">
      <header className="hero-create__head">
        <h1 className="hero-create__title">{t("hero.create.title")}</h1>
        <div className="hero-create__name">
          <label className="hero-create__name-field">
            <span className="hero-create__name-label">{t("hero.create.name")}</span>
            <input
              className="hero-create__name-input"
              value={name}
              maxLength={24}
              onChange={(e) => setName(e.target.value)}
              disabled={busy}
            />
          </label>
          <button
            type="button"
            className="hero-create__name-dice"
            onClick={() => setName(rollName)}
            disabled={busy}
            title={t("hero.create.name.random")}
            aria-label={t("hero.create.name.random")}
          >
            <span aria-hidden="true">🎲</span>
          </button>
        </div>
      </header>

      {error && <p className="hero-create__error">{error}</p>}

      <MenuNav
        orientation="horizontal"
        className="class-track"
        aria-label={t("hero.create.title")}
        onBack={onBack}
      >
        {HERO_CLASSES.map((heroClass, index) => (
          <ClassCard
            key={heroClass}
            heroClass={heroClass}
            order={index}
            disabled={busy}
            onPick={() => void launch(heroClass)}
          />
        ))}
        <ClassCard
          heroClass="warrior"
          body="runic_guardian"
          order={HERO_CLASSES.length}
          disabled={busy}
          onPick={() => void launch("warrior", "runic_guardian")}
        />
        <ClassCard
          heroClass="rogue"
          body="assassin"
          order={HERO_CLASSES.length + 1}
          disabled={busy}
          onPick={() => void launch("rogue", "assassin")}
        />
        <ClassCard
          heroClass="peasant"
          body="peasant"
          order={HERO_CLASSES.length + 2}
          disabled={busy}
          onPick={() => void launch("peasant", "peasant")}
        />
        <ClassCard
          heroClass="ranger"
          body="ranger"
          order={HERO_CLASSES.length + 3}
          disabled={busy}
          onPick={() => void launch("ranger", "ranger")}
        />
      </MenuNav>

      <MenuHints>
        <Hint keyLabel="↔ / D-Pad">{t("menu.hint.navigate")}</Hint>
        <Hint keyLabel="A / Enter">{t("hero.create.hint.start")}</Hint>
        <Hint keyLabel="B / Esc">{t("menu.hint.back")}</Hint>
      </MenuHints>

      <button type="button" className="carousel-screen__back" onClick={onBack} disabled={busy}>
        ‹ {t("menu.back")}
      </button>
    </main>
  );
}
