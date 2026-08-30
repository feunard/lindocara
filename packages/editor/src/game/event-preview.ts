import { defaultMonsterTuning, MONSTER_SPECIES_KIND } from "@lindocara/engine/game.js";
import { type MapData, mapToQuerySource } from "@lindocara/engine/hd2d/map-data.js";
import { createTerrainQuery } from "@lindocara/engine/hd2d/terrain-query.js";
import { type MapEvent, monsterEvents } from "@lindocara/engine/map-events.js";
import type {
  MonsterSnapshot,
  SeaGuardianSnapshot,
  WorldEventSnapshot,
} from "@lindocara/engine/protocol.js";
import { seaGuardianRuntimeId } from "@lindocara/engine/sea-guardian.js";
import { undergroundFloorHeight } from "@lindocara/engine/underground.js";

export type AuthoredEventPreviewScope = "map-editor" | "playable-preview";

/**
 * Projects authored page-one appearances into the renderer's visual-only event contract.
 *
 * Monsters always use the dedicated actor projection below, so their editor and gameplay models
 * cannot drift. The playable preview also excludes guards because it already projects them as real
 * actor snapshots; drawing either event graphic too would duplicate the sprite in depth.
 */
export function authoredEventPreviewSnapshots(
  events: readonly MapEvent[],
  scope: AuthoredEventPreviewScope,
): WorldEventSnapshot[] {
  return events.flatMap((event) => {
    if (event.kind === "sea-guardian" || event.kind === "monster") return [];
    if (scope === "playable-preview" && event.kind === "guard") {
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
        ...(event.undergroundDepth
          ? {
              y: undergroundFloorHeight(event.undergroundDepth),
              undergroundDepth: event.undergroundDepth,
            }
          : {}),
        graphicAssetId: page.graphicAssetId ?? null,
        graphicTint: page.graphicTint ?? 0xffffff,
        onTop: page.optOnTop,
        moveSpeed: page.moveSpeed,
        moveFrequency: page.moveFreq,
        moveAnimation: page.optMoveAnim,
        directionFixed: page.optDirFix,
        ...(page.graphicElevation === undefined ? {} : { elevationOffset: page.graphicElevation }),
        ...(page.optFloat === true ? { floating: true as const } : {}),
        presentation: event.kind === "harvestable" ? "native" : "marker",
        // `showMarker` is a gameplay presentation choice, never permission to hide authoring data.
        // An event with no graphic must remain selectable and understandable in the map editor even
        // when its gold ring is deliberately disabled for players.
        showMarker: scope === "map-editor" ? true : event.showMarker !== false,
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

/**
 * Projects every authored monster through the gameplay actor contract, including species art.
 */
export function authoredMonsterPreviewSnapshots(
  events: readonly MapEvent[],
  heightfield: MapData,
): MonsterSnapshot[] {
  const query = createTerrainQuery(mapToQuerySource(heightfield));
  return monsterEvents(events).flatMap((event) => {
    const species = event.species;
    if (species === null) return [];
    const tuning = {
      ...defaultMonsterTuning(species),
      ...(event.monsterRank ? { rank: event.monsterRank } : {}),
      ...(event.monsterMaxHp === null || event.monsterMaxHp === undefined
        ? {}
        : { maxHp: event.monsterMaxHp }),
      ...(event.monsterSpecialTechnique ? { specialTechnique: event.monsterSpecialTechnique } : {}),
    };
    const x = event.col + 0.5 - heightfield.size / 2;
    const z = event.row + 0.5 - heightfield.size / 2;
    return [
      {
        id: `preview-monster-${event.id}`,
        name: event.name,
        kind: MONSTER_SPECIES_KIND[species],
        species,
        rank: tuning.rank,
        specialTechnique: tuning.specialTechnique,
        x,
        y: event.undergroundDepth
          ? undergroundFloorHeight(event.undergroundDepth)
          : (query.heightAt(x, z) ?? heightfield.waterLevel),
        z,
        hp: tuning.maxHp,
        maxHp: tuning.maxHp,
        dead: false,
        graphicAssetId: event.pages[0]?.graphicAssetId ?? null,
        facing: { x: 0, z: 1 },
        action: null,
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
  return events.flatMap((event) =>
    event.kind === "sea-guardian"
      ? [
          {
            id: seaGuardianRuntimeId(event.id),
            x: event.col + 0.5 - size / 2,
            y: event.undergroundDepth ? undergroundFloorHeight(event.undergroundDepth) : waterLevel,
            z: event.row + 0.5 - size / 2,
            facing: { x: 0, z: 1 },
            state: "patrol" as const,
            animationStartedAt: 0,
            animationEndsAt: null,
          },
        ]
      : [],
  );
}
