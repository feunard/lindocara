import { HARVEST_RESOURCE_KINDS, type HarvestResourceKind } from "@lindocara/engine/harvest.js";
import type { MessageKey } from "@lindocara/engine/i18n/index.js";
import {
  PARTY_MATERIAL_TYPES,
  type PartyMaterialAmounts,
  type PartyMaterialType,
} from "@lindocara/engine/party-harvest-state.js";
import { t } from "./i18n.js";

export const MATERIAL_SHORT_LABEL: Readonly<Record<PartyMaterialType, MessageKey>> = {
  wood: "material.short.wood",
  stone: "material.short.stone",
  iron: "material.short.iron",
  meat: "material.short.meat",
};

const MATERIAL_LABEL: Readonly<Record<HarvestResourceKind, MessageKey>> = {
  wood: "material.wood",
  stone: "material.stone",
  iron: "material.iron",
  gold: "material.gold",
  meat: "material.meat",
};

export function localizedMaterialName(resource: HarvestResourceKind): string {
  return t(MATERIAL_LABEL[resource]);
}

export function partyMaterialCostText(cost: Readonly<PartyMaterialAmounts>): string {
  return PARTY_MATERIAL_TYPES.flatMap((material) => {
    const amount = cost[material] ?? 0;
    return amount > 0 ? [`${localizedMaterialName(material)} ${amount}`] : [];
  }).join(" · ");
}

export function localizedMissingMaterials(amounts: Readonly<PartyMaterialAmounts>): {
  missing: string;
  count: number;
} {
  const entries = PARTY_MATERIAL_TYPES.flatMap((material) => {
    const amount = amounts[material] ?? 0;
    return amount > 0 ? [`${localizedMaterialName(material)} ${amount}`] : [];
  });
  return {
    missing: entries.join(", "),
    count: PARTY_MATERIAL_TYPES.reduce((total, material) => total + (amounts[material] ?? 0), 0),
  };
}

export function localizedHarvestGain(
  amounts: Readonly<Record<string, string | number | undefined>>,
): string {
  return HARVEST_RESOURCE_KINDS.flatMap((resource) => {
    const amount = amounts[resource];
    return typeof amount === "number" && amount > 0
      ? [`+${amount} ${localizedMaterialName(resource)}`]
      : [];
  }).join(" · ");
}
