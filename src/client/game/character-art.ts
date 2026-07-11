import type { MainHandItem, OffHandItem, PrimaryColor } from "../../shared/character.js";

export const CHARACTER_ATLAS_URL = "/assets/lindocara/atlas/world.png";

export const PLAYER_ATLAS_FRAMES: Readonly<
  Record<PrimaryColor, { name: string; x: number; y: number; width: number; height: number }>
> = {
  azure: { name: "player.azure", x: 63, y: 208, width: 16, height: 16 },
  violet: { name: "player.violet", x: 81, y: 208, width: 16, height: 16 },
  ember: { name: "player.ember", x: 99, y: 208, width: 16, height: 16 },
  moss: { name: "player.moss", x: 117, y: 208, width: 16, height: 16 },
};

export const MAIN_HAND_ART: Readonly<
  Record<MainHandItem, { source: "atlas" | string; frame?: string; width: number; height: number }>
> = {
  weathered_sword: { source: "atlas", frame: "weapon.sword", width: 7, height: 16 },
  hunter_bow: {
    source: "/assets/lindocara/equipment/hunter-bow.svg",
    width: 9,
    height: 18,
  },
  heartwood_staff: {
    source: "/assets/lindocara/equipment/heartwood-staff.svg",
    width: 10,
    height: 18,
  },
};

export const OFF_HAND_ART: Readonly<
  Record<OffHandItem, { source: string; width: number; height: number }>
> = {
  oak_shield: {
    source: "/assets/lindocara/equipment/oak-shield.svg",
    width: 12,
    height: 15,
  },
};
