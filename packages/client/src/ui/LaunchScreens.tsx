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
import { useEffect, useState } from "react";
import {
  type AdventureSummary,
  abandonPartyApi,
  fetchHeroes,
  fetchParties,
  fetchPlayableAdventures,
  type PartyListing,
} from "../api.js";
import { t } from "../i18n.js";
import type { AppRouter } from "./AppRouter.js";
import { Carousel, type CarouselCard } from "./Carousel.js";
import { HeroCreate } from "./HeroCreate.js";

function accentFor(id: string): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 6;
  return h;
}

/**
 * One function per carousel, shared by the route loader (`ui/AppRouter.tsx`) and by the
 * in-component fallback below, so the two paths cannot drift on WHICH parties a screen shows —
 * the filter is the screen's own definition of its list, not the loader's.
 */
export const loadMyParties = async (): Promise<PartyListing[]> =>
  (await fetchParties()).filter((p) => p.mine);

export const loadOpenParties = async (): Promise<PartyListing[]> =>
  (await fetchParties()).filter(
    (p) => !p.mine && p.status === "open" && p.colors.length < p.maxPlayers,
  );

export const loadPlayableAdventures = async (): Promise<AdventureSummary[]> =>
  fetchPlayableAdventures();

/**
 * Resolve a carousel's list from the loader when it has one, and fetch it here when it does not.
 *
 * `null` means "the loader could not produce this", which is NOT the same as an empty list and is
 * exactly the distinction that was missing: the loaders run on the server too, where a relative
 * `fetch("/api/…")` cannot even be parsed into a URL (and could not carry the caller's session
 * cookie if it could), so every hard load of `/play/new` served `adventures: []` and the screen
 * rendered "No playable adventure yet" over a server full of them. Reaching the same screen by
 * client-side navigation worked, which is what made it look like a data problem rather than a
 * rendering one.
 *
 * So the loader stays the fast path — on a client-side navigation the list is ready before the
 * component mounts, no flash, exactly as designed — and this covers the one case it cannot: the
 * first paint after a hard load, a typed URL or a shared link.
 */
function useLaunchList<T>(
  loaded: T[] | null,
  load: () => Promise<T[]>,
): { items: T[]; loading: boolean } {
  const [fetched, setFetched] = useState<T[] | null>(null);
  useEffect(() => {
    if (loaded !== null) return;
    let live = true;
    void load()
      .then((items) => {
        if (live) setFetched(items);
      })
      .catch(() => {
        if (live) setFetched([]);
      });
    return () => {
      live = false;
    };
  }, [loaded, load]);
  const items = loaded ?? fetched;
  return { items: items ?? [], loading: items === null };
}

/** CONTINUE — resume one of my saves straight into the game. */
export function ContinueScreen({ parties }: { parties: PartyListing[] | null }) {
  const router = useRouter<AppRouter>();
  // Task 3: the store's `accountId` field died — every hero/party ownership check now reads the
  // Alepha-authenticated identity directly.
  const { user } = useAuth();
  const accountId = user?.id ?? null;
  const [pending, setPending] = useState<PartyListing | null>(null);
  const [abandoningId, setAbandoningId] = useState<string | null>(null);
  const [abandonError, setAbandonError] = useState(false);
  const [abandonedIds, setAbandonedIds] = useState<Set<string>>(() => new Set());
  const { items, loading } = useLaunchList(parties, loadMyParties);
  const visibleItems = items.filter((party) => !abandonedIds.has(party.id));
  const activeParties = visibleItems.filter((party) => party.status === "open");
  const completedParties = visibleItems.filter((party) => party.status === "completed");

  async function enter(id: string) {
    const party = activeParties.find((p) => p.id === id);
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

  async function abandon(id: string) {
    const party = activeParties.find((candidate) => candidate.id === id);
    if (!party || abandoningId !== null) return;
    if (!window.confirm(t("continue.abandon.confirm", { title: party.adventureTitle }))) return;
    setAbandoningId(id);
    setAbandonError(false);
    try {
      await abandonPartyApi(id);
      setAbandonedIds((current) => new Set(current).add(id));
    } catch {
      setAbandonError(true);
    } finally {
      setAbandoningId(null);
    }
  }

  if (pending) return <HeroCreate party={pending} onBack={() => setPending(null)} />;

  const cards: CarouselCard[] = activeParties.map((p) => ({
    id: p.id,
    title: p.adventureTitle,
    subtitle: t("parties.slots", { used: p.colors.length, max: p.maxPlayers }),
    accent: accentFor(p.adventureId),
    actionLabel: t("continue.abandon"),
    actionDisabled: abandoningId !== null,
  }));

  return (
    <Carousel
      title={t("menu.continue")}
      cards={cards}
      emptyLabel={loading ? t("common.loading") : t("continue.empty")}
      onSelect={(id) => void enter(id)}
      onAction={(id) => void abandon(id)}
      onBack={() => void router.push("menu")}
      secondaryContent={
        abandonError || completedParties.length > 0 ? (
          <div className="continue-secondary">
            {abandonError ? (
              <p className="continue-abandon-error" role="alert">
                {t("continue.abandon.error")}
              </p>
            ) : null}
            {completedParties.length > 0 ? (
              <section className="continue-archive" aria-labelledby="continue-archive-title">
                <h2 id="continue-archive-title" className="continue-archive__title">
                  {t("continue.archive.title")}
                </h2>
                <ul className="continue-archive__list">
                  {completedParties.map((party) => (
                    <li key={party.id} className="continue-archive__item">
                      <span className="continue-archive__name">{party.adventureTitle}</span>
                      <span className="continue-archive__status">{t("parties.completed")}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        ) : null
      }
    />
  );
}

/** NEW — pick an adventure, then create a hero for a fresh party. */
export function NewGameScreen({ adventures }: { adventures: AdventureSummary[] | null }) {
  const router = useRouter<AppRouter>();
  const [pickedId, setPickedId] = useState<string | null>(null);
  const { items, loading } = useLaunchList(adventures, loadPlayableAdventures);

  if (pickedId) return <HeroCreate adventureId={pickedId} onBack={() => setPickedId(null)} />;

  const cards: CarouselCard[] = items.map((a) => ({
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
      emptyLabel={loading ? t("common.loading") : t("new.empty")}
      onSelect={setPickedId}
      onBack={() => void router.push("menu")}
    />
  );
}

/** JOIN — pick another player's open party, then create a hero in it. */
export function JoinScreen({ parties }: { parties: PartyListing[] | null }) {
  const router = useRouter<AppRouter>();
  const [pending, setPending] = useState<PartyListing | null>(null);
  const { items, loading } = useLaunchList(parties, loadOpenParties);

  if (pending) return <HeroCreate party={pending} onBack={() => setPending(null)} />;

  const cards: CarouselCard[] = items.map((p) => ({
    id: p.id,
    title: p.adventureTitle,
    subtitle: t("parties.slots", { used: p.colors.length, max: p.maxPlayers }),
    accent: accentFor(p.adventureId),
  }));

  return (
    <Carousel
      title={t("menu.join")}
      cards={cards}
      emptyLabel={loading ? t("common.loading") : t("join.empty")}
      onSelect={(id) => {
        const party = items.find((p) => p.id === id);
        if (party) setPending(party);
      }}
      onBack={() => void router.push("menu")}
    />
  );
}
