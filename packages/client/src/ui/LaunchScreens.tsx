/**
 * The three launch flows behind the main menu, all built from the shared Carousel:
 *   Continue → my saved parties (each = an adventure + my hero) → enter the game directly.
 *   New      → an adventure carousel → HeroCreate (creates the party, auto colour) → game.
 *   Join     → other players' open parties → HeroCreate (joins) → game.
 *
 * The party/adventure list for each screen is loader data (`ui/AppRouter.tsx`'s `playContinue`/
 * `playNew`/`playJoin`), not a local `useEffect` fetch — it is ready before the component mounts, so
 * none of the three carries a `loading` state for its own list any more. `HeroCreate`'s `pending`/
 * `pickedId` sub-screen selection stays local `useState` (no URL for it — YAGNI, see the plan);
 * "Back" from a carousel is a real navigation (`router.push("menu")`), while "Back" from `HeroCreate`
 * just clears the local pick and returns to the carousel already on screen.
 */
import { useAuth } from "alepha/react/auth";
import { useRouter } from "alepha/react/router";
import { useState } from "react";
import { type AdventureSummary, fetchHeroes, type PartyListing } from "../api.js";
import { t } from "../i18n.js";
import type { AppRouter } from "./AppRouter.js";
import { Carousel, type CarouselCard } from "./Carousel.js";
import { HeroCreate } from "./HeroCreate.js";

function accentFor(id: string): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 6;
  return h;
}

/** CONTINUE — resume one of my saves straight into the game. */
export function ContinueScreen({ parties }: { parties: PartyListing[] }) {
  const router = useRouter<AppRouter>();
  // Task 3: the store's `accountId` field died — every hero/party ownership check now reads the
  // Alepha-authenticated identity directly.
  const { user } = useAuth();
  const accountId = user?.id ?? null;
  const [pending, setPending] = useState<PartyListing | null>(null);

  async function enter(id: string) {
    const party = parties.find((p) => p.id === id);
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

  const cards: CarouselCard[] = parties.map((p) => ({
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
      emptyLabel={t("continue.empty")}
      onSelect={(id) => void enter(id)}
      onBack={() => void router.push("menu")}
    />
  );
}

/** NEW — pick an adventure, then create a hero for a fresh party. */
export function NewGameScreen({ adventures }: { adventures: AdventureSummary[] }) {
  const router = useRouter<AppRouter>();
  const [pickedId, setPickedId] = useState<string | null>(null);

  if (pickedId) return <HeroCreate adventureId={pickedId} onBack={() => setPickedId(null)} />;

  const cards: CarouselCard[] = adventures.map((a) => ({
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
      emptyLabel={t("new.empty")}
      onSelect={setPickedId}
      onBack={() => void router.push("menu")}
    />
  );
}

/** JOIN — pick another player's open party, then create a hero in it. */
export function JoinScreen({ parties }: { parties: PartyListing[] }) {
  const router = useRouter<AppRouter>();
  const [pending, setPending] = useState<PartyListing | null>(null);

  if (pending) return <HeroCreate party={pending} onBack={() => setPending(null)} />;

  const cards: CarouselCard[] = parties.map((p) => ({
    id: p.id,
    title: p.adventureTitle,
    subtitle: t("parties.slots", { used: p.colors.length, max: p.maxPlayers }),
    accent: accentFor(p.adventureId),
  }));

  return (
    <Carousel
      title={t("menu.join")}
      cards={cards}
      emptyLabel={t("join.empty")}
      onSelect={(id) => {
        const party = parties.find((p) => p.id === id);
        if (party) setPending(party);
      }}
      onBack={() => void router.push("menu")}
    />
  );
}
