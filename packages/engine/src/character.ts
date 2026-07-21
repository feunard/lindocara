import type { PlayerClass } from "./game.js";

export const BODY_VARIANTS = ["wayfarer"] as const;
export type BodyVariant = (typeof BODY_VARIANTS)[number];

export const PRIMARY_COLORS = ["azure", "ember", "moss", "violet"] as const;
export type PrimaryColor = (typeof PRIMARY_COLORS)[number];

export function isPrimaryColor(value: unknown): value is PrimaryColor {
  return typeof value === "string" && (PRIMARY_COLORS as readonly string[]).includes(value);
}

/** The pack provides class sprites in four faction colors; creation stays intentionally simple. */
export interface CharacterAppearance {
  body: BodyVariant;
  primaryColor: PrimaryColor;
}

export type CharacterAppearanceInput = CharacterAppearance;

export const DEFAULT_APPEARANCE: CharacterAppearance = {
  body: "wayfarer",
  primaryColor: "azure",
};

export const MAIN_HAND_ITEMS = ["weathered_sword", "hunter_bow", "heartwood_staff"] as const;
export type MainHandItem = (typeof MAIN_HAND_ITEMS)[number];

export const OFF_HAND_ITEMS = ["oak_shield"] as const;
export type OffHandItem = (typeof OFF_HAND_ITEMS)[number];

export interface Equipment {
  mainHand: MainHandItem;
  offHand: OffHandItem | null;
}

/** The authoritative, shared class-to-starter-equipment rule. */
export const STARTER_EQUIPMENT: Readonly<Record<PlayerClass, Equipment>> = {
  warrior: { mainHand: "weathered_sword", offHand: "oak_shield" },
  ranger: { mainHand: "hunter_bow", offHand: null },
  priest: { mainHand: "heartwood_staff", offHand: null },
};

export function starterEquipmentFor(playerClass: PlayerClass): Equipment {
  return { ...STARTER_EQUIPMENT[playerClass] };
}

export function isValidAppearance(value: unknown): value is CharacterAppearanceInput {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.body === "string" &&
    (BODY_VARIANTS as readonly string[]).includes(candidate.body) &&
    typeof candidate.primaryColor === "string" &&
    (PRIMARY_COLORS as readonly string[]).includes(candidate.primaryColor)
  );
}

export function isEquipmentForClass(equipment: Equipment, playerClass: PlayerClass): boolean {
  const starter = STARTER_EQUIPMENT[playerClass];
  return equipment.mainHand === starter.mainHand && equipment.offHand === starter.offHand;
}

export function normalizeEquipment(
  playerClass: PlayerClass,
  mainHand: unknown,
  offHand: unknown,
): Equipment {
  const candidate: Equipment = {
    mainHand: (MAIN_HAND_ITEMS as readonly unknown[]).includes(mainHand)
      ? (mainHand as MainHandItem)
      : STARTER_EQUIPMENT[playerClass].mainHand,
    offHand:
      offHand === null || offHand === undefined
        ? null
        : (OFF_HAND_ITEMS as readonly unknown[]).includes(offHand)
          ? (offHand as OffHandItem)
          : null,
  };
  return isEquipmentForClass(candidate, playerClass) ? candidate : starterEquipmentFor(playerClass);
}

export function normalizeAppearance(
  appearance: { body?: unknown; primaryColor?: unknown } | null | undefined,
  legacyColor?: unknown,
): CharacterAppearance {
  const body = (BODY_VARIANTS as readonly unknown[]).includes(appearance?.body)
    ? (appearance?.body as BodyVariant)
    : DEFAULT_APPEARANCE.body;
  const colorCandidate = appearance?.primaryColor ?? legacyColor;
  const primaryColor = (PRIMARY_COLORS as readonly unknown[]).includes(colorCandidate)
    ? (colorCandidate as PrimaryColor)
    : DEFAULT_APPEARANCE.primaryColor;
  return { body, primaryColor };
}
