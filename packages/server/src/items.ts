import type { Equipment, MainHandItem, OffHandItem } from "@lindocara/engine/character.js";
import { CONSUMABLE_IDS } from "@lindocara/engine/consumables.js";
import type { PlayerClass } from "@lindocara/engine/game.js";
import type { EquipmentSlot } from "./db/schema.js";

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
  ...CONSUMABLE_IDS.map(
    (id) =>
      ({
        id,
        type: "consumable",
        stackable: true,
        maxStack: 9_999,
        equipmentSlot: null,
        allowedClass: null,
      }) satisfies ItemDefinitionRecord,
  ),
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
