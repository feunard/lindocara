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
import {
  defaultEventPage,
  type EventTrigger,
  type MapEvent,
  type MapEventPage,
} from "./map-events.js";

export const EVENT_PRESETS = ["raw", "teleporter", "sign", "chest", "endgame"] as const;
export type EventPreset = (typeof EVENT_PRESETS)[number];

/** The default gold a `chest` preset grants until the author edits it — a positive, non-zero amount
 *  the `changeGold` parser accepts. */
const CHEST_DEFAULT_GOLD = 10;

/** The trigger + page-1 program a preset pre-fills onto a fresh scripted event. `selfMapId` is the
 *  current map's uuid, used only by `teleporter` for its same-map destination default. Pure so each
 *  preset's payload is pinned by a unit test rather than by reading the placement path. */
export function presetPageContent(
  preset: EventPreset,
  selfMapId: string,
): { trigger: EventTrigger; commands: EventCommand[] } {
  switch (preset) {
    case "raw":
      return { trigger: "action", commands: [] };
    case "teleporter":
      return {
        trigger: "player-touch",
        commands: [{ t: "teleport", mapId: selfMapId, col: 0, row: 0 }],
      };
    case "sign":
      return { trigger: "action", commands: [{ t: "say", text: "", name: null }] };
    case "chest":
      return { trigger: "action", commands: [{ t: "changeGold", amount: CHEST_DEFAULT_GOLD }] };
    case "endgame":
      // The optional adventure goal: stepping on this cell marks the party's save complete. The
      // author retargets the trigger or adds an epilogue `say` in the dialog.
      return { trigger: "player-touch", commands: [{ t: "endAdventure" }] };
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
}): MapEvent {
  const { trigger, commands } = presetPageContent(params.preset, params.selfMapId);
  const page: MapEventPage = { ...defaultEventPage(), trigger, commands };
  return {
    id: params.id,
    col: params.col,
    row: params.row,
    name: "",
    ordinal: params.ordinal,
    kind: "normal",
    species: null,
    patrolRadius: null,
    pages: [page],
  };
}
