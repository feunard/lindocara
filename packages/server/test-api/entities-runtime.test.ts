import { UserController } from "alepha/api/users";
import { $repository } from "alepha/orm";
import { afterEach, beforeEach, test } from "vitest";
import { adventures } from "../src/api/entities/adventures.ts";
import { adventureTestSessions } from "../src/api/entities/adventureTestSessions.ts";
import { authoredQuestRewardClaims } from "../src/api/entities/authoredQuestRewardClaims.ts";
import { heroEquipment } from "../src/api/entities/heroEquipment.ts";
import { heroes } from "../src/api/entities/heroes.ts";
import { heroItems } from "../src/api/entities/heroItems.ts";
import { heroQuests } from "../src/api/entities/heroQuests.ts";
import { heroSkills } from "../src/api/entities/heroSkills.ts";
import { itemDefinitions } from "../src/api/entities/itemDefinitions.ts";
import { parties } from "../src/api/entities/parties.ts";
import { partyAdventureStates } from "../src/api/entities/partyAdventureStates.ts";
import { partyMembers } from "../src/api/entities/partyMembers.ts";
import { createTestApp } from "./helpers.ts";

// Meets the realm's default password policy — mirrors `entities-authoring.test.ts`.
const PASSWORD = "Sup3rSecret";

/** Same `$repository`-fields probe idiom as `entities-authoring.test.ts` (Task 6). */
class RuntimeProbe {
  adventures = $repository(adventures);
  parties = $repository(parties);
  partyMembers = $repository(partyMembers);
  heroes = $repository(heroes);
  heroItems = $repository(heroItems);
  heroEquipment = $repository(heroEquipment);
  itemDefinitions = $repository(itemDefinitions);
  heroSkills = $repository(heroSkills);
  heroQuests = $repository(heroQuests);
  authoredQuestRewardClaims = $repository(authoredQuestRewardClaims);
  partyAdventureStates = $repository(partyAdventureStates);
  adventureTestSessions = $repository(adventureTestSessions);
}

let alepha: ReturnType<typeof createTestApp>;
let probe: RuntimeProbe;

beforeEach(async () => {
  alepha = createTestApp();
  probe = alepha.inject(RuntimeProbe);
  await alepha.start();
});

afterEach(async () => {
  await alepha.stop();
});

async function createUser(username: string): Promise<string> {
  const users = alepha.inject(UserController);
  const intent = await users.createRegistrationIntent.fetch({
    body: { username, password: PASSWORD },
  });
  const registered = await users.createUserFromIntent.fetch({
    body: { intentId: intent.data.intentId },
  });
  return registered.data.id;
}

async function createAdventure(userId: string, title: string) {
  return probe.adventures.create({
    userId,
    title,
    graph: JSON.stringify({ start: { mapId: "" }, bindings: [] }),
  });
}

test("party -> adventure FK is restrict: deleting a referenced adventure fails", async ({
  expect,
}) => {
  const userId = await createUser("host1");
  const adventure = await createAdventure(userId, "Restrict Adventure");

  await probe.parties.create({
    adventureId: adventure.id,
    adventureVersion: adventure.version,
    maxPlayers: adventure.maxPlayers,
    hostUserId: userId,
  });

  await expect(probe.adventures.deleteById(adventure.id)).rejects.toThrow();

  const stillThere = await probe.adventures.getById(adventure.id);
  expect(stillThere.id).toBe(adventure.id);
});

test("partyMembers identity is (partyId, userId) with unique color per party", async ({
  expect,
}) => {
  const userId = await createUser("host2");
  const otherUserId = await createUser("member2");
  const adventure = await createAdventure(userId, "Member Adventure");
  const party = await probe.parties.create({
    adventureId: adventure.id,
    adventureVersion: adventure.version,
    maxPlayers: adventure.maxPlayers,
    hostUserId: userId,
  });

  await probe.partyMembers.create({ partyId: party.id, userId, color: "blue" });

  // Same (partyId, userId) is rejected — identity is that pair.
  await expect(
    probe.partyMembers.create({ partyId: party.id, userId, color: "red" }),
  ).rejects.toThrow();

  // Same color, same party, different member is rejected.
  await expect(
    probe.partyMembers.create({ partyId: party.id, userId: otherUserId, color: "blue" }),
  ).rejects.toThrow();

  // Distinct color for a distinct member is fine.
  await probe.partyMembers.create({ partyId: party.id, userId: otherUserId, color: "red" });

  const members = await probe.partyMembers.findMany({ where: { partyId: { eq: party.id } } });
  expect(members).toHaveLength(2);
});

