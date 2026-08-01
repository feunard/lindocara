/**
 * `AdventureStateService.claimQuestReward` — direct unit-level coverage of the epoch-fenced
 * reward-claim sequence (`PartyRoom.completeAuthoredQuest` is the only production caller, and
 * `party-room.test.ts` already covers that integration; this file isolates the service itself).
 *
 * Per code review on Task 3: the item consume/grant statements originally carried NO
 * `hero.session_epoch` fence of their own (unlike the hero-core statement right above them),
 * unlike the repo-wide invariant "every hero child-table mutation must include an EXISTS fence
 * against hero.session_epoch". They now re-check `hero.session_epoch = ?` in their own
 * `WHERE`/`EXISTS`, exactly like the hero-core statement, so a reconnect (epoch bump) landing
 * between the claim insert and those statements makes them a no-op rather than a stale-session
 * item mutation.
 *
 * True interleaved-race coverage — bump the epoch AFTER the claim insert but BEFORE the item
 * statements, mid-call — is not reachable through the public surface without adding a test-only
 * hook to production code, which is explicitly out of bounds here. The behavioral proof below
 * (a stale `sessionEpoch` supplied up front) is the sanctioned fallback: it exercises the exact
 * same fence expression every downstream statement (hero core, item consume, item grant) shares,
 * proving the whole sequence — including the item statements specifically — mutates nothing.
 */

import { UserController } from "alepha/api/users";
import { $repository } from "alepha/orm";
import { ServerProvider } from "alepha/server";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { authoredQuestRewardClaims } from "../src/api/entities/authoredQuestRewardClaims.ts";
import { harvestGoldClaims } from "../src/api/entities/harvestGoldClaims.ts";
import { heroes } from "../src/api/entities/heroes.ts";
import { heroItems } from "../src/api/entities/heroItems.ts";
import { AdventureStateService } from "../src/api/services/AdventureStateService.ts";
import { createTestApp } from "./helpers.ts";

const PASSWORD = "Sup3rSecret";
const HEALTH_POTION_ID = "health_potion";

class SeedProbe {
  heroes = $repository(heroes);
  heroItems = $repository(heroItems);
  authoredQuestRewardClaims = $repository(authoredQuestRewardClaims);
  harvestGoldClaims = $repository(harvestGoldClaims);
}

let alepha: ReturnType<typeof createTestApp>;
let probe: SeedProbe;
let service: AdventureStateService;
let hostname: string;
let userCount = 0;

beforeEach(async () => {
  alepha = createTestApp();
  probe = alepha.inject(SeedProbe);
  service = alepha.inject(AdventureStateService);
  await alepha.start();
  hostname = alepha.inject(ServerProvider).hostname;
});

afterEach(async () => {
  await alepha.stop();
});

async function registerAndLogin(prefix: string): Promise<{ token: string }> {
  userCount += 1;
  const username = `${prefix}${userCount}`;
  const users = alepha.inject(UserController);
  const intent = await users.createRegistrationIntent.fetch({
    body: { username, password: PASSWORD },
  });
  await users.createUserFromIntent.fetch({ body: { intentId: intent.data.intentId } });
  const login = await fetch(`${hostname}/_auth/token?provider=credentials`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: PASSWORD }),
  });
  const tokens = (await login.json()) as { access_token: string };
  return { token: tokens.access_token };
}

function authedFetch(path: string, token: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${hostname}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });
}

/** Creates one fresh hero end-to-end (account, adventure, party, hero) and returns its id. */
async function newHero(prefix: string): Promise<{ heroId: string; partyId: string }> {
  const { token } = await registerAndLogin(prefix);
  const adventureResponse = await authedFetch("/api/adventures", token, {
    method: "POST",
    body: JSON.stringify({ title: "Donjon", maxPlayers: 4 }),
  });
  expect(adventureResponse.status).toBe(201);
  const adventure = (await adventureResponse.json()) as { id: string };
  const partyResponse = await authedFetch("/api/parties", token, {
    method: "POST",
    body: JSON.stringify({ adventureId: adventure.id }),
  });
  expect(partyResponse.status).toBe(201);
  const party = (await partyResponse.json()) as { id: string };
  const heroResponse = await authedFetch(`/api/parties/${party.id}/heroes`, token, {
    method: "POST",
    body: JSON.stringify({ name: "Mira", class: "priest" }),
  });
  expect(heroResponse.status).toBe(201);
  const hero = (await heroResponse.json()) as { id: string };
  return { heroId: hero.id, partyId: party.id };
}

