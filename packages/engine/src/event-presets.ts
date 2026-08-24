/**
 * Popular event PRESETS: a scripted (`normal`) event pre-filled with a ready-made page-1 program and
 * trigger, so an author places a common behaviour in one click instead of hand-authoring its command
 * list. A preset invents no runtime — it only constructs a `MapEvent` out of the EXISTING page/command
 * model (`map-events.ts` + `event-commands.ts`), which is exactly what the interpreter already runs.
 *
 * Platform-free like the two modules it composes: the editor uses it to mint a placement, and a pure
 * test pins each preset's command payload. `raw` is the blank scripted event (the historical default);
 * the rest pre-fill one canonical command the author then tunes in the event dialog.
 *
 * `teleporter` needs a real destination map uuid (`teleport.mapId` is `isUuid`-checked by the wire
 * parser), so it defaults to the CURRENT map — a same-map teleport the author retargets in the dialog.
 * A cross-map default has no home in this model yet (that is a later tranche), so same-map is the
 * honest placeholder rather than an invalid id the server would reject on save.
 */
import type { EventCommand } from "./event-commands.js";
import { RUNNER_PURSUER_TUNING } from "./game.js";
import {
  defaultEventPage,
  type EventTrigger,
  functionalEvent,
  type MapEvent,
  type MapEventPage,
} from "./map-events.js";
import { MOVEMENT_EFFECT_DEFAULTS, type MovementEffectKind } from "./movement-effects.js";
import {
  LINDOCARA_CHEST_CLOSED_ASSET_ID,
  LINDOCARA_CHEST_OPEN_ASSET_ID,
  LINDOCARA_PICKUP_FLOAT_HEIGHT,
  LINDOCARA_RUNNER_ASSET_IDS,
  LINDOCARA_PICKUP_ASSET_IDS,
} from "./tiny-swords-catalog.js";

export const EVENT_PRESETS = [
  "raw",
  "teleporter",
  "sign",
  "chest",
  "trap",
  "pursuer",
  "endgame",
  "pickup-speed-boost",
  "pickup-light-gravity",
  "pickup-double-jump",
  "pickup-speed-slow",
  "pickup-heavy-gravity",
  "pickup-inverted-controls",
] as const;
export type EventPreset = (typeof EVENT_PRESETS)[number];

export const MOVEMENT_PICKUP_PRESETS = [
  "pickup-speed-boost",
  "pickup-light-gravity",
  "pickup-double-jump",
  "pickup-speed-slow",
  "pickup-heavy-gravity",
  "pickup-inverted-controls",
] as const;
export type MovementPickupPreset = (typeof MOVEMENT_PICKUP_PRESETS)[number];

export const MOVEMENT_PICKUP_EFFECT: Readonly<Record<MovementPickupPreset, MovementEffectKind>> = {
  "pickup-speed-boost": "speed_boost",
  "pickup-light-gravity": "light_gravity",
  "pickup-double-jump": "double_jump",
  "pickup-speed-slow": "speed_slow",
  "pickup-heavy-gravity": "heavy_gravity",
  "pickup-inverted-controls": "inverted_controls",
};

export function isMovementPickupPreset(value: EventPreset): value is MovementPickupPreset {
  return (MOVEMENT_PICKUP_PRESETS as readonly string[]).includes(value);
}

/** The default gold a `chest` preset grants until the author edits it — a positive, non-zero amount
 *  the `changeGold` parser accepts. */
const CHEST_DEFAULT_GOLD = 10;

/** The trigger + page-1 program a preset pre-fills onto a fresh scripted event. `selfMapId` is the
 *  current map's uuid, used only by `teleporter` for its same-map destination default. Pure so each
 *  preset's payload is pinned by a unit test rather than by reading the placement path. */
