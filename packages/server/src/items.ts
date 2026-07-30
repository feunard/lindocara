import type { Equipment, MainHandItem, OffHandItem } from "@lindocara/engine/character.js";
import type { PlayerClass } from "@lindocara/engine/game.js";

/**
 * Inlined from the legacy `db/schema.ts` EQUIPMENT_SLOTS tuple (deleted in Task 6's legacy
 * retirement). Kept here rather than imported from `api/entities/heroEquipment.ts` because that
 * entity intentionally does not export the type — see its docblock.
 */
export type EquipmentSlot =
  | "main_hand"
  | "off_hand"
  | "head"
  | "chest"
  | "legs"
  | "feet"
  | "ring"
  | "amulet";

export const HEALTH_POTION_ID = "health_potion";

export interface ItemDefinitionRecord {
  id: string;
  type: "consumable" | "weapon" | "shield";
  stackable: boolean;
  maxStack: number;
  equipmentSlot: EquipmentSlot | null;
  allowedClass: PlayerClass | null;
}

export const ITEM_DEFINITIONS: readonly ItemDefinitionRecord[] = [
  {
    id: HEALTH_POTION_ID,
    type: "consumable",
    stackable: true,
    maxStack: 9_999,
    equipmentSlot: null,
    allowedClass: null,
  },
  {
    id: "mana_potion",
    type: "consumable",
    stackable: true,
    maxStack: 9_999,
    equipmentSlot: null,
    allowedClass: null,
  },
  {
    id: "damage_elixir",
    type: "consumable",
    stackable: true,
    maxStack: 9_999,
    equipmentSlot: null,
    allowedClass: null,
  },
  {
    id: "oblivion_draught",
    type: "consumable",
    stackable: true,
    maxStack: 9_999,
    equipmentSlot: null,
    allowedClass: null,
  },
  {
    id: "invisibility_potion",
    type: "consumable",
    stackable: true,
    maxStack: 9_999,
    equipmentSlot: null,
    allowedClass: null,
  },
  {
    id: "resurrection_potion",
    type: "consumable",
    stackable: true,
    maxStack: 9_999,
    equipmentSlot: null,
    allowedClass: null,
  },
  {
    id: "weathered_sword",
    type: "weapon",
    stackable: false,
    maxStack: 1,
    equipmentSlot: "main_hand",
    allowedClass: "warrior",
  },
  {
    id: "hunter_bow",
    type: "weapon",
    stackable: false,
    maxStack: 1,
    equipmentSlot: "main_hand",
    allowedClass: "ranger",
  },
  {
    id: "heartwood_staff",
    type: "weapon",
    stackable: false,
    maxStack: 1,
    equipmentSlot: "main_hand",
    allowedClass: "priest",
  },
  {
    id: "shadow_daggers",
    type: "weapon",
    stackable: false,
    maxStack: 1,
    equipmentSlot: "main_hand",
    allowedClass: "rogue",
  },
  {
    id: "oak_shield",
    type: "shield",
    stackable: false,
    maxStack: 1,
    equipmentSlot: "off_hand",
    allowedClass: "warrior",
  },
] as const;

export function ownedItemId(ownerId: string, definitionId: string): string {
  return `${ownerId}:${definitionId}`;
}

export function equipmentDefinitionIds(equipment: Equipment): string[] {
  return equipment.offHand === null
    ? [equipment.mainHand]
    : [equipment.mainHand, equipment.offHand];
}

export function isMainHandItem(value: string): value is MainHandItem {
  return (
    value === "weathered_sword" ||
    value === "hunter_bow" ||
    value === "heartwood_staff" ||
    value === "shadow_daggers"
  );
}

export function isOffHandItem(value: string): value is OffHandItem {
  return value === "oak_shield";
}
