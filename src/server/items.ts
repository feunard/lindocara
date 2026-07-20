import type { Equipment, MainHandItem, OffHandItem } from "../shared/character.js";
import type { PlayerClass } from "../shared/game.js";
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
  return value === "weathered_sword" || value === "hunter_bow" || value === "heartwood_staff";
}

export function isOffHandItem(value: string): value is OffHandItem {
  return value === "oak_shield";
}