test("hero belongs to (userId, partyId)", async ({ expect }) => {
  const userId = await createUser("host3");
  const adventure = await createAdventure(userId, "Hero Adventure");
  const party = await probe.parties.create({
    adventureId: adventure.id,
    adventureVersion: adventure.version,
    maxPlayers: adventure.maxPlayers,
    hostUserId: userId,
  });

  const hero = await probe.heroes.create({
    partyId: party.id,
    userId,
    name: "Wren",
    class: "ranger",
    mapId: "start-map",
    x: 10,
    y: 20,
  });

  expect(hero.class).toBe("ranger");
  expect(hero.life).toBe("alive");
  expect(hero.level).toBe(1);

  const heroesForPartyAndUser = await probe.heroes.findMany({
    where: { partyId: { eq: party.id }, userId: { eq: userId } },
  });
  expect(heroesForPartyAndUser).toHaveLength(1);
  expect(heroesForPartyAndUser[0]?.id).toBe(hero.id);
});

test("heroEquipment references an owned heroItems row", async ({ expect }) => {
  const userId = await createUser("host4");
  const adventure = await createAdventure(userId, "Equip Adventure");
  const party = await probe.parties.create({
    adventureId: adventure.id,
    adventureVersion: adventure.version,
    maxPlayers: adventure.maxPlayers,
    hostUserId: userId,
  });
  const hero = await probe.heroes.create({
    partyId: party.id,
    userId,
    name: "Bram",
    class: "warrior",
    mapId: "start-map",
    x: 0,
    y: 0,
  });

  // `heroItems.itemDefinitionId` is a real FK onto `itemDefinitions` (Task 10) — the referenced
  // catalogue row must exist first, matching the on-demand seeding `HeroService` does in production.
  await probe.itemDefinitions.create({
    id: "iron_sword",
    type: "weapon",
    stackable: false,
    maxStack: 1,
    equipmentSlot: "main_hand",
    allowedClass: "warrior",
  });
  const item = await probe.heroItems.create({
    heroId: hero.id,
    itemDefinitionId: "iron_sword",
    quantity: 1,
  });

  const equipped = await probe.heroEquipment.create({
    heroId: hero.id,
    slot: "main_hand",
    heroItemId: item.id,
  });
  expect(equipped.heroItemId).toBe(item.id);

  // Same (heroId, slot) is rejected — identity is that pair.
  await expect(
    probe.heroEquipment.create({
      heroId: hero.id,
      slot: "main_hand",
      heroItemId: item.id,
    }),
  ).rejects.toThrow();

  // The same item can't be equipped twice (different slot, same heroItemId).
  await expect(
    probe.heroEquipment.create({
      heroId: hero.id,
      slot: "off_hand",
      heroItemId: item.id,
    }),
  ).rejects.toThrow();
});

test("partyAdventureStates is keyed by partyId", async ({ expect }) => {
  const userId = await createUser("host5");
  const adventure = await createAdventure(userId, "State Adventure");
  const party = await probe.parties.create({
    adventureId: adventure.id,
    adventureVersion: adventure.version,
    maxPlayers: adventure.maxPlayers,
    hostUserId: userId,
  });

  await probe.partyAdventureStates.create({
    partyId: party.id,
    switches: "{}",
    variables: "{}",
    selfSwitches: "{}",
  });

  const state = await probe.partyAdventureStates.getById(party.id);
  expect(state.partyId).toBe(party.id);
  expect(state.quests).toBe("{}");
  expect(state.shopPurchases).toBe("{}");

  // FK cascade: deleting the party deletes its adventure state.
  await probe.parties.deleteById(party.id);
  const statesAfterDelete = await probe.partyAdventureStates.findMany({
    where: { partyId: { eq: party.id } },
  });
  expect(statesAfterDelete).toHaveLength(0);
});

