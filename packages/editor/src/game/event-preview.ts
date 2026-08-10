import type { MapEvent } from "@lindocara/engine/map-events.js";
import type { SeaGuardianSnapshot, WorldEventSnapshot } from "@lindocara/engine/protocol.js";
import { SEA_GUARDIAN_ID } from "@lindocara/engine/sea-guardian.js";

export type AuthoredEventPreviewScope = "map-editor" | "playable-preview";

/**
 * Projects authored page-one appearances into the renderer's visual-only event contract.
 *
 * The map editor includes every kind so anchors and combat actors remain visible while authoring.
 * The playable preview excludes monster/guard events because it already projects those two as real
 * actor snapshots; drawing their event graphic too would duplicate the sprite in depth.
 */
export function authoredEventPreviewSnapshots(
  events: readonly MapEvent[],
  scope: AuthoredEventPreviewScope,
): WorldEventSnapshot[] {
  return events.flatMap((event) => {
    if (event.kind === "sea-guardian") return [];
    if (scope === "playable-preview" && (event.kind === "monster" || event.kind === "guard")) {
      return [];
    }
    const page = event.pages[0];
    if (!page) return [];
    const profile = event.kind === "harvestable" ? event.harvestProfile : undefined;
    return [
      {
        id: event.id,
        col: event.col,
        row: event.row,
        graphicAssetId: page.graphicAssetId ?? null,
        graphicTint: page.graphicTint ?? 0xffffff,
        onTop: page.optOnTop,
        moveSpeed: page.moveSpeed,
        moveFrequency: page.moveFreq,
        moveAnimation: page.optMoveAnim,
        directionFixed: page.optDirFix,
        presentation: event.kind === "harvestable" ? "native" : "marker",
        ...(profile
          ? {
              harvest: {
                state: "intact" as const,
                generation: 0,
                hits: 0,
                hitsRequired: profile.hitsRequired,
                lastHitAt: null,
                depletedAt: null,
                respawnAt: null,
                exhaustionBehavior: profile.exhaustionBehavior,
                exhaustedAssetId: profile.exhaustedAssetId,
                fadeDurationMs: profile.fadeDurationMs,
                collider: null,
              },
            }
          : {}),
      },
    ];
  });
}

/** Preview projection for the dedicated actor path used by both editor surfaces. */
export function authoredSeaGuardianPreviewSnapshots(
  events: readonly MapEvent[],
  size: number,
  waterLevel: number,
): SeaGuardianSnapshot[] {
  const event = events.find((candidate) => candidate.kind === "sea-guardian");
  if (!event) return [];
  return [
    {
      id: SEA_GUARDIAN_ID,
      x: event.col + 0.5 - size / 2,
      y: waterLevel,
      z: event.row + 0.5 - size / 2,
      facing: { x: 0, z: 1 },
      state: "patrol",
      animationStartedAt: 0,
      animationEndsAt: null,
    },
  ];
}