describe("claimQuestReward", () => {
  test("a stale sessionEpoch mutates nothing: no claim row, no hero-core change, no item change", async () => {
    const { heroId } = await newHero("claimstale");
    const heroBefore = await probe.heroes.findById(heroId);
    const itemsBefore = await probe.heroItems.findMany({ where: { heroId: { eq: heroId } } });

    const claimed = await service.claimQuestReward({
      ownerKind: "personal",
      ownerId: heroId,
      heroId,
      sessionEpoch: (heroBefore?.sessionEpoch ?? 0) + 1,
      questId: "0001",
      attempt: 1,
      resultingLevel: 2,
      resultingXp: 999,
      resultingHp: 200,
      gold: 50,
      // Exercises BOTH the grant statement and the consume statement — the two that lacked their
      // own epoch fence before the fix.
      items: [{ itemId: HEALTH_POTION_ID, quantity: 3 }],
      consumeItems: [{ itemId: HEALTH_POTION_ID, quantity: 1 }],
    });

    expect(claimed).toBe(false);
    const heroAfter = await probe.heroes.findById(heroId);
    expect(heroAfter).toEqual(heroBefore);
    const itemsAfter = await probe.heroItems.findMany({ where: { heroId: { eq: heroId } } });
    expect(itemsAfter).toEqual(itemsBefore);
    const claims = await probe.authoredQuestRewardClaims.findMany({
      where: { ownerId: { eq: heroId }, questId: { eq: "0001" } },
    });
    expect(claims).toHaveLength(0);
  });

  test("the correct sessionEpoch claims once: hero core, consume and grant all apply", async () => {
    const { heroId } = await newHero("claimok");
    const hero = await probe.heroes.findById(heroId);
    const startingPotions =
      (
        await probe.heroItems.findOne({
          where: { heroId: { eq: heroId }, itemDefinitionId: { eq: HEALTH_POTION_ID } },
        })
      )?.quantity ?? 0;

    const claimed = await service.claimQuestReward({
      ownerKind: "personal",
      ownerId: heroId,
      heroId,
      sessionEpoch: hero?.sessionEpoch ?? 0,
      questId: "0001",
      attempt: 1,
      resultingLevel: 2,
      resultingXp: 999,
      resultingHp: 200,
      gold: 50,
      items: [{ itemId: HEALTH_POTION_ID, quantity: 3 }],
      consumeItems: [{ itemId: HEALTH_POTION_ID, quantity: 1 }],
    });

    expect(claimed).toBe(true);
    const heroAfter = await probe.heroes.findById(heroId);
    expect(heroAfter).toMatchObject({ gold: 50, level: 2, xp: 999, hp: 200 });
    const potionsAfter = await probe.heroItems.findOne({
      where: { heroId: { eq: heroId }, itemDefinitionId: { eq: HEALTH_POTION_ID } },
    });
    // net +2: +3 granted, -1 consumed, applied against whatever the hero started with.
    expect(potionsAfter?.quantity).toBe(startingPotions + 2);
    const claims = await probe.authoredQuestRewardClaims.findMany({
      where: { ownerId: { eq: heroId }, questId: { eq: "0001" } },
    });
    expect(claims).toHaveLength(1);
  });
});

describe("claimHarvestGold", () => {
  const NODE_ID = "33333333-3333-4333-8333-333333333333";

  test("credits existing hero gold once per party-node generation", async () => {
    const { heroId, partyId } = await newHero("goldok");
    await probe.heroes.updateById(heroId, { gold: 17 });
    const hero = await probe.heroes.findById(heroId);
    const claim = {
      partyId,
      heroId,
      sessionEpoch: hero?.sessionEpoch ?? 0,
      nodeId: NODE_ID,
      generation: 0,
      amount: 25,
    };

    expect(await service.claimHarvestGold(claim)).toBe(true);
    expect(await service.claimHarvestGold(claim)).toBe(false);
    expect((await probe.heroes.findById(heroId))?.gold).toBe(42);

    const firstGenerationClaims = await probe.harvestGoldClaims.findMany({
      where: {
        partyId: { eq: partyId },
        nodeId: { eq: NODE_ID },
        generation: { eq: 0 },
      },
    });
    expect(firstGenerationClaims).toHaveLength(1);
    expect(firstGenerationClaims[0]).toMatchObject({
      partyId,
      nodeId: NODE_ID,
      generation: 0,
      recipientHeroId: heroId,
      amount: 25,
    });

    expect(await service.claimHarvestGold({ ...claim, generation: 1 })).toBe(true);
    expect((await probe.heroes.findById(heroId))?.gold).toBe(67);
    const allClaims = await probe.harvestGoldClaims.findMany({
      where: { partyId: { eq: partyId }, nodeId: { eq: NODE_ID } },
    });
    expect(allClaims).toHaveLength(2);
  });

  test("a stale epoch or mismatched hero or party creates no claim and credits no gold", async () => {
    const { heroId, partyId } = await newHero("goldfence");
    await probe.heroes.updateById(heroId, { gold: 17 });
    const heroBefore = await probe.heroes.findById(heroId);
    const baseClaim = {
      partyId,
      heroId,
      sessionEpoch: heroBefore?.sessionEpoch ?? 0,
      nodeId: NODE_ID,
      generation: 0,
      amount: 25,
    };

    expect(
      await service.claimHarvestGold({
        ...baseClaim,
        sessionEpoch: baseClaim.sessionEpoch + 1,
      }),
    ).toBe(false);
    expect(
      await service.claimHarvestGold({
        ...baseClaim,
        heroId: crypto.randomUUID(),
      }),
    ).toBe(false);
    expect(
      await service.claimHarvestGold({
        ...baseClaim,
        partyId: crypto.randomUUID(),
      }),
    ).toBe(false);

    expect(await probe.heroes.findById(heroId)).toEqual(heroBefore);
    expect(await probe.harvestGoldClaims.findMany()).toHaveLength(0);
  });
});
