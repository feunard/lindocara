/**
 * A controller-navigable card carousel — the one visual for picking a save, an adventure or a party
 * to join. Left/right (D-pad or stick) move focus, A selects, B goes back. No dropdowns, no lists.
 */
import type { ReactNode } from "react";
import { t } from "../i18n.js";
import { Hint, MenuHints } from "./MainMenu.js";
import { MenuNav, useMenuItem } from "./tiny-swords/menu-nav.js";

export interface CarouselCard {
  id: string;
  title: string;
  subtitle?: string;
  /** A short glyph/emblem shown on the card face until real cover art exists. */
  emblem?: string;
  /** A stable accent (e.g. per-adventure), 0..5, so cards read as distinct without a colour picker. */
  accent?: number;
}

function Card({
  card,
  order,
  onSelect,
}: {
  card: CarouselCard;
  order: number;
  onSelect: () => void;
}) {
  const { focused, ref, itemProps } = useMenuItem({ onActivate: onSelect, order });
  return (
    <button
      ref={ref}
      type="button"
      className={`carousel-card${focused ? " carousel-card--focused" : ""}`}
      data-accent={card.accent ?? 0}
      {...itemProps}
    >
      <span className="carousel-card__art" aria-hidden="true">
        {card.emblem ?? card.title.slice(0, 1).toUpperCase()}
      </span>
      <span className="carousel-card__title">{card.title}</span>
      {card.subtitle && <span className="carousel-card__subtitle">{card.subtitle}</span>}
    </button>
  );
}

export function Carousel({
  title,
  cards,
  loading,
  emptyLabel,
  onSelect,
  onBack,
  extraHints,
}: {
  title: string;
  cards: CarouselCard[];
  loading?: boolean;
  emptyLabel: string;
  onSelect: (id: string) => void;
  onBack: () => void;
  extraHints?: ReactNode;
}) {
  return (
    <main className="carousel-screen">
      <header className="carousel-screen__head">
        <h1 className="carousel-screen__title">{title}</h1>
      </header>

      {loading ? (
        <p className="carousel-screen__status">{t("common.loading")}</p>
      ) : cards.length === 0 ? (
        <p className="carousel-screen__status">{emptyLabel}</p>
      ) : (
        <MenuNav
          orientation="horizontal"
          className="carousel-track"
          aria-label={title}
          onBack={onBack}
        >
          {cards.map((card, index) => (
            <Card key={card.id} card={card} order={index} onSelect={() => onSelect(card.id)} />
          ))}
        </MenuNav>
      )}

      <MenuHints>
        <Hint keyLabel="↔ / D-Pad">{t("menu.hint.navigate")}</Hint>
        <Hint keyLabel="A / Enter">{t("menu.hint.select")}</Hint>
        <Hint keyLabel="B / Esc">{t("menu.hint.back")}</Hint>
        {extraHints}
      </MenuHints>

      {/* Back is reachable by B/Esc via MenuNav when cards are present; this keeps it clickable for
          mouse users and is the back path while the carousel is empty or loading. */}
      <button type="button" className="carousel-screen__back" onClick={onBack}>
        ‹ {t("menu.back")}
      </button>
    </main>
  );
}
