/**
 * The three launch flows behind the main menu, all built from the shared Carousel:
 *   Continue → my saved parties (each = an adventure + my hero) → enter the game directly.
 *   New      → an adventure carousel → HeroCreate (creates the party, auto colour) → game.
 *   Join     → other players' open parties → HeroCreate (joins) → game.
 */
import { useEffect, useState } from "react";
import {
  type AdventureSummary,
  fetchHeroes,
  fetchParties,
  fetchPlayableAdventures,
  type PartyListing,
} from "../api.js";
import { t } from "../i18n.js";
import { useUiStore } from "../store.js";
import { Carousel, type CarouselCard } from "./Carousel.js";
import { HeroCreate } from "./HeroCreate.js";

function accentFor(id: string): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 6;
  return h;
}

/** CONTINUE — resume one of my saves straight into the game. */
export function ContinueScreen() {
  const setScreen = useUiStore((s) => s.setScreen);
  const accountId = useUiStore((s) => s.accountId);
  const [parties, setParties] = useState<PartyListing[] | null>(null);
  const [pending, setPending] = useState<PartyListing | null>(null);

  useEffect(() => {
    void fetchParties()
      .then((all) => setParties(all.filter((p) => p.mine)))
      .catch(() => setParties([]));
  }, []);

  async function enter(id: string) {
    const party = parties?.find((p) => p.id === id);
    if (!party) return;
    const heroes = await fetchHeroes(party.id);
    const mine = heroes.find((h) => h.accountId === accountId);
    if (mine) {
      const { startGameAsHero } = await import("../game/session.js");
      await startGameAsHero(mine, party);
    } else {
      setPending(party); // a save with no hero yet — create one in it
    }
  }

  if (pending) return <HeroCreate party={pending} onBack={() => setPending(null)} />;

  const cards: CarouselCard[] = (parties ?? []).map((p) => ({
    id: p.id,
    title: p.adventureTitle,
    subtitle:
      p.status === "completed"
        ? t("parties.completed")
        : t("parties.slots", { used: p.colors.length, max: p.maxPlayers }),
    accent: accentFor(p.adventureId),
  }));

  return (
    <Carousel
      title={t("menu.continue")}
      cards={cards}
      loading={parties === null}
      emptyLabel={t("continue.empty")}
      onSelect={(id) => void enter(id)}
      onBack={() => setScreen("menu")}
    />
  );
}

/** NEW — pick an adventure, then create a hero for a fresh party. */
export function NewGameScreen() {
  const setScreen = useUiStore((s) => s.setScreen);
  const [adventures, setAdventures] = useState<AdventureSummary[] | null>(null);
  const [pickedId, setPickedId] = useState<string | null>(null);

  useEffect(() => {
    void fetchPlayableAdventures()
      .then(setAdventures)
      .catch(() => setAdventures([]));
  }, []);

  if (pickedId) return <HeroCreate adventureId={pickedId} onBack={() => setPickedId(null)} />;

  const cards: CarouselCard[] = (adventures ?? []).map((a) => ({
    id: a.id,
    title: a.title,
    subtitle: a.author
      ? `${t("new.maps", { count: a.mapCount })} · ${t("new.by", { author: a.author })}`
      : t("new.maps", { count: a.mapCount }),
    accent: accentFor(a.id),
  }));

  return (
    <Carousel
      title={t("menu.new")}
      cards={cards}
      loading={adventures === null}
      emptyLabel={t("new.empty")}
      onSelect={setPickedId}
      onBack={() => setScreen("menu")}
    />
  );
}

/** JOIN — pick another player's open party, then create a hero in it. */
export function JoinScreen() {
  const setScreen = useUiStore((s) => s.setScreen);
  const [parties, setParties] = useState<PartyListing[] | null>(null);
  const [pending, setPending] = useState<PartyListing | null>(null);

  useEffect(() => {
    void fetchParties()
      .then((all) =>
        setParties(
          all.filter((p) => !p.mine && p.status === "open" && p.colors.length < p.maxPlayers),
        ),
      )
      .catch(() => setParties([]));
  }, []);

  if (pending) return <HeroCreate party={pending} onBack={() => setPending(null)} />;

  const cards: CarouselCard[] = (parties ?? []).map((p) => ({
    id: p.id,
    title: p.adventureTitle,
    subtitle: t("parties.slots", { used: p.colors.length, max: p.maxPlayers }),
    accent: accentFor(p.adventureId),
  }));

  return (
    <Carousel
      title={t("menu.join")}
      cards={cards}
      loading={parties === null}
      emptyLabel={t("join.empty")}
      onSelect={(id) => {
        const party = parties?.find((p) => p.id === id);
        if (party) setPending(party);
      }}
      onBack={() => setScreen("menu")}
    />
  );
}
