import type { ProjectileKind } from "@lindocara/engine/protocol.js";

export type ProjectileShape = "arrow" | "heart" | "orb" | "harpoon" | "bomb";

export interface ProjectileVisualDefinition {
  shape: ProjectileShape;
  color: number | "faction";
  accent: number;
  scale: number;
  spin: number;
  pulse: number;
  trailLength: number;
}

export const PROJECTILE_VISUALS: Readonly<Record<ProjectileKind, ProjectileVisualDefinition>> = {
  arrow: {
    shape: "arrow",
    color: "faction",
    accent: 0xffedb0,
    scale: 1,
    spin: 0,
    pulse: 0,
    trailLength: 0,
  },
  piercing_arrow: {
    shape: "arrow",
    color: 0x9ce9ff,
    accent: 0xffffff,
    scale: 1.2,
    spin: 0,
    pulse: 0.04,
    trailLength: 0.65,
  },
  volley_arrow: {
    shape: "arrow",
    color: "faction",
    accent: 0xd5ff9b,
    scale: 0.82,
    spin: 0,
    pulse: 0,
    trailLength: 0.24,
  },
  heartseeker: {
    shape: "heart",
    color: 0xff4f78,
    accent: 0xffd1dc,
    scale: 1.1,
    spin: 1.4,
    pulse: 0.14,
    trailLength: 0.48,
  },
  radiant_bolt: {
    shape: "orb",
    color: 0xffd85e,
    accent: 0xffffff,
    scale: 1.05,
    spin: 4.2,
    pulse: 0.12,
    trailLength: 0.42,
  },
  healing_light: {
    shape: "orb",
    color: 0x74f0b0,
    accent: 0xeafff4,
    scale: 0.95,
    spin: -3.4,
    pulse: 0.16,
    trailLength: 0.36,
  },
  hex_orb: {
    shape: "orb",
    color: 0xa36cff,
    accent: 0xff75da,
    scale: 1.12,
    spin: 5.4,
    pulse: 0.1,
    trailLength: 0.55,
  },
  enemy_harpoon: {
    shape: "harpoon",
    color: 0x4e5c69,
    accent: 0xdce8ef,
    scale: 1.3,
    spin: 0,
    pulse: 0,
    trailLength: 0,
  },
  enemy_bomb: {
    shape: "bomb",
    color: 0x3b2924,
    accent: 0xff643f,
    scale: 1.15,
    spin: 2.7,
    pulse: 0.08,
    trailLength: 0.18,
  },
  homemade_bomb: {
    shape: "bomb",
    color: "faction",
    accent: 0xffb24c,
    scale: 1,
    spin: -3.2,
    pulse: 0.06,
    trailLength: 0.22,
  },
};

export function projectileVisual(kind: ProjectileKind): ProjectileVisualDefinition {
  return PROJECTILE_VISUALS[kind];
}
