/** `?preview` walks the deterministic reference map through the shipped HD-2D preview client. */

import { AMBIENCE_FULL, AMBIENCE_NONE } from "@lindocara/renderer/ambience.js";
import { setHd2dGroundPalette } from "@lindocara/renderer/hd2d/scene.js";

import { buildBiomeWitnessMap } from "./biome-witness-map.js";
import {
  buildBuildingRoofMap,
  parseRoofWitnessBuilding,
  type RoofWitnessBuilding,
} from "./building-roof-map.js";
import { buildReferenceMapBuild } from "./reference-map.js";

export interface PreviewRequest {
  palette: string | null;
  ambience: boolean;
  /** Starting camera multiplier. Below 1 pulls back. */
  zoom: number;
  witness: "reference" | "roofs" | "biomes";
  building: RoofWitnessBuilding;
  autoClimb: boolean;
}

export function previewRequest(search: string): PreviewRequest | null {
  const params = new URLSearchParams(search);
  if (!params.has("preview")) return null;
  const zoom = Number.parseFloat(params.get("zoom") ?? "");
  return {
    palette: params.get("palette"),
    ambience: params.get("ambience") !== "0",
    zoom: Number.isFinite(zoom) && zoom > 0 ? zoom : 1,
    witness:
      params.get("preview") === "roofs"
        ? "roofs"
        : params.get("preview") === "biomes"
          ? "biomes"
          : "reference",
    building: parseRoofWitnessBuilding(params.get("building")),
    autoClimb: params.get("autoclimb") === "1",
  };
}

function captionInto(root: Element, lines: readonly string[]): HTMLDivElement {
  const box = document.createElement("div");
  box.style.cssText = [
    "position:fixed",
    "left:12px",
    "bottom:12px",
    "z-index:10",
    "padding:8px 12px",
    "border-radius:8px",
    "background:rgba(7,18,15,.72)",
    "color:#e8f5ee",
    "font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace",
    "pointer-events:none",
    "white-space:pre",
  ].join(";");
  box.textContent = lines.join("\n");
  root.appendChild(box);
  return box;
}

export async function startPreviewRoute(request: PreviewRequest): Promise<void> {
  const palette = request.palette;
  const paletteApplied = palette === null ? true : setHd2dGroundPalette(palette);
  const reference = request.witness === "reference" ? buildReferenceMapBuild() : null;
  const map =
    reference?.map ??
    (request.witness === "biomes"
      ? buildBiomeWitnessMap()
      : buildBuildingRoofMap(request.building));
  const root = document.querySelector("#root");
  let roofMaxY = Number.NEGATIVE_INFINITY;
  let roofMinZ = Number.POSITIVE_INFINITY;
  let roofWasAirborne = false;
  const roofLines = (state?: {
    x: number;
    y: number;
    z: number;
    groundY: number;
    airborne: boolean;
  }): string[] => [
    `HD-2D roof witness  ${request.building}`,
    "Spawn: elevated floor. Hold UP + SPACE to jump north onto the real roof.",
    "Walk left/right after landing; falling through the mesh is a failure.",
    request.autoClimb ? "Automated witness: climb, land, then walk right." : "",
    ...(state
      ? [
          `Hero x=${state.x.toFixed(2)} y=${state.y.toFixed(2)} z=${state.z.toFixed(2)} ground=${state.groundY.toFixed(2)} airborne=${state.airborne ? "yes" : "no"}`,
          `Run maxY=${roofMaxY.toFixed(2)} minZ=${roofMinZ.toFixed(2)} jumped=${roofWasAirborne ? "yes" : "no"}`,
        ]
      : []),
    "?preview=roofs&building=house|tower|archery|barracks|windmill",
  ];
  const roofCaption = request.witness === "roofs" && root ? captionInto(root, roofLines()) : null;
  const { startMapPreview } = await import("@lindocara/editor/game/map-preview.js");
  await startMapPreview(map, [], {
    playerChrome: false,
    ambience: request.ambience ? AMBIENCE_FULL : AMBIENCE_NONE,
    ...(request.witness === "roofs" ? { dayNightCycle: false } : {}),
    ...(request.witness === "roofs" && request.autoClimb
      ? {
          scriptedInput: (elapsedMs: number) => ({
            up: elapsedMs < 370,
            down: false,
            left: false,
            right: elapsedMs >= 1_900 && elapsedMs < 2_000,
            jump: elapsedMs < 370,
          }),
        }
      : {}),
    ...(roofCaption
      ? {
          onHeroState: (state: {
            x: number;
            y: number;
            z: number;
            groundY: number;
            airborne: boolean;
          }) => {
            roofMaxY = Math.max(roofMaxY, state.y);
            roofMinZ = Math.min(roofMinZ, state.z);
            roofWasAirborne ||= state.airborne;
            roofCaption.textContent = roofLines(state).join("\n");
          },
        }
      : {}),
    zoom: request.zoom,
    zoomControls: true,
  });

  if (!root) return;
  if (request.witness === "reference") {
    captionInto(root, [
      `HD-2D reference  ${map.cols}x${map.rows}  ${map.elements.length} elements  stairs ${reference?.stairsPlaced}/${reference?.stairsRequested}`,
      `palette ${palette ?? "altitude"}${paletteApplied ? "" : "  (unknown - ignored)"}   ambience ${request.ambience ? "on" : "off"}`,
      "WASD / arrows to walk    wheel or - / + to zoom, 0 resets",
      "?palette=color1..color5    ?ambience=0    ?zoom=0.5",
    ]);
  } else if (request.witness === "biomes") {
    captionInto(root, [
      "HD-2D biome witness",
      "Cave · mountain · volcano · lava",
      "Native cave/castle walls and ceilings",
      "WASD / arrows to swim and walk    wheel or - / + to zoom",
      "?preview=biomes&ambience=0&zoom=0.75",
    ]);
  }
}
