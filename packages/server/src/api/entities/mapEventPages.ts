import { EVENT_TRIGGERS, MOVE_TYPES, SELF_SWITCHES } from "@lindocara/engine/map-events.js";
import { type Static, z } from "alepha";
import { $entity, db } from "alepha/orm";
import { mapEvents } from "./mapEvents.ts";

/**
 * Authoring entity for `map_event_page` (`packages/server/src/db/schema.ts:405`).
 *
 * A page's durable identity is `(eventId, position)`; `id` is an internal row id, freshly minted
 * every save because a save deletes and reinserts an event's pages wholesale. `condSwitchId`/
 * `condVariableId` are free-form ordinal strings with no registry yet (legacy Decision 5), so they
 * stay unconstrained text. `graphicAssetId` mirrors legacy's `.$type<EditorAssetId>()`: TypeScript
 * typing only, no DB enum — `EditorAssetId` is a type derived from a catalogue array, not an
 * `as const` literal tuple `z.enum()` can consume. `moveType`/`condSelfSwitch`/`trigger` ARE
 * DB-enforced enums in legacy and stay that way here.
 */
export const mapEventPages = $entity({
  name: "mapEventPages",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    eventId: db.ref(z.uuid(), () => mapEvents.cols.id, { onDelete: "cascade" }),
    position: z.integer().min(1).max(8),
    condSwitchId: z.string().optional(),
    condVariableId: z.string().optional(),
    condVariableMin: z.integer().optional(),
    condSelfSwitch: z.enum(SELF_SWITCHES).optional(),
    /** Typed as `EditorAssetId` at the app layer; stored as unconstrained text (matches legacy). */
    graphicAssetId: z.string().optional(),
    /** Neutral white by default; stored as a bounded RGB integer at the app boundary. */
    graphicTint: db.default(z.integer(), 0xffffff),
    moveType: z.enum(MOVE_TYPES),
    /** JSON array of validated NPC routine waypoints. */
    moveRoute: db.default(z.string(), "[]"),
    moveSpeed: z.integer(),
    moveFreq: z.integer(),
    optMoveAnim: z.boolean(),
    optStopAnim: z.boolean(),
    optDirFix: z.boolean(),
    optThrough: z.boolean(),
    optOnTop: z.boolean(),
    trigger: z.enum(EVENT_TRIGGERS),
    /**
     * The page's authored command program, a JSON array parsed by `parseEventCommands`
     * (`shared/event-commands.ts`). `'[]'` is the empty program a page carries until authored.
     */
    commands: db.default(z.string(), "[]"),
  }),
  indexes: [
    { columns: ["eventId", "position"], unique: true, name: "map_event_page_position_unique" },
    { columns: ["eventId"], name: "map_event_page_event_idx" },
  ],
});

export type MapEventPage = Static<typeof mapEventPages.schema>;