test("adventureTestSessions are unique per user and per party, with expiresAt", async ({
  expect,
}) => {
  const userId = await createUser("host6");
  const adventure = await createAdventure(userId, "Test Session Adventure");
  const party = await probe.parties.create({
    adventureId: adventure.id,
    adventureVersion: adventure.version,
    maxPlayers: adventure.maxPlayers,
    hostUserId: userId,
  });
  const otherParty = await probe.parties.create({
    adventureId: adventure.id,
    adventureVersion: adventure.version,
    maxPlayers: adventure.maxPlayers,
    hostUserId: userId,
  });

  const expiresAt = new Date(Date.now() + 60_000).toISOString();

  await probe.adventureTestSessions.create({
    userId,
    adventureId: adventure.id,
    partyId: party.id,
    expiresAt,
  });

  // A second live session for the same account is rejected.
  await expect(
    probe.adventureTestSessions.create({
      userId,
      adventureId: adventure.id,
      partyId: otherParty.id,
      expiresAt,
    }),
  ).rejects.toThrow();
});

test("authoredQuestRewardClaims round-trip against a recipient hero", async ({ expect }) => {
  const userId = await createUser("host7");
  const adventure = await createAdventure(userId, "Reward Adventure");
  const party = await probe.parties.create({
    adventureId: adventure.id,
    adventureVersion: adventure.version,
    maxPlayers: adventure.maxPlayers,
    hostUserId: userId,
  });
  const hero = await probe.heroes.create({
    partyId: party.id,
    userId,
    name: "Fen",
    class: "priest",
    mapId: "start-map",
    x: 0,
    y: 0,
  });

  const claim = await probe.authoredQuestRewardClaims.create({
    ownerKind: "personal",
    ownerId: hero.id,
    recipientHeroId: hero.id,
    questId: "chest-1",
    attempt: 1,
  });
  expect(claim.attempt).toBe(1);

  // Same (ownerKind, ownerId, questId, attempt) is rejected.
  await expect(
    probe.authoredQuestRewardClaims.create({
      ownerKind: "personal",
      ownerId: hero.id,
      recipientHeroId: hero.id,
      questId: "chest-1",
      attempt: 1,
    }),
  ).rejects.toThrow();
});

test("heroSkills identity is (heroId, skillId) with slot 1-5 and unique slot per hero", async ({
  expect,
}) => {
  const userId = await createUser("host8");
  const adventure = await createAdventure(userId, "Skill Adventure");
  const party = await probe.parties.create({
    adventureId: adventure.id,
    adventureVersion: adventure.version,
    maxPlayers: adventure.maxPlayers,
    hostUserId: userId,
  });
  const hero = await probe.heroes.create({
    partyId: party.id,
    userId,
    name: "Ash",
    class: "rogue",
    mapId: "start-map",
    x: 0,
    y: 0,
  });

  await probe.heroSkills.create({
    heroId: hero.id,
    skillId: "backstab",
    unlocked: true,
    equipped: true,
    slot: 1,
  });

  // Same (heroId, skillId) is rejected.
  await expect(
    probe.heroSkills.create({
      heroId: hero.id,
      skillId: "backstab",
      unlocked: true,
    }),
  ).rejects.toThrow();

  // Same slot for a distinct skill is rejected.
  await expect(
    probe.heroSkills.create({
      heroId: hero.id,
      skillId: "smoke-bomb",
      unlocked: true,
      equipped: true,
      slot: 1,
    }),
  ).rejects.toThrow();
});

test("heroQuests identity is (heroId, questId)", async ({ expect }) => {
  const userId = await createUser("host9");
  const adventure = await createAdventure(userId, "Quest Adventure");
  const party = await probe.parties.create({
    adventureId: adventure.id,
    adventureVersion: adventure.version,
    maxPlayers: adventure.maxPlayers,
    hostUserId: userId,
  });
  const hero = await probe.heroes.create({
    partyId: party.id,
    userId,
    name: "Ivy",
    class: "warrior",
    mapId: "start-map",
    x: 0,
    y: 0,
  });

  await probe.heroQuests.create({ heroId: hero.id, questId: "rescue-1" });

  await expect(probe.heroQuests.create({ heroId: hero.id, questId: "rescue-1" })).rejects.toThrow();

  const quests = await probe.heroQuests.findMany({ where: { heroId: { eq: hero.id } } });
  expect(quests).toHaveLength(1);
  expect(quests[0]?.status).toBe("available");
});
