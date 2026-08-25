/**
 * Stable authored identities for the non-human building packs. This module is deliberately data
 * only so both the catalogue and the shared building geometry contract can consume it without a
 * dependency cycle.
 */

export const FACTION_BUILDING_FACTIONS = [
  "goblin",
  "orc-troll",
  "beastfolk",
  "wild-tribe",
] as const;
export type FactionBuildingFaction = (typeof FACTION_BUILDING_FACTIONS)[number];

export const FACTION_BUILDING_PURPOSES = [
  "housing",
  "command",
  "training",
  "community",
  "daily-life",
] as const;
export type FactionBuildingPurpose = (typeof FACTION_BUILDING_PURPOSES)[number];
export type FactionBuildingVariant = "a" | "b";
export type FactionBuildingArchetype = `${FactionBuildingPurpose}-${FactionBuildingVariant}`;

export interface FactionBuildingModel {
  readonly id: `building.lindocara.${FactionBuildingFaction}.${string}`;
  readonly faction: FactionBuildingFaction;
  readonly purpose: FactionBuildingPurpose;
  readonly variant: FactionBuildingVariant;
  readonly archetype: FactionBuildingArchetype;
  readonly width: number;
  readonly depth: number;
  readonly wallHeight: number;
  readonly roofHeight: number;
  readonly roofShape: "gable" | "cone" | "crenellated";
  readonly collisionElevation: 1 | 2 | 3;
}

type ModelInput = Omit<FactionBuildingModel, "id" | "faction" | "archetype"> & {
  readonly slug: string;
};

type PackedModel<Faction extends FactionBuildingFaction, Model extends ModelInput> = Omit<
  Model,
  "slug"
> & {
  readonly id: `building.lindocara.${Faction}.${Model["slug"]}`;
  readonly faction: Faction;
  readonly archetype: `${Model["purpose"]}-${Model["variant"]}`;
};

type PackedModels<Faction extends FactionBuildingFaction, Models extends readonly ModelInput[]> = {
  readonly [Index in keyof Models]: Models[Index] extends ModelInput
    ? PackedModel<Faction, Models[Index]>
    : never;
};

function pack<
  const Faction extends FactionBuildingFaction,
  const Models extends readonly ModelInput[],
>(faction: Faction, models: Models): PackedModels<Faction, Models> {
  return models.map(
    (model) =>
      ({
        ...model,
        id: `building.lindocara.${faction}.${model.slug}`,
        faction,
        archetype: `${model.purpose}-${model.variant}`,
      }) satisfies FactionBuildingModel,
  ) as unknown as PackedModels<Faction, Models>;
}

const GOBLIN_BUILDINGS = pack("goblin", [
  {
    slug: "crooked-hut",
    purpose: "housing",
    variant: "a",
    width: 2.25,
    depth: 1.75,
    wallHeight: 1.05,
    roofHeight: 1.1,
    roofShape: "gable",
    collisionElevation: 2,
  },
  {
    slug: "fungus-burrow",
    purpose: "housing",
    variant: "b",
    width: 2,
    depth: 2,
    wallHeight: 0.95,
    roofHeight: 1.25,
    roofShape: "cone",
    collisionElevation: 2,
  },
  {
    slug: "boss-den",
    purpose: "command",
    variant: "a",
    width: 3.25,
    depth: 2.5,
    wallHeight: 1.75,
    roofHeight: 1.25,
    roofShape: "gable",
    collisionElevation: 3,
  },
  {
    slug: "scrap-keep",
    purpose: "command",
    variant: "b",
    width: 2.75,
    depth: 2.5,
    wallHeight: 2.35,
    roofHeight: 0.55,
    roofShape: "crenellated",
    collisionElevation: 3,
  },
  {
    slug: "stab-yard",
    purpose: "training",
    variant: "a",
    width: 3,
    depth: 2.25,
    wallHeight: 1.35,
    roofHeight: 0.85,
    roofShape: "gable",
    collisionElevation: 2,
  },
  {
    slug: "sling-range",
    purpose: "training",
    variant: "b",
    width: 2.75,
    depth: 2.25,
    wallHeight: 1.55,
    roofHeight: 0.45,
    roofShape: "crenellated",
    collisionElevation: 2,
  },
  {
    slug: "feast-shack",
    purpose: "community",
    variant: "a",
    width: 3.25,
    depth: 2.375,
    wallHeight: 1.4,
    roofHeight: 1.05,
    roofShape: "gable",
    collisionElevation: 2,
  },
  {
    slug: "shaman-hollow",
    purpose: "community",
    variant: "b",
    width: 2.25,
    depth: 2.25,
    wallHeight: 1.2,
    roofHeight: 1.35,
    roofShape: "cone",
    collisionElevation: 2,
  },
  {
    slug: "tinker-shed",
    purpose: "daily-life",
    variant: "a",
    width: 2.75,
    depth: 2,
    wallHeight: 1.25,
    roofHeight: 0.85,
    roofShape: "gable",
    collisionElevation: 2,
  },
  {
    slug: "scavenger-store",
    purpose: "daily-life",
    variant: "b",
    width: 2.25,
    depth: 2.125,
    wallHeight: 1.7,
    roofHeight: 0.5,
    roofShape: "crenellated",
    collisionElevation: 2,
  },
]);

