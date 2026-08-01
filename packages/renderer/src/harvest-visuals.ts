import { isPeasantCarryKind, type PeasantCarryKind } from "@lindocara/engine/harvest.js";
import type { PlayerSnapshot, WorldEventSnapshot } from "@lindocara/engine/protocol.js";
import { type PeasantCarryMotion, peasantCarrySheet, type UnitSheet } from "./tiny-swords-art.js";

/** A late resync observes history but must not replay an old impact. */
export const HARVEST_HIT_EFFECT_WINDOW_MS = 650;

export type ServerTimestampToLocal = (serverTimestamp: number) => number | null;

export interface HarvestEventVisualState {
  readonly observedHitKey: string | null;
  readonly fadeKey: string | null;
  readonly fadeStartedAt: number | null;
  readonly fadeGraphicAssetId: string | null;
}

export interface HarvestEventPresentation {
  readonly state: HarvestEventVisualState;
  readonly graphicAssetId: string | null;
  readonly alpha: number;
  readonly playHitEffect: boolean;
}

export function createHarvestEventVisualState(): HarvestEventVisualState {
  return {
    observedHitKey: null,
    fadeKey: null,
    fadeStartedAt: null,
    fadeGraphicAssetId: null,
  };
}

/** One semantic impact identity, independent of frame delivery or object identity. */
export function harvestHitKey(event: WorldEventSnapshot): string | null {
  const harvest = event.harvest;
  if (!harvest || harvest.hits <= 0 || harvest.lastHitAt === null) return null;
  return `${event.id}:${harvest.generation}:${harvest.hits}:${harvest.lastHitAt}`;
}

function harvestFadeKey(event: WorldEventSnapshot): string | null {
  const harvest = event.harvest;
  if (harvest?.state !== "depleted" || harvest.exhaustionBehavior !== "fade") {
    return null;
  }
  return `${event.id}:${harvest.generation}:${harvest.hits}:${harvest.depletedAt ?? "received"}`;
}

function isFreshServerEvent(
  serverTimestamp: number,
  now: number,
  toLocal: ServerTimestampToLocal,
): boolean {
  const localTimestamp = toLocal(serverTimestamp);
  return localTimestamp !== null && Math.abs(now - localTimestamp) <= HARVEST_HIT_EFFECT_WINDOW_MS;
}

/**
 * Pure event presentation reducer. The server selects the asset and exhaustion mode; this reducer
 * only preserves the already-drawn sprite while an authoritative fade is in progress.
 */
export function harvestEventPresentation(input: {
  readonly event: WorldEventSnapshot;
  readonly previous: HarvestEventVisualState;
  readonly previousGraphicAssetId: string | null | undefined;
  readonly now: number;
  readonly toLocal: ServerTimestampToLocal;
}): HarvestEventPresentation {
  const { event, previous, now, toLocal } = input;
  const hitKey = harvestHitKey(event);
  const newHit = hitKey !== null && hitKey !== previous.observedHitKey;
  const playHitEffect = Boolean(
    newHit &&
      event.harvest?.lastHitAt !== null &&
      event.harvest?.lastHitAt !== undefined &&
      isFreshServerEvent(event.harvest.lastHitAt, now, toLocal),
  );
  const observedHitKey = hitKey ?? previous.observedHitKey;
  const fadeKey = harvestFadeKey(event);
  const harvest = event.harvest;

  if (harvest?.state !== "depleted" || harvest.exhaustionBehavior !== "fade") {
    return {
      state: {
        observedHitKey,
        fadeKey: null,
        fadeStartedAt: null,
        fadeGraphicAssetId: null,
      },
      graphicAssetId:
        harvest?.state === "depleted" && harvest.exhaustionBehavior === "hide"
          ? null
          : event.graphicAssetId,
      alpha: harvest?.state === "depleted" && harvest.exhaustionBehavior === "hide" ? 0 : 1,
      playHitEffect,
    };
  }

  const startingFade = fadeKey !== previous.fadeKey || previous.fadeStartedAt === null;
  const convertedDepletedAt = harvest.depletedAt === null ? null : toLocal(harvest.depletedAt);
  const fadeStartedAt = startingFade ? (convertedDepletedAt ?? now) : previous.fadeStartedAt;
  const fadeGraphicAssetId = startingFade
    ? (input.previousGraphicAssetId ?? null)
    : previous.fadeGraphicAssetId;
  const progress =
    harvest.fadeDurationMs <= 0
      ? 1
      : Math.max(0, Math.min(1, (now - fadeStartedAt) / harvest.fadeDurationMs));

  return {
    state: {
      observedHitKey,
      fadeKey,
      fadeStartedAt,
      fadeGraphicAssetId,
    },
    graphicAssetId: progress >= 1 ? harvest.exhaustedAssetId : fadeGraphicAssetId,
    alpha: progress >= 1 ? (harvest.exhaustedAssetId === null ? 0 : 1) : 1 - progress,
    playHitEffect,
  };
}

export interface PeasantCarryPresentation {
  readonly kind: PeasantCarryKind;
  readonly motion: PeasantCarryMotion;
  readonly sheet: UnitSheet;
  readonly localUntil: number;
}

/** Selects a preloaded carry strip from the explicit wire kind and authoritative deadline. */
export function peasantCarryPresentation(
  player: Pick<PlayerSnapshot, "class" | "appearance" | "peasantCarry">,
  moving: boolean,
  now: number,
  toLocal: ServerTimestampToLocal,
): PeasantCarryPresentation | null {
  const carry = player.peasantCarry;
  if (player.class !== "peasant" || !carry || !isPeasantCarryKind(carry.kind)) return null;
  const localUntil = toLocal(carry.until);
  if (localUntil === null || localUntil <= now) return null;
  const motion: PeasantCarryMotion = moving ? "run" : "idle";
  return {
    kind: carry.kind,
    motion,
    sheet: peasantCarrySheet(player.appearance.primaryColor, carry.kind, motion),
    localUntil,
  };
}