export function presetPageContent(
  preset: EventPreset,
  selfMapId: string,
  selfSpawn: { col: number; row: number } = { col: 0, row: 0 },
): { trigger: EventTrigger; commands: EventCommand[] } {
  switch (preset) {
    case "raw":
      return { trigger: "action", commands: [] };
    case "teleporter":
      // The destination defaults to the map's OWN spawn cell, not (0, 0). The runtime refuses a
      // teleport onto unwalkable ground (and only warns once, into the server log), so a corner cell
      // is a placeholder that can silently do nothing on any map with a decorated border — which is
      // most of them. A map's spawn is the one cell the editor guarantees stays walkable, so this
      // placeholder always *visibly* fires, and the author retargets it in the dialog.
      return {
        trigger: "player-touch",
        commands: [
          {
            t: "teleport",
            mapId: selfMapId,
            col: selfSpawn.col,
            row: selfSpawn.row,
            category: "geographic",
          },
        ],
      };
    case "sign":
      return { trigger: "action", commands: [{ t: "say", text: "" }] };
    case "chest":
      return { trigger: "action", commands: [{ t: "changeGold", amount: CHEST_DEFAULT_GOLD }] };
    case "trap":
      return { trigger: "player-touch", commands: [{ t: "damage", amount: 25, lethal: false }] };
    case "pursuer":
      return { trigger: "action", commands: [] };
    case "endgame":
      // The optional adventure goal: stepping on this cell marks the party's save complete. The
      // author retargets the trigger or adds an epilogue `say` in the dialog.
      return { trigger: "player-touch", commands: [{ t: "endAdventure" }] };
    case "pickup-speed-boost":
    case "pickup-light-gravity":
    case "pickup-double-jump":
    case "pickup-speed-slow":
    case "pickup-heavy-gravity":
    case "pickup-inverted-controls": {
      const effect = MOVEMENT_PICKUP_EFFECT[preset];
      const defaults = MOVEMENT_EFFECT_DEFAULTS[effect];
      return {
        trigger: "player-touch",
        commands: [
          {
            t: "movementEffect",
            effect,
            durationMs: defaults.durationMs,
            power: defaults.power,
          },
        ],
      };
    }
  }
}

/**
 * A scripted (`normal`) event pre-filled by `preset`. One default page, no graphic (the sidebar's
 * graphic picker is gone — the graphic is chosen in the event dialog), carrying the preset's trigger
 * and command program. The id/ordinal/cell are minted by the placement path (`applyTool`), the same
 * as every other event; this only assembles the pre-filled page so the two cannot drift.
 */
export function presetEvent(params: {
  id: string;
  col: number;
  row: number;
  ordinal: number;
  preset: EventPreset;
  selfMapId: string;
  /** The map's own spawn cell — the `teleporter` preset's walkable destination placeholder. */
  selfSpawn?: { col: number; row: number };
  /** The placed event's name, so the sidebar list and the inspector can tell a teleporter from a
   *  chest. Authored DATA in the author's own language (the editor passes its localized preset
   *  label), never a message key: an event name is stored in D1 and renamed freely, exactly like the
   *  authored prose in a `say`. Absent means the historical unnamed event. */
  name?: string;
}): MapEvent {
  if (params.preset === "pursuer") {
    const event = functionalEvent({
      id: params.id,
      col: params.col,
      row: params.row,
      ordinal: params.ordinal,
      kind: "monster",
      name: params.name ?? "",
      species: "war_pig",
      patrolRadius: 256,
      monsterTuning: { speed: RUNNER_PURSUER_TUNING.speed, damage: 1, xp: 0 },
      monsterRespawnMode: "timed",
      monsterPursuitMode: "relentless",
      monsterAcceleration: RUNNER_PURSUER_TUNING.acceleration,
      monsterMaxSpeed: RUNNER_PURSUER_TUNING.maxSpeed,
      monsterOneHitKill: true,
    });
    return {
      ...event,
      showMarker: false,
      monsterAttackProfile: "melee",
      pages: [{ ...(event.pages[0] ?? defaultEventPage()), graphicAssetId: null }],
    };
  }
  const { trigger, commands } = presetPageContent(
    params.preset,
    params.selfMapId,
    params.selfSpawn,
  );
  const chest = params.preset === "chest";
  const trap = params.preset === "trap";
  const pickupEffect = isMovementPickupPreset(params.preset)
    ? MOVEMENT_PICKUP_EFFECT[params.preset]
    : null;
  const pickup = pickupEffect !== null;
  const page: MapEventPage = {
    ...defaultEventPage(),
    trigger,
    graphicAssetId: chest
      ? LINDOCARA_CHEST_CLOSED_ASSET_ID
      : trap
        ? LINDOCARA_RUNNER_ASSET_IDS.spikeTrap
        : pickupEffect
          ? LINDOCARA_PICKUP_ASSET_IDS[pickupEffect]
          : null,
    ...(pickup ? { graphicElevation: LINDOCARA_PICKUP_FLOAT_HEIGHT, optFloat: true } : {}),
    commands: chest
      ? [...commands, { t: "setSelfSwitch", selfSwitch: "A", value: true }]
      : commands,
  };
  const pages: MapEventPage[] = chest
    ? [
        page,
        {
          ...defaultEventPage(),
          graphicAssetId: LINDOCARA_CHEST_OPEN_ASSET_ID,
          condSelfSwitch: "A",
        },
      ]
    : [page];
  return {
    id: params.id,
    col: params.col,
    row: params.row,
    name: params.name ?? "",
    ordinal: params.ordinal,
    kind: "normal",
    species: null,
    patrolRadius: null,
    ...(trap ? { showMarker: false } : {}),
    ...(pickup ? { showMarker: false } : {}),
    pages,
  };
}