const ORC_TROLL_BUILDINGS = pack("orc-troll", [
  {
    slug: "orc-longhouse",
    purpose: "housing",
    variant: "a",
    width: 3.25,
    depth: 2.25,
    wallHeight: 1.55,
    roofHeight: 1.2,
    roofShape: "gable",
    collisionElevation: 2,
  },
  {
    slug: "troll-rock-hut",
    purpose: "housing",
    variant: "b",
    width: 2.75,
    depth: 2.75,
    wallHeight: 1.45,
    roofHeight: 1.25,
    roofShape: "cone",
    collisionElevation: 2,
  },
  {
    slug: "warchief-hall",
    purpose: "command",
    variant: "a",
    width: 4,
    depth: 2.75,
    wallHeight: 2,
    roofHeight: 1.45,
    roofShape: "gable",
    collisionElevation: 3,
  },
  {
    slug: "skull-fort",
    purpose: "command",
    variant: "b",
    width: 3.5,
    depth: 3,
    wallHeight: 2.65,
    roofHeight: 0.65,
    roofShape: "crenellated",
    collisionElevation: 3,
  },
  {
    slug: "war-pit",
    purpose: "training",
    variant: "a",
    width: 3.5,
    depth: 2.5,
    wallHeight: 1.6,
    roofHeight: 0.95,
    roofShape: "gable",
    collisionElevation: 2,
  },
  {
    slug: "boulder-range",
    purpose: "training",
    variant: "b",
    width: 3.25,
    depth: 2.5,
    wallHeight: 1.9,
    roofHeight: 0.55,
    roofShape: "crenellated",
    collisionElevation: 3,
  },
  {
    slug: "clan-hearth",
    purpose: "community",
    variant: "a",
    width: 3.75,
    depth: 2.625,
    wallHeight: 1.75,
    roofHeight: 1.3,
    roofShape: "gable",
    collisionElevation: 3,
  },
  {
    slug: "smoke-lodge",
    purpose: "community",
    variant: "b",
    width: 3,
    depth: 3,
    wallHeight: 1.65,
    roofHeight: 1.4,
    roofShape: "cone",
    collisionElevation: 3,
  },
  {
    slug: "war-forge",
    purpose: "daily-life",
    variant: "a",
    width: 3.25,
    depth: 2.375,
    wallHeight: 1.65,
    roofHeight: 1.05,
    roofShape: "gable",
    collisionElevation: 2,
  },
  {
    slug: "beast-pen",
    purpose: "daily-life",
    variant: "b",
    width: 3.5,
    depth: 2.75,
    wallHeight: 1.75,
    roofHeight: 0.5,
    roofShape: "crenellated",
    collisionElevation: 2,
  },
]);

const BEASTFOLK_BUILDINGS = pack("beastfolk", [
  {
    slug: "hide-lodge",
    purpose: "housing",
    variant: "a",
    width: 2.75,
    depth: 2.125,
    wallHeight: 1.35,
    roofHeight: 1.25,
    roofShape: "gable",
    collisionElevation: 2,
  },
  {
    slug: "elevated-nest",
    purpose: "housing",
    variant: "b",
    width: 2.375,
    depth: 2.375,
    wallHeight: 1.45,
    roofHeight: 1.35,
    roofShape: "cone",
    collisionElevation: 2,
  },
  {
    slug: "totem-hall",
    purpose: "command",
    variant: "a",
    width: 3.5,
    depth: 2.5,
    wallHeight: 1.85,
    roofHeight: 1.35,
    roofShape: "gable",
    collisionElevation: 3,
  },
  {
    slug: "moon-den",
    purpose: "command",
    variant: "b",
    width: 3,
    depth: 2.75,
    wallHeight: 2.25,
    roofHeight: 0.65,
    roofShape: "crenellated",
    collisionElevation: 3,
  },
  {
    slug: "hunter-ring",
    purpose: "training",
    variant: "a",
    width: 3.25,
    depth: 2.375,
    wallHeight: 1.45,
    roofHeight: 1,
    roofShape: "gable",
    collisionElevation: 2,
  },
  {
    slug: "claw-yard",
    purpose: "training",
    variant: "b",
    width: 3,
    depth: 2.5,
    wallHeight: 1.65,
    roofHeight: 0.5,
    roofShape: "crenellated",
    collisionElevation: 2,
  },
  {
    slug: "communal-hollow",
    purpose: "community",
    variant: "a",
    width: 3.5,
    depth: 2.5,
    wallHeight: 1.55,
    roofHeight: 1.25,
    roofShape: "gable",
    collisionElevation: 2,
  },
  {
    slug: "healer-hut",
    purpose: "community",
    variant: "b",
    width: 2.5,
    depth: 2.5,
    wallHeight: 1.35,
    roofHeight: 1.45,
    roofShape: "cone",
    collisionElevation: 2,
  },
  {
    slug: "tannery",
    purpose: "daily-life",
    variant: "a",
    width: 3,
    depth: 2.25,
    wallHeight: 1.35,
    roofHeight: 0.95,
    roofShape: "gable",
    collisionElevation: 2,
  },
  {
    slug: "gatherer-store",
    purpose: "daily-life",
    variant: "b",
    width: 2.625,
    depth: 2.25,
    wallHeight: 1.75,
    roofHeight: 0.55,
    roofShape: "crenellated",
    collisionElevation: 2,
  },
]);

const WILD_TRIBE_BUILDINGS = pack("wild-tribe", [
  {
    slug: "reed-hut",
    purpose: "housing",
    variant: "a",
    width: 2.5,
    depth: 2,
    wallHeight: 1.2,
    roofHeight: 1.2,
    roofShape: "gable",
    collisionElevation: 2,
  },
  {
    slug: "hide-tent",
    purpose: "housing",
    variant: "b",
    width: 2.25,
    depth: 2.25,
    wallHeight: 1.05,
    roofHeight: 1.35,
    roofShape: "cone",
    collisionElevation: 2,
  },
  {
    slug: "ancestor-hall",
    purpose: "command",
    variant: "a",
    width: 3.5,
    depth: 2.5,
    wallHeight: 1.75,
    roofHeight: 1.4,
    roofShape: "gable",
    collisionElevation: 3,
  },
  {
    slug: "bone-tower",
    purpose: "command",
    variant: "b",
    width: 2.75,
    depth: 2.75,
    wallHeight: 2.45,
    roofHeight: 0.65,
    roofShape: "crenellated",
    collisionElevation: 3,
  },
  {
    slug: "spear-circle",
    purpose: "training",
    variant: "a",
    width: 3.25,
    depth: 2.375,
    wallHeight: 1.45,
    roofHeight: 1,
    roofShape: "gable",
    collisionElevation: 2,
  },
  {
    slug: "trial-pit",
    purpose: "training",
    variant: "b",
    width: 3,
    depth: 2.5,
    wallHeight: 1.65,
    roofHeight: 0.5,
    roofShape: "crenellated",
    collisionElevation: 2,
  },
  {
    slug: "fire-lodge",
    purpose: "community",
    variant: "a",
    width: 3.5,
    depth: 2.5,
    wallHeight: 1.55,
    roofHeight: 1.3,
    roofShape: "gable",
    collisionElevation: 2,
  },
  {
    slug: "spirit-hut",
    purpose: "community",
    variant: "b",
    width: 2.5,
    depth: 2.5,
    wallHeight: 1.35,
    roofHeight: 1.45,
    roofShape: "cone",
    collisionElevation: 2,
  },
  {
    slug: "drying-house",
    purpose: "daily-life",
    variant: "a",
    width: 3,
    depth: 2.125,
    wallHeight: 1.3,
    roofHeight: 0.95,
    roofShape: "gable",
    collisionElevation: 2,
  },
  {
    slug: "craft-shelter",
    purpose: "daily-life",
    variant: "b",
    width: 2.625,
    depth: 2.25,
    wallHeight: 1.7,
    roofHeight: 0.55,
    roofShape: "crenellated",
    collisionElevation: 2,
  },
]);

export const FACTION_BUILDING_MODELS = [
  ...GOBLIN_BUILDINGS,
  ...ORC_TROLL_BUILDINGS,
  ...BEASTFOLK_BUILDINGS,
  ...WILD_TRIBE_BUILDINGS,
] as const;

const MODEL_BY_ID: ReadonlyMap<string, FactionBuildingModel> = new Map(
  FACTION_BUILDING_MODELS.map((model) => [model.id, model]),
);

export function factionBuildingModel(assetId: string): FactionBuildingModel | null {
  return MODEL_BY_ID.get(assetId) ?? null;
}

export function factionBuildingModelForArchetype(
  faction: FactionBuildingFaction,
  archetype: FactionBuildingArchetype,
): FactionBuildingModel {
  const model = FACTION_BUILDING_MODELS.find(
    (candidate) => candidate.faction === faction && candidate.archetype === archetype,
  );
  if (!model) throw new Error(`Missing ${faction} ${archetype} building model`);
  return model;
}
