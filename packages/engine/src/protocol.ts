/**
 * The wire format between browser and Durable Object.
 *
 * Clients send intent, never outcomes — with exactly one exception, and it is a deliberate one:
 * WHERE A HERO IS. The movement rule (`hd2d/hero-step.ts`) runs on the client, so a client reports
 * its own position (`{ t: "move" }`, tile units, grid centre as origin) and the server relays it
 * rather than re-simulating it. The sequenced `{ t: "input", seq }` command and the `ack` that
 * acknowledged it are gone with the reconciliation they existed for.
 *
 * Nothing else moved: damage, health, loot, XP, quest progression and every other outcome remain
 * the server's alone, and the position itself is still parsed defensively (finite, bounded, all
 * three axes) before anything reads it.
 *
 * Two messages sit close enough to that line to be worth naming here, because both look like an
 * outcome and neither is one:
 *
 * - `SelfState.mobility` travels the other way. It is the server GRANTING a displacement — cost,
 *   cooldown and resource already spent server-side — which the client then performs and reports
 *   like any other movement (the S3 spec, decision 6).
 * - `{ t: "drowned" }` reports that the movement rule the client owns ran out of breath. It carries
 *   no consequence: the server decides what drowning does, exactly as it decides every other way a
 *   hero dies. A client that reports it cannot say what it costs, and a client that never reports
 *   it has done no more than a client that never reports a position.
 */

import {
  type AuthoredQuestMarker,
  type AuthoredQuestTracker,
  MAX_AUTHORED_QUESTS,
  MAX_QUEST_OBJECTIVES,
  MAX_QUEST_REWARD_CHOICES,
  MAX_QUEST_REWARD_ITEMS,
  parseAuthoredQuestObjective,
  QUEST_CONTEXT_TEXT_MAX,
  QUEST_DESCRIPTION_MAX,
  QUEST_JOURNAL_SUMMARY_MAX,
  QUEST_OBJECTIVE_LABEL_MAX,
  QUEST_RECOMMENDED_LEVEL_MAX,
  QUEST_REWARD_AMOUNT_MAX,
  QUEST_TITLE_MAX,
} from "./adventure-state.js";
import {
  type AdventureCameraMode,
  type AdventureGameMode,
  isAdventureCameraMode,
  isAdventureGameMode,
} from "./adventure.js";
import { type AmbienceState, parseAmbienceState } from "./ambience.js";
import { type AdventureAudioConfig, parseAdventureAudioConfig } from "./audio-catalog.js";
import { parseBuildingDimensions } from "./buildings.js";
import {
  type CharacterAppearance,
  type Equipment,
  isValidAppearance,
  MAIN_HAND_ITEMS,
  OFF_HAND_ITEMS,
  type PrimaryColor,
} from "./character.js";
import {
  CONSUMABLE_IDS,
  type ConsumableCounts,
  type ConsumableId,
  isConsumableId,
} from "./consumables.js";
import type { CombatCooldownState } from "./cooldowns.js";
import { isLifeState, type LifeState } from "./death.js";
import { MAX_ELEMENT_SCALE, parseElementScale } from "./element-scale.js";
import {
  COMMAND_TEXT_MAX,
  ITEM_ID_MAX,
  ITEM_ID_PATTERN,
  MAX_CHOICE_OPTIONS,
} from "./event-commands.js";
import {
  type Cemetery,
  isMonsterRank,
  isMonsterSpecialTechnique,
  isMonsterSpecies,
  isValidClass,
  MONSTER_SPECIES_KIND,
  type MonsterKind,
  type MonsterRank,
  type MonsterSpecialTechnique,
  type MonsterSpecies,
  type NpcDefinition,
  type PlayerClass,
  QUEST_CHAPTERS,
  type QuestChapter,
  type QuestSite,
} from "./game.js";
import type { GroundVector } from "./ground.js";
import {
  HARVEST_PROFILE_LIMITS,
  type HarvestResourceKind,
  type HarvestTool,
  isHarvestResourceKind,
  isHarvestTool,
  isPeasantCarryKind,
  type PeasantCarryKind,
} from "./harvest.js";
import { decodeMap, MAX_HEIGHTFIELD_SIZE } from "./hd2d/map-data.js";
import { isUuid } from "./identifiers.js";
import type { ChatChannel } from "./interest.js";
import { MAP_LAYERS, type MapElement, parseMapElements } from "./map-data.js";
import { parseMapHeroSettings } from "./map-hero-settings.js";
import { type MapFixedLighting, parseMapFixedLighting } from "./map-lighting.js";
import type { MerchantDefinition } from "./merchant.js";
import {
  type ActiveMovementEffect,
  isMovementEffectKind,
  MOVEMENT_EFFECT_KINDS,
  validMovementEffectPower,
} from "./movement-effects.js";
import { isPartyMaterials, MAX_HARVEST_HITS, type PartyMaterials } from "./party-harvest-state.js";
import { QUEST_DIALOGUE_TEXT_MAX } from "./quests.js";
import type { ClassResourceState } from "./resources.js";
import { isSoundEffectId } from "./sfx-catalog.js";
import { isSkillSlot, type SkillSlot } from "./skills.js";
import { isTalentId, type TalentState } from "./talents.js";
import { parseTileLayer } from "./tile-layer-codec.js";
import { TILE_SIZE } from "./tilemap.js";
import { tilesetById } from "./tilesets/tiny-swords.js";
import {
  type CollisionElevation,
  type EditorAssetId,
  isEditorAssetId,
} from "./tiny-swords-catalog.js";
import { validVerticalDepth } from "./underground.js";
import { isZoneId, type ZoneId } from "./zones.js";

/**
 * The wire's absolute bound on a reported position, in TILE units. A heightfield is square and
 * centred on the origin, so no map can place a hero further than half its side from the centre —
 * and `decodeMap` refuses a side above `MAX_HEIGHTFIELD_SIZE`, which is what makes that half a real
 * number rather than a hope. Derived from the same constant on purpose: a bound stated here but
 * enforced nowhere would drop every frame from a legitimately larger map, silently, on both ends.
 * (It was briefly derived from `MAP_MAX_COLS` instead — the LEGACY tile-map validator's cap, which
 * governs no heightfield at all.) Elevation shares the bound: a stack of levels tall enough to
 * leave it is not a map any editor can author.
 *
 * This is a wire sanity bound, not the authority: the room still resolves every reported position
 * against the terrain it actually owns, and a position inside this bound may be far outside a small
 * map. It exists so a frame that could describe NO map is dropped before anything reads it.
 */
export const MOVE_COORDINATE_LIMIT = MAX_HEIGHTFIELD_SIZE / 2;

/**
 * Where the client says its own hero now is. The one place a client supplies a fact rather than an
 * intent — the movement rule runs there (see this file's header) — and therefore the one message
 * whose parsing carries the whole weight: all three axes and vertical velocity finite and bounded,
 * a real unit heading, and the three locomotion flags present rather than defaulted.
 *
 * `x`/`z` are the GROUND axes and `y` is ELEVATION. A payload carrying an `{x, y}` ground pair is a
 * half-converted sender, and it must be refused rather than read as a world on its side.
 */
export interface MoveMessage {
  t: "move";
  x: number;
  y: number;
  z: number;
  /** Vertical velocity, visual state only. Bounded like a coordinate before it is relayed. */
  vy: number;
  facing: GroundVector;
  airborne: boolean;
  swimming: boolean;
  gliding: boolean;
  /**
   * The `DisplacementStamp.seq` this client has adopted — see {@link DisplacementStamp}. The room
   * drops any frame whose stamp is not the one it currently holds, which is what stops a report
   * computed before a server-authored displacement from silently undoing it.
   *
   * **It adds no authority.** A client cannot raise this: it only repeats a number the server sent
   * it, and a value the server never issued matches nothing and is dropped like every other invalid
   * frame.
   */
  displacement: number;
}

/** @deprecated Transitional alias for the original one-field appearance model. */
export type Appearance = PrimaryColor;
export type ItemKind = "potion" | "gold" | "crystal";
export type QuestStatus = "available" | "active" | "ready" | "completed";

export interface Inventory {
  potions: number;
  gold: number;
  crystals: number;
  /** Session inventory for party heroes. Optional while older welcomes remain in flight. */
  consumables?: ConsumableCounts;
}

export interface QuestState {
  chapter?: QuestChapter;
  status: QuestStatus;
  progress: number;
  target: number;
  /** Unix milliseconds; present only while the ward run is active. */
  timerEndsAt?: number;
}

export interface PlayerSnapshot {
  id: string;
  nick: string;
  /** Ground axis. Tile units, grid centre as origin. */
  x: number;
  /** ELEVATION, not a ground axis — the trap this whole increment turns on. */
  y: number;
  /** The second GROUND axis. A snapshot with no `z` is a half-converted world on its side. */
  z: number;
  /** Vertical velocity for remote stretch/squash. Older recorded frames may omit it; live rooms
   *  always relay it and renderers treat absence as rest. */
  vy?: number;
  /**
   * The three locomotion flags, relayed from whoever owns this hero's movement rule. They are what
   * a remote renderer needs to draw the difference between a hero mid-jump, a hero swimming and a
   * hero under an open canopy; they are never re-derived from the position stream, which cannot
   * tell those three apart. All three are REQUIRED — see `parseMove`'s absent-key rule.
   */
  airborne: boolean;
  swimming: boolean;
  gliding: boolean;
  hp: number;
  maxHp: number;
  level: number;
  appearance: CharacterAppearance;
  class: PlayerClass;
  equipment: Equipment;
  /** Replaces the old `dead` boolean: death has three states, not two. */
  life: LifeState;
  /** Last non-zero movement accepted by the authority. Standing still preserves this direction. */
  facing: GroundVector;
  /** True while the warrior has deliberately toggled Iron Guard on. */
  guarding?: boolean;
  /** True while enemies cannot perceive this player. */
  invisible?: boolean;
  /** Ranger decoy authored by the room; appearance only on recipients. */
  afterimage?: { x: number; y: number; z: number; expiresAt: number };
  /** A departure decoy; its coordinates replace the hidden Rogue's real position for recipients. */
  silhouette?: boolean;
  /** Short server-authored success flourish; shared stock remains authoritative elsewhere. */
  peasantCarry?: { kind: PeasantCarryKind; until: number };
  /** Absolute server deadline for the bounded damage/power buff currently affecting this hero. */
  powerBuffUntil?: number;
  /** Refreshed while the hero is inside an allied Peasant camp's real healing radius. */
  healingAuraUntil?: number;
  /** Present while anticipation, impact or recovery is still relevant to remote rendering. */
  action: CombatActionSnapshot | null;
}

/** A body on the ground. Broadcast to everyone: the renderer draws it, a priest revives it. */
export interface CorpseSnapshot {
  /** The character id of whoever fell here. */
  id: string;
  nick: string;
  class: PlayerClass;
  appearance: CharacterAppearance;
  x: number;
  y: number;
  z: number;
}

export interface MonsterSnapshot {
  id: string;
  name: string;
  kind: MonsterKind;
  species: MonsterSpecies;
  rank: MonsterRank;
  specialTechnique: MonsterSpecialTechnique;
  x: number;
  y: number;
  z: number;
  hp: number;
  maxHp: number;
  dead: boolean;
  /** Changes whenever the server teleports this monster, so clients snap instead of interpolating
   * through the old chase position. Missing legacy frames read as revision zero. */
  positionRevision?: number;
  /** True while the authoritative runner pursuer is crossing a cliff or gap. */
  airborne?: boolean;
  /** Optional authored catalogue appearance. The species remains the authoritative combat model. */
  graphicAssetId?: string | null;
  /**
   * Viewer-specific authoritative aggro. This never identifies the target; it only tells this
   * recipient whether the living monster currently considers them a threat.
   */
  threatening?: boolean;
  revealed?: boolean;
  facing: GroundVector;
  action: CombatActionSnapshot | null;
  navigationDebug?: NavigationDebugSnapshot;
}

/** The immortal sea barrier. It is deliberately not a MonsterSnapshot: it has no HP, threat,
 * combat action or targetable identity anywhere on the wire. */
export interface SeaGuardianSnapshot {
  id: string;
  x: number;
  y: number;
  z: number;
  facing: GroundVector;
  state: import("./sea-guardian.js").SeaGuardianState;
  animationStartedAt: number;
  animationEndsAt: number | null;
}

export interface NavigationDebugSnapshot {
  state: import("./navigation.js").MonsterNavigationState;
  path: GroundVector[];
  destination: GroundVector | null;
  reason: string | null;
}

export interface GuardSnapshot {
  id: string;
  x: number;
  y: number;
  z: number;
  hp: number;
  maxHp: number;
  homeX: number;
  homeZ: number;
  fighting: boolean;
  graphicAssetId?: string | null;
  graphicTint?: number;
}

export interface LootSnapshot {
  id: string;
  kind: ItemKind;
  amount: number;
  x: number;
  y: number;
  z: number;
}

/** Local-only Rogue combat windows. Other recipients never need these authoritative deadlines. */
export interface RogueSelfState {
  openingUntil: number;
  stealthUntil: number;
  smokeProtectionUntil: number;
  shadowReturnUntil: number;
  danceMarksAvailableAt?: number;
  danceMarksUntil?: number;
}

export interface RangerSelfState {
  afterimageUntil: number;
}

/**
 * The server's standing permission for a held mobility skill — the one displacement a client
 * applies to its own hero without having computed it (the S3 spec, decision 6).
 *
 * The GRANT stays server-decided, and that is the whole point: class, unlock level, cooldown and
 * resource were all spent before this appeared, and it disappears the instant the action ends.
 * What the client owns is the displacement itself, reported back as an ordinary `move`.
 */
export interface MobilityGrant {
  /** The held action carrying the grant. It is applied ONCE per action id: a later `state` frame
   *  repeats the same grant, and re-arming a spent budget from it would make the skill unbounded. */
  actionId: string;
  /** Ground distance the grant is worth, in TILE units. */
  distance: number;
  /** Server deadline the grant lapses at, read against `serverNow` like every other deadline here. */
  until: number;
}

/**
 * The wire's sanity bound on a granted displacement, in tile units. The longest one authored today
 * is Pas de Lumen's 247.5 px, under four tiles; this is two orders above it and still far below a
 * value that could read as a position.
 */
export const MAX_MOBILITY_DISTANCE = 64;

/**
 * Where the ROOM last put this hero, and the stamp that says which displacement that was.
 *
 * The client owns where its hero is (the S3 spec, decision 4), but the server still MOVES one: a
 * ghost release, a Pas de Lumen landing, an authored teleport, a charge. Between the room deciding
 * and the client hearing, the client is still reporting positions computed from where it used to be
 * — so the room drops every frame whose {@link MoveMessage.displacement} is not `seq`, and the
 * client is unstuck by adopting the position below and echoing the new `seq` back.
 *
 * **The position travels WITH the stamp, in one frame, and that pairing is the whole design.** Split
 * across two messages — the stamp here, the position in the next `world.delta` — a client could
 * learn the new stamp first and immediately echo it under its OLD position, which the room would
 * then accept: the displacement undone by the very mechanism meant to protect it.
 *
 * `x`/`z` are the GROUND axes and `y` is ELEVATION, like everywhere else.
 */
export interface DisplacementStamp {
  /** Monotone, room-local, and reset by a cross-map handoff — the destination's welcome re-seeds it. */
  seq: number;
  x: number;
  y: number;
  z: number;
  /** Optional server-granted velocity applied after the stamped position is adopted. */
  impulse?: { x: number; y: number; z: number };
}

export interface SelfState {
  xp: number;
  xpToNext: number;
  inventory: Inventory;
  quest: QuestState;
  /** Authored party quests. Optional while rolling across an older server/client pair. */
  authoredQuests?: readonly AuthoredQuestTracker[];
  /** Per-player quest punctuation for active authored events on the current map. */
  authoredQuestMarkers?: readonly AuthoredQuestMarker[];
  /** Authoritative party-wide crafting stock; optional across rolling server/client upgrades. */
  materials?: PartyMaterials;
  life: LifeState;
  /** Where your body lies, so the HUD can point you at it. Null unless you are dead. */
  corpse: { x: number; y: number; z: number } | null;
  resource?: ClassResourceState;
  /** Unix milliseconds sampled with `cooldowns`, so clients never depend on wall-clock sync. */
  serverNow?: number;
  /** Absolute server deadlines, informational on the client and authoritative on the server. */
  cooldowns?: CombatCooldownState;
  /** Present on current servers; optional so an in-flight older welcome remains readable. */
  talents?: TalentState;
  /** Absolute server deadline shared by every consumable. */
  consumableCooldownUntil?: number;
  effects?: {
    damageUntil: number;
    forgottenUntil: number;
    invisibleUntil: number;
    resurrectionAt: number;
  };
  /** Room-local movement pickups currently granted by the authoritative event runtime. */
  movementEffects?: readonly ActiveMovementEffect[];
  /** Present only for the Rogue; all values are server deadlines and never persisted. */
  rogue?: RogueSelfState;
  /** Present only for the Ranger; the swap window is room-local. */
  ranger?: RangerSelfState;
  /** Present only while a held mobility skill is granting this hero a displacement to perform. */
  mobility?: MobilityGrant;
  /** Where the room last moved this hero, stamped. Always present: a hero the room has never moved
   *  carries `seq: 0` at the position it was admitted on. */
  displacement: DisplacementStamp;
}

export interface PartyMemberState {
  id: string;
  nick: string;
  hp: number;
  maxHp: number;
  life: LifeState;
}

export interface PartyState {
  id: string;
  leaderId: string;
  members: PartyMemberState[];
}

export type CombatActionKind = "basic" | "skill" | "monster_attack";

export interface CombatActionSnapshot {
  id: string;
  kind: CombatActionKind;
  skillId?: string;
  /** Contextual tool selected by the authority for the Peasant's basic attack. */
  peasantTool?: HarvestTool;
  direction: GroundVector;
  startedAt: number;
  impactAt: number;
  recoveryEndsAt: number;
  /** Present once a held action has been released or has reached its authoritative bound. */
  channelEndsAt?: number;
  resolved: boolean;
}

export const PROJECTILE_KINDS = [
  "arrow",
  "piercing_arrow",
  "volley_arrow",
  "heartseeker",
  "radiant_bolt",
  "healing_light",
  "hex_orb",
  "enemy_harpoon",
  "enemy_bomb",
  "homemade_bomb",
] as const;
export type ProjectileKind = (typeof PROJECTILE_KINDS)[number];

/** Strictly visual projectile state. Damage, healing and target filters never cross the wire. */
export interface ProjectileSnapshot {
  id: string;
  actionId: string;
  ownerId: string;
  /** Visual-only Tiny Swords faction, frozen when the authoritative projectile is spawned. */
  color: PrimaryColor;
  kind: ProjectileKind;
  x: number;
  y: number;
  z: number;
  direction: GroundVector;
  radius: number;
  spawnedAt: number;
  expiresAt: number;
}

export interface CombatAnimation {
  t: "animation";
  actionId: string;
  actorKind: "player" | "monster";
  actorId: string;
  action: "attack" | "skill";
  skillId?: string;
  /** Contextual tool selected by the authority for the Peasant's basic attack. */
  peasantTool?: HarvestTool;
  /** Resource actually under that tool, used only to select the matching harvest presentation. */
  peasantResource?: HarvestResourceKind;
  /** Server-authored: this cast owns at least one active talent for its skill slot. */
  talented?: true;
  /** Server-authored: the branch's named final technique is active for this cast. */
  evolved?: true;
  direction: GroundVector;
  startedAt: number;
  impactAt: number;
  /**
   * Ordered server-owned contacts for a genuinely sequential technique. Simultaneous projectiles
   * remain separate projectile snapshots and do not use this field.
   */
  impactTimes?: number[];
  recoveryEndsAt: number;
}

/** One server-resolved monster technique impact. This is presentation truth only: damage and
 * collision have already been resolved by the authoritative action system. */
export interface MonsterSpecialImpact {
  t: "monster.special_impact";
  actionId: string;
  actorId: string;
  technique: Exclude<MonsterSpecialTechnique, "none">;
  /** World-space centre of the authoritative action at resolution. */
  x: number;
  z: number;
  direction: GroundVector;
  /** Actual server tick that resolved the action, not a client-estimated deadline. */
  impactAt: number;
}

export interface RogueShadowDanceStrike {
  targetId: string;
  from: GroundVector;
  targetPosition: GroundVector;
  landing: GroundVector;
  impactAt: number;
  damage: number;
  killed: boolean;
  /** Present only for the future single-target evolution; base chains always use distinct ids. */
  repeated?: true;
}

/**
 * One complete server-resolved chain. Positions, ordering, damage and kills are results, never
 * client input; the browser receives only enough truth to replay the validated sequence.
 */
export interface RogueShadowDanceSequence {
  t: "rogue.shadow_dance";
  actionId: string;
  actorId: string;
  startedAt: number;
  endsAt: number;
  strikes: RogueShadowDanceStrike[];
  finalPosition: GroundVector;
}

export interface PriestLumenPortalVisual {
  t: "priest.lumen_portal";
  id: string;
  actorId: string;
  from: GroundVector;
  to: GroundVector;
  startedAt: number;
  endsAt: number;
}

export interface PriestLumenTrailVisual {
  t: "priest.lumen_trail";
  id: string;
  actorId: string;
  /** World-space centre points following every turn of the authoritative held movement. */
  points: GroundVector[];
  width: number;
  startedAt: number;
  endsAt: number;
}

export interface PriestPolarityOrbVisual {
  t: "priest.polarity_orb";
  id: string;
  actorId: string;
  x: number;
  z: number;
  maximumRadius: number;
  startedAt: number;
  returnsAt: number;
  endsAt: number;
}

/** Authoritative lifetime and position of a Peasant camp. */
export interface PeasantCampVisual {
  t: "peasant.camp";
  id: string;
  actorId: string;
  x: number;
  z: number;
  radius: number;
  startedAt: number;
  expiresAt: number;
}

export interface PeasantCampRemovedVisual {
  t: "peasant.camp_removed";
  id: string;
}

/** One authoritative ration launched by Casse-croûte catapulte. */
export interface PeasantRationVisual {
  t: "peasant.ration";
  id: string;
  actorId: string;
  originX: number;
  originY: number;
  originZ: number;
  x: number;
  y: number;
  z: number;
  launchedAt: number;
  landsAt: number;
  fadeAt: number;
  expiresAt: number;
}

export interface PeasantRationRemovedVisual {
  t: "peasant.ration_removed";
  id: string;
}

/** Private/team camp-chest state. `opened` is true only for the hero who just interacted. */
export interface PeasantCampBankVisual {
  t: "peasant.camp_bank";
  id: string;
  gold: number;
  opened: boolean;
}

/** One server-confirmed homemade-bomb explosion. */
export interface PeasantBombImpactVisual {
  t: "peasant.bomb_impact";
  actionId: string;
  actorId: string;
  /** The GROUND point the bomb went off over: `x` and `z`, never an elevation. */
  x: number;
  z: number;
  radius: number;
  impactAt: number;
}

/**
 * The active page of an authored map event, projected onto the wire. Appearance fields remain
 * presentation-only. Explicit `collider` and `harvest.collider` projections are gameplay data;
 * they travel in deltas because a page or resource state can change, and a client consumes those
 * rectangles directly rather than deriving them from an asset. `graphicAssetId` is
 * the active page's catalogue graphic (`null` is the authored blank tile); `onTop` chooses whether
 * it draws above the actors (a treetop) or in the ground decor pass. `col`/`row` remain the
 * authoritative target cell; movement metadata only tells the renderer how to present the trip
 * from its previous target.
 */
export type WorldEventCollider = readonly [
  x: number,
  y: number,
  width: number,
  height: number,
  elevation?: CollisionElevation,
];

export interface WorldEventSnapshot {
  id: string;
  col: number;
  row: number;
  /** Stable authored world height for content placed below the surface. */
  y?: number;
  /** Editor/runtime visibility storey. Omitted for surface content. */
  undergroundDepth?: number;
  graphicAssetId: string | null;
  /** Uniform visual/collider scale inherited by native harvest scenery. */
  scale?: number;
  graphicTint?: number;
  onTop: boolean;
  moveSpeed: number;
  moveFrequency: number;
  moveAnimation: boolean;
  directionFixed: boolean;
  /** The server-selected page accepts the interact action. Omitted means it does not. */
  interactive?: true;
  /** Server-selected rendering semantics; legacy omission means the one-cell marker treatment. */
  presentation?: "marker" | "native";
  /** Explicit authored choice for the small ground marker. Legacy omission means visible. */
  showMarker?: boolean;
  /** Stable authored height above the surface; visual bobbing never changes pickup contact. */
  elevationOffset?: number;
  /** Gentle renderer-owned levitation. Omitted for ordinary world events. */
  floating?: true;
  /** Active-page obstacle/hazard footprint, in authored pixels with a finite climbable top. */
  collider?: WorldEventCollider;
  /** Presentation state for an explicitly-authored harvest node. It never grants resources. */
  harvest?: {
    state: "intact" | "depleted";
    generation: number;
    hits: number;
    hitsRequired: number;
    lastHitAt: number | null;
    depletedAt: number | null;
    respawnAt: number | null;
    exhaustionBehavior: "replace" | "fade" | "hide";
    /**
     * Explicit replacement art advertised while the node is still intact so the renderer can
     * preload it. Appearance only: resource rules continue to come from the authored profile on
     * the server, never from this id or its catalogue path.
     */
    exhaustedAssetId: EditorAssetId | null;
    fadeDurationMs: number;
    /**
     * Present only while an intact node is waiting for its footprint to become unoccupied. The
     * server keeps collision disabled until then so a timed respawn or reconnect cannot trap an
     * actor already standing in the footprint.
     */
    collisionPending?: true;
    /** Authored-pixel footprint plus optional 1/2/3-level walkable collision height. */
    collider: WorldEventCollider | null;
  };
}

export interface WorldInfo {
  /** Names the room. It is no longer enough to find the terrain with: a map can live in D1, so the
   *  terrain travels below instead of being looked up. `zoneNameKey` is prose (an i18n key) and must
   *  never be reverse-matched back into a zone — this is the one field for identity. */
  zoneId: ZoneId;
  revision: number;
  zoneNameKey: string;
  /**
   * The terrain, and the ONLY terrain: the encoded `MapData` (`hd2d/map-data.ts`), in TILE units
   * with the grid centre as origin. The client decodes exactly these bytes, draws them, and
   * collides its own prediction against them.
   *
   * `tiles` and `colliders` — the pixel projection that used to travel beside this — are gone, and
   * with them the whole TILE→PIXEL BRIDGE. There is no second geometry to disagree with: the
   * server bakes its `ZoneTerrain` from this string (`zoneTerrainFromHeightfield`,
   * `engine/terrain-access.ts`) and the client bakes its own from the same string with the same
   * function. That is deliberately stronger than shipping a baked projection — a client cannot
   * disagree with a map it did not compute, and now it cannot disagree about the UNITS either.
   *
   * Not nullable: a map with no usable heightfield cannot produce a zone at all
   * (`zoneFromMapPayload` throws and every join is refused 4007), so a room that is sending a
   * welcome has one by construction.
   */
  heightfield: string;
  /**
   * What to draw on the ground. Appearance only — collision comes from `heightfield` above, the
   * same rule `layers` and `events` below follow. A client baking colliders from THIS list would
   * be a second, disagreeing bake of the rectangles the heightfield already carries.
   */
  elements: readonly MapElement[];
  /** Which tileset `layers` index into. */
  tilesetId: string;
  /**
   * Appearance only. Collision is already in `heightfield` above — exactly the rule `elements`
   * follows, and the reason adding layers to the wire introduces no new invariant.
   */
  layers: readonly string[];
  /**
   * The authored events whose active page currently holds. Graphic fields remain appearance only;
   * explicit harvest lifecycle/collision state is server-authored gameplay data. Page selection is
   * server-side (spec Decision 3/4); the client only draws/collides with what it is told is active.
   */
  events: readonly WorldEventSnapshot[];
  /** Room-owned building state. Omitted only by servers predating destructible scenery. */
  buildings?: readonly WorldBuildingSnapshot[];
  /** Fully resolved room audio: map overrides have already been applied by the server. */
  audio?: AdventureAudioConfig;
  /** Adventure-wide camera policy. Missing frames use the limited HD-2D side view. */
  cameraMode?: AdventureCameraMode;
  /** Adventure-wide gameplay rules. Missing frames use ordinary RPG rules. */
  gameMode?: AdventureGameMode;
  /** Server-authored class balance and ability availability for this map. */
  heroSettings?: import("./map-hero-settings.js").MapHeroSettings;
  /** The room's live ambience override. Absent from a server that predates it, and from a room
   *  nothing has overridden: both mean "the map's own sky, clock and soundtrack". */
  ambience?: AmbienceState;
  /** Missing preserves compatibility with rooms created before maps could disable their clock. */
  dayNightCycle?: boolean;
  /** Missing keeps disabled legacy maps fixed in daylight. */
  fixedLighting?: MapFixedLighting;
  /**
   * The grid's side, in cells — the whole extent of the world, because a heightfield is square and
   * centred on the origin. Coordinates therefore run `-size/2`..`+size/2` on both ground axes.
   *
   * It replaces the old pixel `width`/`height` pair, and the replacement is not cosmetic: a
   * consumer that divides a position by `width` to place it on a minimap gets the right answer only
   * if it also shifts the origin, and a single `size` is what makes that shift impossible to
   * forget. `playerSize`, `obstacles` and `safeZone` went with them — the first was a pixel body
   * nothing on the client read, and the last two had no source left once `ZoneTerrain` replaced the
   * pixel geometry (`safeZone` was already baked `null` on every authored map).
   */
  size: number;
  questNpc: NpcDefinition;
  questNpcs: NpcDefinition[];
  questSites: QuestSite[];
  cemeteries: Cemetery[];
  portals: readonly { id: string; nameKey: string; x: number; y: number }[];
  /** Reserved for an explicitly authored merchant; default and authored maps currently send null. */
  merchant: MerchantDefinition | null;
}

/** A static authored building whose durability and current appearance are server-owned. */
export interface WorldBuildingSnapshot {
  id: string;
  x: number;
  z: number;
  graphicAssetId: EditorAssetId;
  /** Explicit ruin art advertised up front so destruction never starts a texture download. */
  destroyedAssetId: EditorAssetId;
  orientation?: import("./element-orientation.js").ElementOrientation;
  rotation?: import("./element-orientation.js").ElementRotation;
  dimensions?: import("./buildings.js").BuildingDimensions;
  hp: number;
  maxHp: number;
  destructible: boolean;
  destroyed: boolean;
  /** True only while this intact building has an authored interior map. */
  interactive: boolean;
  /** Authoritative solid base retained for world geometry; doorway proximity is model-derived. */
  collider: import("./buildings.js").BuildingCollider;
}

export type QuestDialoguePhase = "offer" | "active" | "ready" | "completed" | "unavailable";

export interface QuestDialogueEntry {
  questId: string;
  /** Friendly authored name of the event/NPC/object currently speaking. */
  speakerName: string;
  title: string;
  text: string;
  category: "main" | "side" | "lore";
  region: string;
  landmark: string;
  giverName: string;
  phase: QuestDialoguePhase;
  canAccept: boolean;
  canTurnIn: boolean;
  rewardChoices: readonly { id: string; label: string }[];
}

/**
 * Sent by the browser. Actions contain intent only; every outcome is validated by the server. The
 * sole fact a client supplies is its own hero's position (`MoveMessage`).
 */
export type ClientMessage =
  | MoveMessage
  | { t: "attack" }
  | { t: "interact" }
  | { t: "sheep.hit"; eventId: string }
  | {
      t: "peasant.camp_gold";
      id: string;
      operation: "deposit" | "withdraw";
      amount: number;
    }
  | { t: "release" }
  /**
   * The movement rule the client owns ran out of breath (`stepHero`'s `noyade`). It is a REPORT,
   * not an outcome: it names no damage, no death and no position, and the room decides what
   * drowning costs — the same boundary every other way of dying already crosses. The room drops it
   * unless the position stream this same client is sending says the hero is in the water.
   */
  | { t: "drowned" }
  | { t: "skill"; slot: SkillSlot; direction?: GroundVector }
  | { t: "skill.release"; slot: SkillSlot }
  | { t: "talent.unlock"; nodeId: string }
  | { t: "talent.reset" }
  | { t: "use"; item: "potion" }
  | { t: "item.use"; item: ConsumableId }
  | { t: "merchant.buy"; item: ConsumableId }
  | { t: "chat"; channel: ChatChannel; text: string }
  | { t: "party.create" }
  | { t: "party.invite"; playerId: string }
  | { t: "party.accept"; inviteId: string }
  | { t: "party.refuse"; inviteId: string }
  | { t: "party.leave" }
  | { t: "party.kick"; playerId: string }
  | { t: "party.dissolve" }
  | { t: "world.resync" }
  | { t: "navigation.debug"; enabled: boolean }
  // The two dialogue intents (spec Decision 4). Both are cheap intents (the connection window cost
  // class): `event.advance` turns the say page; `event.choose` picks an option. `runId` names the run
  // the panel belongs to; `index` is a wire-bounded option index the server RE-VALIDATES against the
  // live pending offer regardless — client input is never an authoritative outcome.
  | { t: "event.advance"; runId: string }
  | { t: "event.choose"; runId: string; index: number }
  | {
      t: "quest.action";
      conversationId: string;
      questId?: string;
      action: "accept" | "refuse" | "turn-in" | "close";
      rewardChoiceId?: string;
    }
  /** Journal intent only. The coordinator resolves ownership, status and abandonability. */
  | { t: "quest.abandon"; questId: string };

export type EventTone = "info" | "good" | "bad";

/**
 * Every event the server can emit. The server sends a code and params; the client owns the
 * localized template (`event.<code>` in `shared/i18n/`). No prose crosses the wire.
 */
export const EVENT_CODES = [
  "combat.hit",
  "combat.hurt",
  "hazard.hit",
  "monster.defeated",
  "level_up",
  "interact.nothing",
  "quest.accepted",
  "quest.progress",
  "quest.fulfilled",
  "quest.blessing",
  "quest.site_progress",
  "quest.site_wrong",
  "quest.run_started",
  "quest.run_expired",
  "quest.chapter_ready",
  "quest.site_harvested",
  "authored_quest.action_failed",
  "authored_quest.reward",
  "potion.used",
  "item.used",
  "item.cooldown",
  "item.invalid",
  "item.resurrected",
  "merchant.purchased",
  "merchant.insufficient",
  "player.down",
  "loot.picked",
  "item.full",
  "heal.cast",
  "heal.received",
  "death.fallen",
  "death.released",
  "death.reclaimed",
  "death.resurrected",
  "resurrect.cast",
  "resurrect.nobody",
  "resurrect.not_priest",
  "skill.cast",
  "skill.blocked",
  "skill.no_target",
  "skill.locked",
  "skill.disabled",
  "resource.insufficient",
  "peasant.harvested",
  "peasant.materials_insufficient",
  "peasant.support_unavailable",
  "peasant.camp_gold_unavailable",
  "peasant.camp_gold_insufficient",
  "peasant.camp_gold_deposited",
  "peasant.camp_gold_withdrawn",
  "talent.unlocked",
  "talent.reset",
  "talent.invalid",
  "talent.perfect_parry",
  "cheat.disabled",
  "cheat.help",
  "cheat.unknown",
  "cheat.level",
  "cheat.nodead_on",
  "cheat.nodead_off",
  "cheat.heal",
  "cheat.hurt",
  "cheat.resource",
  "cheat.resource_none",
  "cheat.cooldowns",
  "cheat.loot",
  "cheat.death",
  "cheat.ghost",
  "cheat.revive",
  "cheat.reset",
  "cheat.where",
  "cheat.tp",
  "cheat.tp_blocked",
  "cheat.alive_only",
  "cheat.already_alive",
  "cheat.already_ghost",
  "party.created",
  "party.invited",
  "party.joined",
  "party.refused",
  "party.left",
  "party.kicked",
  "party.dissolved",
  "party.invalid",
  "party.forbidden",
  "party.full",
  "presence.replaced",
  "presence.lost",
  "room.full",
  "room.invalid_location",
  "zone.transition",
  "zone.transition_denied",
  "zone.transition_cooldown",
  "zone.transition_failed",
  "teleport.exhausted",
  "teleport.insufficient_gold",
  "teleport.insufficient_crystals",
  "adventure.victory",
] as const;
export type EventCode = (typeof EVENT_CODES)[number];
export type EventParams = Record<string, string | number>;

export interface EntityDelta<T extends { id: string }> {
  upsert: T[];
  remove: string[];
}

export interface WorldView {
  players: PlayerSnapshot[];
  seaGuardians: SeaGuardianSnapshot[];
  monsters: MonsterSnapshot[];
  guards: GuardSnapshot[];
  loot: LootSnapshot[];
  corpses: CorpseSnapshot[];
  projectiles: ProjectileSnapshot[];
}

/** Sent by the Durable Object. */
export type ServerMessage =
  | {
      t: "welcome";
      tick: number;
      selfId: string;
      world: WorldInfo;
      players: PlayerSnapshot[];
      seaGuardians: SeaGuardianSnapshot[];
      monsters: MonsterSnapshot[];
      guards: GuardSnapshot[];
      loot: LootSnapshot[];
      corpses: CorpseSnapshot[];
      projectiles: ProjectileSnapshot[];
      self: SelfState;
    }
  | {
      t: "world.delta";
      tick: number;
      players: EntityDelta<PlayerSnapshot>;
      seaGuardians: EntityDelta<SeaGuardianSnapshot>;
      monsters: EntityDelta<MonsterSnapshot>;
      guards: EntityDelta<GuardSnapshot>;
      loot: EntityDelta<LootSnapshot>;
      corpses: EntityDelta<CorpseSnapshot>;
      projectiles: EntityDelta<ProjectileSnapshot>;
      /** Room-scoped, never interest-filtered: every recipient sees the same events. Upserts a
       *  changed/new active page, removes an event that went dormant. Appearance only. */
      events: EntityDelta<WorldEventSnapshot>;
    }
  | ({ t: "world.resync"; tick: number; events: WorldEventSnapshot[] } & WorldView)
  | { t: "world.resync_required" }
  | { t: "state"; self: SelfState }
  | { t: "chat"; channel: ChatChannel; from: string; text: string }
  | { t: "party.invite"; inviteId: string; fromId: string; from: string; expiresAt: number }
  | { t: "party.state"; party: PartyState | null }
  | { t: "merchant.open" }
  | { t: "building.state"; building: WorldBuildingSnapshot }
  | {
      t: "sea_guardian.devour";
      guardianId: string;
      victimId: string;
      x: number;
      z: number;
      at: number;
    }
  | CombatAnimation
  | MonsterSpecialImpact
  | RogueShadowDanceSequence
  | PriestLumenPortalVisual
  | PriestLumenTrailVisual
  | PriestPolarityOrbVisual
  | PeasantCampVisual
  | PeasantCampRemovedVisual
  | PeasantRationVisual
  | PeasantRationRemovedVisual
  | PeasantCampBankVisual
  | PeasantBombImpactVisual
  /**
   * A machine event code, optionally anchored at a GROUND point so the client can float it in the
   * world rather than only logging it. `x`/`z`, like every other position on this wire — the second
   * axis was `y` in the pixel world, and renaming it is what turned two dozen emit sites that had
   * quietly started shipping the actor's ELEVATION into compiler errors.
   */
  | { t: "event"; code: EventCode; params?: EventParams; tone: EventTone; x?: number; z?: number }
  // The three dialogue beats pushed to the run's TRIGGERER only (spec Decision 4: dialogue is a
  // per-player panel). `text`/`name`/`prompt`/`options` are AUTHORED PROSE — see `isAuthoredText`:
  // the one sanctioned exception to codes-not-sentences, because the author wrote it and no dictionary
  // can hold it. Every field is still size-capped and defensively parsed like any other wire data.
  | { t: "event.say"; runId: string; text: string; name?: string }
  | { t: "event.choices"; runId: string; prompt: string; options: string[] }
  | { t: "event.close"; runId: string }
  /** An authored cue for the run's triggerer. `soundId` is a CATALOGUE key, never a path, so this
   *  is a code like every other server message rather than an exception to the rule. */
  | { t: "event.sound"; runId: string; soundId: string }
  /**
   * The room's live sky, clock and soundtrack, for EVERY player in it rather than for a triggerer.
   * Always complete, never a patch: `null` in a field means the map's own value, which is also what
   * a room that has never been overridden reports.
   */
  | ({ t: "ambience" } & AmbienceState)
  | {
      t: "quest.open";
      conversationId: string;
      entries: QuestDialogueEntry[];
    }
  | {
      t: "quest.result";
      conversationId: string;
      questId: string;
      speakerName: string;
      title: string;
      text: string;
      outcome: "accepted" | "refused" | "completed" | "failed";
    }
  | { t: "quest.close"; conversationId: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isWireId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 64 &&
    /^[A-Za-z0-9_-]+$/.test(value)
  );
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Authored prose off the wire (a `say`/`choices` field). This is the one sanctioned exception to
 * codes-not-sentences (spec Decision 4): the text is the AUTHOR's own data, which no dictionary can
 * hold, so it crosses as data rather than an i18n code — while every chrome string around the panel
 * stays i18n-governed. It is still untrusted input: bounded by `COMMAND_TEXT_MAX`, the exact cap the
 * command parser (`event-commands.ts`) enforces on the same field, so the wire and the store agree.
 */
function isAuthoredText(value: unknown): value is string {
  return typeof value === "string" && value.length <= COMMAND_TEXT_MAX;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isBoundedString(value: unknown, maximum: number, allowEmpty = false): value is string {
  return typeof value === "string" && value.length <= maximum && (allowEmpty || value.length > 0);
}

/**
 * A point on the GROUND PLANE: `x` and `z`. There is no ground `y` any more — a payload carrying
 * one is either an older build or a half-converted sender, and both must be refused rather than
 * read as a world on its side.
 */
function isPosition(value: unknown): value is GroundVector {
  return isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.z);
}

/**
 * A full world position: the two ground axes plus ELEVATION. Every actor snapshot carries all
 * three, so a missing `z` drops the frame instead of collapsing the world onto one axis.
 */
function isWorldPosition(value: Record<string, unknown>): boolean {
  return isFiniteNumber(value.x) && isFiniteNumber(value.y) && isFiniteNumber(value.z);
}

function isCombatImpactTimes(
  value: unknown,
  firstImpactAt: number,
  recoveryEndsAt: number,
): value is number[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > 8) return false;
  let previousImpactAt = firstImpactAt;
  for (let index = 0; index < value.length; index += 1) {
    const impactAt = value[index];
    if (
      !isFiniteNumber(impactAt) ||
      impactAt < firstImpactAt ||
      impactAt > recoveryEndsAt ||
      (index === 0 ? impactAt !== firstImpactAt : impactAt <= previousImpactAt)
    )
      return false;
    previousImpactAt = impactAt;
  }
  return true;
}

function isRogueShadowDanceSequence(value: unknown): value is RogueShadowDanceSequence {
  if (
    !isRecord(value) ||
    value.t !== "rogue.shadow_dance" ||
    !isWireId(value.actionId) ||
    !isWireId(value.actorId) ||
    !isFiniteNumber(value.startedAt) ||
    !isFiniteNumber(value.endsAt) ||
    value.endsAt < value.startedAt ||
    !Array.isArray(value.strikes) ||
    value.strikes.length < 1 ||
    value.strikes.length > 5 ||
    !isPosition(value.finalPosition)
  )
    return false;
  let previousImpactAt = value.startedAt;
  for (const strike of value.strikes) {
    if (
      !isRecord(strike) ||
      !isWireId(strike.targetId) ||
      !isPosition(strike.from) ||
      !isPosition(strike.targetPosition) ||
      !isPosition(strike.landing) ||
      !isFiniteNumber(strike.impactAt) ||
      strike.impactAt < previousImpactAt ||
      strike.impactAt > value.endsAt ||
      !isNonNegativeInteger(strike.damage) ||
      typeof strike.killed !== "boolean" ||
      (strike.repeated !== undefined && strike.repeated !== true)
    )
      return false;
    previousImpactAt = strike.impactAt;
  }
  const last = value.strikes.at(-1);
  return Boolean(
    last && last.landing.x === value.finalPosition.x && last.landing.z === value.finalPosition.z,
  );
}

function isPriestLumenPortalVisual(value: unknown): value is PriestLumenPortalVisual {
  return (
    isRecord(value) &&
    value.t === "priest.lumen_portal" &&
    isWireId(value.id) &&
    isWireId(value.actorId) &&
    isPosition(value.from) &&
    isPosition(value.to) &&
    isFiniteNumber(value.startedAt) &&
    isFiniteNumber(value.endsAt) &&
    value.endsAt >= value.startedAt &&
    value.endsAt - value.startedAt <= 10_000
  );
}

function isPriestLumenTrailVisual(value: unknown): value is PriestLumenTrailVisual {
  return (
    isRecord(value) &&
    value.t === "priest.lumen_trail" &&
    isWireId(value.id) &&
    isWireId(value.actorId) &&
    Array.isArray(value.points) &&
    value.points.length >= 2 &&
    value.points.length <= 96 &&
    value.points.every(isPosition) &&
    isFiniteNumber(value.width) &&
    value.width > 0 &&
    value.width <= 64 &&
    isFiniteNumber(value.startedAt) &&
    isFiniteNumber(value.endsAt) &&
    value.endsAt >= value.startedAt &&
    value.endsAt - value.startedAt <= 10_000
  );
}

function isPriestPolarityOrbVisual(value: unknown): value is PriestPolarityOrbVisual {
  return (
    isRecord(value) &&
    value.t === "priest.polarity_orb" &&
    isWireId(value.id) &&
    isWireId(value.actorId) &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.z) &&
    isFiniteNumber(value.maximumRadius) &&
    value.maximumRadius >= 0 &&
    isFiniteNumber(value.startedAt) &&
    isFiniteNumber(value.returnsAt) &&
    isFiniteNumber(value.endsAt) &&
    value.startedAt <= value.returnsAt &&
    value.returnsAt <= value.endsAt &&
    value.endsAt - value.startedAt <= 10_000
  );
}

function isPeasantCampVisual(value: unknown): value is PeasantCampVisual {
  return (
    isRecord(value) &&
    // `x`/`z`, and the key list is the half that a type change cannot reach: `hasOnlyKeys` is
    // string-keyed and the branch ends in a cast, so a stale `"y"` here compiles clean and DROPS
    // every frame of this kind at runtime — silently, with no camp ever appearing.
    hasOnlyKeys(value, ["t", "id", "actorId", "x", "z", "radius", "startedAt", "expiresAt"]) &&
    value.t === "peasant.camp" &&
    isWireId(value.id) &&
    isWireId(value.actorId) &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.z) &&
    isFiniteNumber(value.radius) &&
    value.radius > 0 &&
    value.radius <= 512 &&
    isFiniteNumber(value.startedAt) &&
    isFiniteNumber(value.expiresAt) &&
    value.expiresAt >= value.startedAt &&
    value.expiresAt - value.startedAt <= 120_000
  );
}

function isPeasantCampRemovedVisual(value: unknown): value is PeasantCampRemovedVisual {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["t", "id"]) &&
    value.t === "peasant.camp_removed" &&
    isWireId(value.id)
  );
}

function isPeasantRationVisual(value: unknown): value is PeasantRationVisual {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      "t",
      "id",
      "actorId",
      "originX",
      "originY",
      "originZ",
      "x",
      "y",
      "z",
      "launchedAt",
      "landsAt",
      "fadeAt",
      "expiresAt",
    ]) &&
    value.t === "peasant.ration" &&
    isWireId(value.id) &&
    isWireId(value.actorId) &&
    isFiniteNumber(value.originX) &&
    isFiniteNumber(value.originY) &&
    isFiniteNumber(value.originZ) &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isFiniteNumber(value.z) &&
    isFiniteNumber(value.launchedAt) &&
    isFiniteNumber(value.landsAt) &&
    isFiniteNumber(value.fadeAt) &&
    isFiniteNumber(value.expiresAt) &&
    value.launchedAt <= value.landsAt &&
    value.landsAt <= value.fadeAt &&
    value.fadeAt <= value.expiresAt &&
    value.expiresAt - value.launchedAt <= 120_000
  );
}

function isPeasantRationRemovedVisual(value: unknown): value is PeasantRationRemovedVisual {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["t", "id"]) &&
    value.t === "peasant.ration_removed" &&
    isWireId(value.id)
  );
}

function isPeasantCampBankVisual(value: unknown): value is PeasantCampBankVisual {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["t", "id", "gold", "opened"]) &&
    value.t === "peasant.camp_bank" &&
    isWireId(value.id) &&
    typeof value.gold === "number" &&
    Number.isSafeInteger(value.gold) &&
    value.gold >= 0 &&
    value.gold <= 999_999_999 &&
    typeof value.opened === "boolean"
  );
}

function isPeasantBombImpactVisual(value: unknown): value is PeasantBombImpactVisual {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["t", "actionId", "actorId", "x", "z", "radius", "impactAt"]) &&
    value.t === "peasant.bomb_impact" &&
    isWireId(value.actionId) &&
    isWireId(value.actorId) &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.z) &&
    isFiniteNumber(value.radius) &&
    value.radius > 0 &&
    value.radius <= 512 &&
    isFiniteNumber(value.impactAt)
  );
}

function isEquipment(value: unknown): value is Equipment {
  return (
    isRecord(value) &&
    typeof value.mainHand === "string" &&
    (MAIN_HAND_ITEMS as readonly string[]).includes(value.mainHand) &&
    (value.offHand === null ||
      (typeof value.offHand === "string" &&
        (OFF_HAND_ITEMS as readonly string[]).includes(value.offHand)))
  );
}

/** A unit heading across the ground. Same axes as `isPosition`: `x` and `z`. */
function isDirection(value: unknown): value is GroundVector {
  if (!isRecord(value) || !isFiniteNumber(value.x) || !isFiniteNumber(value.z)) return false;
  const length = Math.hypot(value.x, value.z);
  return length >= 0.999 && length <= 1.001;
}

function isActionSnapshot(
  value: unknown,
  actorKind: "player" | "monster",
): value is CombatActionSnapshot {
  if (value === null) return false;
  if (
    !isRecord(value) ||
    !isWireId(value.id) ||
    (value.kind !== "basic" && value.kind !== "skill" && value.kind !== "monster_attack") ||
    !isDirection(value.direction) ||
    !isFiniteNumber(value.startedAt) ||
    !isFiniteNumber(value.impactAt) ||
    !isFiniteNumber(value.recoveryEndsAt) ||
    value.startedAt > value.impactAt ||
    value.impactAt > value.recoveryEndsAt ||
    (value.channelEndsAt !== undefined &&
      (!isFiniteNumber(value.channelEndsAt) ||
        value.channelEndsAt < value.impactAt ||
        value.channelEndsAt > value.recoveryEndsAt)) ||
    (value.peasantTool !== undefined &&
      (!isHarvestTool(value.peasantTool) ||
        actorKind !== "player" ||
        value.kind !== "basic" ||
        value.skillId !== "woodcutters_swing")) ||
    typeof value.resolved !== "boolean"
  ) {
    return false;
  }
  if (actorKind === "player") {
    return (
      (value.kind === "skill" || value.kind === "basic") &&
      typeof value.skillId === "string" &&
      value.skillId.length >= 1 &&
      value.skillId.length <= 64
    );
  }
  return (
    value.kind === "monster_attack" &&
    (value.skillId === undefined ||
      (isMonsterSpecialTechnique(value.skillId) && value.skillId !== "none"))
  );
}

function isPlayerSnapshot(value: unknown): value is PlayerSnapshot {
  return (
    isRecord(value) &&
    isWireId(value.id) &&
    isBoundedString(value.nick, 32) &&
    isWorldPosition(value) &&
    (value.vy === undefined || isMoveCoordinate(value.vy)) &&
    typeof value.airborne === "boolean" &&
    typeof value.swimming === "boolean" &&
    typeof value.gliding === "boolean" &&
    isFiniteNumber(value.hp) &&
    value.hp >= 0 &&
    isFiniteNumber(value.maxHp) &&
    value.maxHp > 0 &&
    value.hp <= value.maxHp &&
    Number.isSafeInteger(value.level) &&
    (value.level as number) >= 1 &&
    isValidAppearance(value.appearance) &&
    isValidClass(value.class) &&
    isEquipment(value.equipment) &&
    isLifeState(value.life) &&
    isDirection(value.facing) &&
    (value.guarding === undefined || typeof value.guarding === "boolean") &&
    (value.invisible === undefined || typeof value.invisible === "boolean") &&
    (value.afterimage === undefined ||
      (isRecord(value.afterimage) &&
        isWorldPosition(value.afterimage) &&
        isFiniteNumber(value.afterimage.expiresAt))) &&
    (value.silhouette === undefined || typeof value.silhouette === "boolean") &&
    (value.peasantCarry === undefined ||
      (value.class === "peasant" &&
        isRecord(value.peasantCarry) &&
        isPeasantCarryKind(value.peasantCarry.kind) &&
        Number.isSafeInteger(value.peasantCarry.until) &&
        (value.peasantCarry.until as number) >= 0)) &&
    (value.powerBuffUntil === undefined ||
      (Number.isSafeInteger(value.powerBuffUntil) && (value.powerBuffUntil as number) >= 0)) &&
    (value.healingAuraUntil === undefined ||
      (Number.isSafeInteger(value.healingAuraUntil) && (value.healingAuraUntil as number) >= 0)) &&
    (value.action === null || isActionSnapshot(value.action, "player"))
  );
}

function isMonsterSnapshot(value: unknown): value is MonsterSnapshot {
  return (
    isRecord(value) &&
    isWireId(value.id) &&
    typeof value.name === "string" &&
    value.name.length <= 100 &&
    isMonsterSpecies(value.species) &&
    value.kind === MONSTER_SPECIES_KIND[value.species] &&
    isMonsterRank(value.rank) &&
    isMonsterSpecialTechnique(value.specialTechnique) &&
    isWorldPosition(value) &&
    isFiniteNumber(value.hp) &&
    value.hp >= 0 &&
    isFiniteNumber(value.maxHp) &&
    value.maxHp > 0 &&
    value.hp <= value.maxHp &&
    typeof value.dead === "boolean" &&
    (value.positionRevision === undefined ||
      (Number.isSafeInteger(value.positionRevision) && (value.positionRevision as number) >= 0)) &&
    (value.airborne === undefined || typeof value.airborne === "boolean") &&
    (value.graphicAssetId === undefined ||
      value.graphicAssetId === null ||
      isEditorAssetId(value.graphicAssetId)) &&
    (value.threatening === undefined || typeof value.threatening === "boolean") &&
    (value.revealed === undefined || typeof value.revealed === "boolean") &&
    isDirection(value.facing) &&
    (value.navigationDebug === undefined || isNavigationDebug(value.navigationDebug)) &&
    (value.action === null || isActionSnapshot(value.action, "monster"))
  );
}

function isSeaGuardianSnapshot(value: unknown): value is SeaGuardianSnapshot {
  return (
    isRecord(value) &&
    isWireId(value.id) &&
    isWorldPosition(value) &&
    isDirection(value.facing) &&
    (value.state === "patrol" || value.state === "chase" || value.state === "attack") &&
    isFiniteNumber(value.animationStartedAt) &&
    (value.animationEndsAt === null ||
      (isFiniteNumber(value.animationEndsAt) && value.animationEndsAt >= value.animationStartedAt))
  );
}

function isNavigationDebug(value: unknown): value is NavigationDebugSnapshot {
  const states = ["idle", "patrol", "chase", "return", "waiting_path", "unreachable"];
  return (
    isRecord(value) &&
    typeof value.state === "string" &&
    states.includes(value.state) &&
    Array.isArray(value.path) &&
    value.path.length <= 10_000 &&
    value.path.every(isPosition) &&
    (value.destination === null || isPosition(value.destination)) &&
    (value.reason === null || isBoundedString(value.reason, 256, true))
  );
}

function isGuardSnapshot(value: unknown): value is GuardSnapshot {
  return (
    isRecord(value) &&
    isWireId(value.id) &&
    isWorldPosition(value) &&
    isFiniteNumber(value.hp) &&
    value.hp >= 0 &&
    isFiniteNumber(value.maxHp) &&
    value.maxHp > 0 &&
    value.hp <= value.maxHp &&
    isFiniteNumber(value.homeX) &&
    isFiniteNumber(value.homeZ) &&
    typeof value.fighting === "boolean" &&
    (value.graphicAssetId === undefined ||
      value.graphicAssetId === null ||
      isEditorAssetId(value.graphicAssetId)) &&
    (value.graphicTint === undefined ||
      (Number.isSafeInteger(value.graphicTint) &&
        (value.graphicTint as number) >= 0 &&
        (value.graphicTint as number) <= 0xffffff))
  );
}

function isLootSnapshot(value: unknown): value is LootSnapshot {
  return (
    isRecord(value) &&
    isWireId(value.id) &&
    (value.kind === "potion" || value.kind === "gold" || value.kind === "crystal") &&
    Number.isSafeInteger(value.amount) &&
    (value.amount as number) > 0 &&
    isWorldPosition(value)
  );
}

function isCorpseSnapshot(value: unknown): value is CorpseSnapshot {
  return (
    isRecord(value) &&
    isWireId(value.id) &&
    isBoundedString(value.nick, 32) &&
    isValidClass(value.class) &&
    isValidAppearance(value.appearance) &&
    isWorldPosition(value)
  );
}

function isProjectileSnapshot(value: unknown): value is ProjectileSnapshot {
  return (
    isRecord(value) &&
    isWireId(value.id) &&
    isWireId(value.actionId) &&
    isWireId(value.ownerId) &&
    (value.color === "azure" ||
      value.color === "ember" ||
      value.color === "moss" ||
      value.color === "violet") &&
    typeof value.kind === "string" &&
    (PROJECTILE_KINDS as readonly string[]).includes(value.kind) &&
    isWorldPosition(value) &&
    isDirection(value.direction) &&
    isFiniteNumber(value.radius) &&
    value.radius > 0 &&
    isFiniteNumber(value.spawnedAt) &&
    isFiniteNumber(value.expiresAt) &&
    value.spawnedAt <= value.expiresAt
  );
}

function isInventory(value: unknown): value is Inventory {
  if (
    !isRecord(value) ||
    !isNonNegativeInteger(value.potions) ||
    !isNonNegativeInteger(value.gold) ||
    !isNonNegativeInteger(value.crystals)
  ) {
    return false;
  }
  if (value.consumables === undefined) return true;
  const consumables = value.consumables;
  return (
    isRecord(consumables) && CONSUMABLE_IDS.every((id) => isNonNegativeInteger(consumables[id]))
  );
}

function isQuestState(value: unknown): value is QuestState {
  return (
    isRecord(value) &&
    (value.chapter === undefined ||
      (typeof value.chapter === "string" &&
        (QUEST_CHAPTERS as readonly string[]).includes(value.chapter))) &&
    (value.status === "available" ||
      value.status === "active" ||
      value.status === "ready" ||
      value.status === "completed") &&
    isNonNegativeInteger(value.progress) &&
    isNonNegativeInteger(value.target) &&
    (value.timerEndsAt === undefined ||
      (isFiniteNumber(value.timerEndsAt) && value.timerEndsAt >= 0))
  );
}

function isQuestRewardItem(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.itemId === "string" &&
    value.itemId.length <= ITEM_ID_MAX &&
    ITEM_ID_PATTERN.test(value.itemId) &&
    Number.isSafeInteger(value.quantity) &&
    (value.quantity as number) > 0 &&
    (value.quantity as number) <= QUEST_REWARD_AMOUNT_MAX
  );
}

function isQuestRewardChoice(value: unknown): boolean {
  return (
    isRecord(value) &&
    isWireId(value.id) &&
    isBoundedString(value.label, QUEST_OBJECTIVE_LABEL_MAX) &&
    isNonNegativeInteger(value.experience) &&
    value.experience <= QUEST_REWARD_AMOUNT_MAX &&
    isNonNegativeInteger(value.gold) &&
    value.gold <= QUEST_REWARD_AMOUNT_MAX &&
    Array.isArray(value.items) &&
    value.items.length <= MAX_QUEST_REWARD_ITEMS &&
    value.items.every(isQuestRewardItem)
  );
}

function isAuthoredQuestTracker(value: unknown): value is AuthoredQuestTracker {
  if (
    !isRecord(value) ||
    !isWireId(value.id) ||
    !isBoundedString(value.title, QUEST_TITLE_MAX) ||
    !isBoundedString(value.description, QUEST_DESCRIPTION_MAX, true) ||
    !isBoundedString(value.journalSummary, QUEST_JOURNAL_SUMMARY_MAX, true) ||
    (value.category !== "main" && value.category !== "side" && value.category !== "lore") ||
    !isBoundedString(value.region, QUEST_CONTEXT_TEXT_MAX, true) ||
    !isBoundedString(value.landmark, QUEST_CONTEXT_TEXT_MAX, true) ||
    !isBoundedString(value.giverName, QUEST_CONTEXT_TEXT_MAX, true) ||
    !isBoundedString(value.knownConsequence, QUEST_JOURNAL_SUMMARY_MAX, true) ||
    !(
      value.recommendedLevel === null ||
      (Number.isSafeInteger(value.recommendedLevel) &&
        (value.recommendedLevel as number) >= 1 &&
        (value.recommendedLevel as number) <= QUEST_RECOMMENDED_LEVEL_MAX)
    ) ||
    (value.scope !== "personal" && value.scope !== "party") ||
    typeof value.repeatable !== "boolean" ||
    typeof value.abandonable !== "boolean" ||
    (value.completion !== "automatic" && value.completion !== "turn-in") ||
    (value.objectiveMode !== "simultaneous" && value.objectiveMode !== "sequential") ||
    (value.status !== "available" &&
      value.status !== "active" &&
      value.status !== "ready" &&
      value.status !== "completed" &&
      value.status !== "failed" &&
      value.status !== "abandoned") ||
    !Array.isArray(value.objectives) ||
    value.objectives.length > MAX_QUEST_OBJECTIVES ||
    !isRecord(value.rewards)
  ) {
    return false;
  }
  if (
    !value.objectives.every((objective) => {
      if (
        !isRecord(objective) ||
        !isWireId(objective.id) ||
        !isBoundedString(objective.label, QUEST_OBJECTIVE_LABEL_MAX, true) ||
        !isNonNegativeInteger(objective.progress) ||
        !isNonNegativeInteger(objective.target) ||
        objective.target <= 0 ||
        objective.progress > objective.target
      ) {
        return false;
      }
      const rule = parseAuthoredQuestObjective(objective.rule);
      return rule !== null && rule.id === objective.id && rule.target === objective.target;
    })
  ) {
    return false;
  }
  return (
    isNonNegativeInteger(value.rewards.experience) &&
    value.rewards.experience <= QUEST_REWARD_AMOUNT_MAX &&
    isNonNegativeInteger(value.rewards.gold) &&
    value.rewards.gold <= QUEST_REWARD_AMOUNT_MAX &&
    Array.isArray(value.rewards.items) &&
    value.rewards.items.length <= MAX_QUEST_REWARD_ITEMS &&
    value.rewards.items.every(isQuestRewardItem) &&
    Array.isArray(value.rewards.choices) &&
    value.rewards.choices.length <= MAX_QUEST_REWARD_CHOICES &&
    value.rewards.choices.every(isQuestRewardChoice)
  );
}

function isSelfState(value: unknown): value is SelfState {
  if (
    !isRecord(value) ||
    !isNonNegativeInteger(value.xp) ||
    !isNonNegativeInteger(value.xpToNext) ||
    !isInventory(value.inventory) ||
    !isQuestState(value.quest) ||
    !isLifeState(value.life) ||
    !(value.corpse === null || (isRecord(value.corpse) && isWorldPosition(value.corpse))) ||
    // Required, and parsed as strictly as a reported position: this is the field a client answers by
    // TELEPORTING, and the number it must echo back to keep being allowed to move at all. A missing
    // or malformed stamp read as zero would pin the client's echo below the room's counter forever.
    !isRecord(value.displacement) ||
    !isNonNegativeInteger(value.displacement.seq) ||
    !isWorldPosition(value.displacement) ||
    (value.displacement.impulse !== undefined &&
      (!isRecord(value.displacement.impulse) ||
        !isWorldPosition(value.displacement.impulse) ||
        Math.abs(value.displacement.impulse.x as number) > 16 ||
        Math.abs(value.displacement.impulse.y as number) > 16 ||
        Math.abs(value.displacement.impulse.z as number) > 16))
  ) {
    return false;
  }
  if (value.life === "alive" ? value.corpse !== null : value.corpse === null) return false;
  if (
    value.authoredQuests !== undefined &&
    (!Array.isArray(value.authoredQuests) ||
      value.authoredQuests.length > MAX_AUTHORED_QUESTS ||
      !value.authoredQuests.every(isAuthoredQuestTracker))
  ) {
    return false;
  }
  if (
    value.authoredQuestMarkers !== undefined &&
    (!Array.isArray(value.authoredQuestMarkers) ||
      value.authoredQuestMarkers.length > MAX_AUTHORED_QUESTS * 2 ||
      !value.authoredQuestMarkers.every(
        (marker) =>
          isRecord(marker) &&
          isWireId(marker.eventId) &&
          (marker.kind === "available" || marker.kind === "active" || marker.kind === "ready"),
      ))
  ) {
    return false;
  }
  if (value.materials !== undefined && !isPartyMaterials(value.materials)) return false;
  if (
    value.resource !== undefined &&
    (!isRecord(value.resource) ||
      (value.resource.kind !== "endurance" &&
        value.resource.kind !== "energy" &&
        value.resource.kind !== "mana") ||
      !isFiniteNumber(value.resource.current) ||
      value.resource.current < 0 ||
      !isFiniteNumber(value.resource.max) ||
      value.resource.max <= 0 ||
      value.resource.current > value.resource.max)
  ) {
    return false;
  }
  if (value.serverNow !== undefined && !isFiniteNumber(value.serverNow)) return false;
  if (value.consumableCooldownUntil !== undefined && !isFiniteNumber(value.consumableCooldownUntil))
    return false;
  if (value.cooldowns !== undefined) {
    const cooldowns = value.cooldowns;
    if (
      !isRecord(cooldowns) ||
      !isFiniteNumber(cooldowns.attackUntil) ||
      !isFiniteNumber(cooldowns.healUntil) ||
      !Array.isArray(cooldowns.skillCooldowns) ||
      cooldowns.skillCooldowns.length !== 5 ||
      !cooldowns.skillCooldowns.every(isFiniteNumber) ||
      !isFiniteNumber(cooldowns.guardUntil) ||
      !isFiniteNumber(cooldowns.resurrectUntil)
    ) {
      return false;
    }
  }
  if (value.talents !== undefined) {
    const talents = value.talents;
    if (
      !isRecord(talents) ||
      !Array.isArray(talents.selected) ||
      talents.selected.length > 64 ||
      !talents.selected.every(isTalentId) ||
      !isNonNegativeInteger(talents.pointsSpent) ||
      !isNonNegativeInteger(talents.pointsAvailable)
    ) {
      return false;
    }
  }
  if (value.effects !== undefined) {
    const effects = value.effects;
    if (
      !isRecord(effects) ||
      !isFiniteNumber(effects.damageUntil) ||
      !isFiniteNumber(effects.forgottenUntil) ||
      !isFiniteNumber(effects.invisibleUntil) ||
      !isFiniteNumber(effects.resurrectionAt)
    ) {
      return false;
    }
  }
  if (
    value.movementEffects !== undefined &&
    (!Array.isArray(value.movementEffects) ||
      value.movementEffects.length > MOVEMENT_EFFECT_KINDS.length ||
      !value.movementEffects.every(
        (effect) =>
          isRecord(effect) &&
          isMovementEffectKind(effect.kind) &&
          isFiniteNumber(effect.until) &&
          effect.until >= 0 &&
          isFiniteNumber(effect.power) &&
          validMovementEffectPower(effect.kind, effect.power),
      ))
  ) {
    return false;
  }
  if (value.rogue !== undefined) {
    const rogue = value.rogue;
    if (
      !isRecord(rogue) ||
      !isFiniteNumber(rogue.openingUntil) ||
      !isFiniteNumber(rogue.stealthUntil) ||
      !isFiniteNumber(rogue.smokeProtectionUntil) ||
      !isFiniteNumber(rogue.shadowReturnUntil) ||
      (rogue.danceMarksAvailableAt !== undefined && !isFiniteNumber(rogue.danceMarksAvailableAt)) ||
      (rogue.danceMarksUntil !== undefined && !isFiniteNumber(rogue.danceMarksUntil))
    ) {
      return false;
    }
  }
  if (
    value.ranger !== undefined &&
    (!isRecord(value.ranger) || !isFiniteNumber(value.ranger.afterimageUntil))
  )
    return false;
  if (value.mobility !== undefined) {
    const mobility = value.mobility;
    // A grant is the one field here a client acts on by MOVING, so a malformed one is refused with
    // the same rigor as a reported position: a real action id, a positive bounded distance, and a
    // finite deadline. Zero or less is not a grant, it is a spent one, and the server omits it.
    if (
      !isRecord(mobility) ||
      !isWireId(mobility.actionId) ||
      !isFiniteNumber(mobility.distance) ||
      mobility.distance <= 0 ||
      mobility.distance > MAX_MOBILITY_DISTANCE ||
      !isFiniteNumber(mobility.until)
    ) {
      return false;
    }
  }
  return true;
}

function isPartyState(value: unknown): value is PartyState {
  return (
    isRecord(value) &&
    isWireId(value.id) &&
    (value.leaderId === "" || isWireId(value.leaderId)) &&
    Array.isArray(value.members) &&
    value.members.length <= 4 &&
    value.members.every(
      (member) =>
        isRecord(member) &&
        isWireId(member.id) &&
        isBoundedString(member.nick, 32) &&
        isFiniteNumber(member.hp) &&
        member.hp >= 0 &&
        isFiniteNumber(member.maxHp) &&
        member.maxHp > 0 &&
        member.hp <= member.maxHp &&
        isLifeState(member.life),
    )
  );
}

function isNpc(value: unknown): value is NpcDefinition {
  return (
    isRecord(value) && isWireId(value.id) && isFiniteNumber(value.x) && isFiniteNumber(value.y)
  );
}

function isQuestSite(value: unknown): value is QuestSite {
  return (
    isRecord(value) &&
    isWireId(value.id) &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    typeof value.chapter === "string" &&
    (QUEST_CHAPTERS as readonly string[]).includes(value.chapter) &&
    (value.kind === "resource" || value.kind === "rune" || value.kind === "ward") &&
    isNonNegativeInteger(value.order) &&
    (value.art === "wood" ||
      value.art === "gold" ||
      value.art === "meat" ||
      value.art === "rune" ||
      value.art === "ward")
  );
}

const WORLD_EVENT_COLLIDER_OFFSET_LIMIT =
  HARVEST_PROFILE_LIMITS.collisionOffset.max * MAX_ELEMENT_SCALE;
const WORLD_EVENT_COLLIDER_COORDINATE_LIMIT =
  MAX_HEIGHTFIELD_SIZE * TILE_SIZE + WORLD_EVENT_COLLIDER_OFFSET_LIMIT;
const WORLD_EVENT_COLLIDER_SIZE_LIMIT =
  HARVEST_PROFILE_LIMITS.collisionSize.max * MAX_ELEMENT_SCALE;

/**
 * Runtime event colliders inherit the authored scenery scale. Their stored profile is integral,
 * but a legal scale such as 2.1 makes every projected edge fractional; the wire therefore bounds
 * finite pixel values instead of incorrectly requiring integers. A footprint may overhang the map,
 * matching the authoring contract, but can never exceed the largest map plus the largest scaled
 * authored offset.
 */
function isHarvestWorldCollider(value: unknown): boolean {
  if (value === null) return true;
  if (!Array.isArray(value) || (value.length !== 4 && value.length !== 5)) return false;
  const [x, y, width, height, elevation] = value;
  return (
    isFiniteNumber(x) &&
    isFiniteNumber(y) &&
    Math.abs(x) <= WORLD_EVENT_COLLIDER_COORDINATE_LIMIT &&
    Math.abs(y) <= WORLD_EVENT_COLLIDER_COORDINATE_LIMIT &&
    isFiniteNumber(width) &&
    isFiniteNumber(height) &&
    width > 0 &&
    height > 0 &&
    width <= WORLD_EVENT_COLLIDER_SIZE_LIMIT &&
    height <= WORLD_EVENT_COLLIDER_SIZE_LIMIT &&
    (elevation === undefined || elevation === 1 || elevation === 2 || elevation === 3)
  );
}

function isWorldInfo(value: unknown): value is WorldInfo {
  if (!isRecord(value) || !isZoneId(value.zoneId) || !isNonNegativeInteger(value.revision)) {
    return false;
  }
  // The heightfield is now the room's ONLY geometry, so it is also the only thing the appearance
  // collections can be sized against: an element or an event outside the grid the client is about
  // to draw is a payload from a sender that does not agree with its own terrain, and the frame is
  // dropped rather than half-rendered.
  if (typeof value.heightfield !== "string") return false;
  const heightfield = decodeMap(value.heightfield);
  if (heightfield === null) return false;
  const size = heightfield.size;
  if (value.size !== size) return false;
  if (parseMapElements(value.elements, size, size) === null) return false;
  return (
    isBoundedString(value.zoneNameKey, 128) &&
    typeof value.tilesetId === "string" &&
    tilesetById(value.tilesetId) !== null &&
    Array.isArray(value.layers) &&
    value.layers.length === MAP_LAYERS &&
    value.layers.every((layer) => parseTileLayer(layer, size, size) !== null) &&
    Array.isArray(value.events) &&
    value.events.every(
      (event) => isWorldEventSnapshot(event) && event.col < size && event.row < size,
    ) &&
    (value.buildings === undefined ||
      (Array.isArray(value.buildings) && value.buildings.every(isWorldBuildingSnapshot))) &&
    (value.audio === undefined || parseAdventureAudioConfig(value.audio) !== null) &&
    (value.cameraMode === undefined || isAdventureCameraMode(value.cameraMode)) &&
    (value.gameMode === undefined || isAdventureGameMode(value.gameMode)) &&
    (value.heroSettings === undefined || parseMapHeroSettings(value.heroSettings) !== null) &&
    (value.ambience === undefined || parseAmbienceState(value.ambience) !== null) &&
    (value.dayNightCycle === undefined || typeof value.dayNightCycle === "boolean") &&
    (value.fixedLighting === undefined || parseMapFixedLighting(value.fixedLighting) !== null) &&
    isNpc(value.questNpc) &&
    Array.isArray(value.questNpcs) &&
    value.questNpcs.every(isNpc) &&
    Array.isArray(value.questSites) &&
    value.questSites.every(isQuestSite) &&
    Array.isArray(value.cemeteries) &&
    value.cemeteries.every(isNpc) &&
    Array.isArray(value.portals) &&
    value.portals.every(
      (portal) =>
        isRecord(portal) &&
        isWireId(portal.id) &&
        isBoundedString(portal.nameKey, 128) &&
        isFiniteNumber(portal.x) &&
        isFiniteNumber(portal.y),
    ) &&
    (value.merchant === null ||
      (isRecord(value.merchant) &&
        value.merchant.id === "heartroot_merchant" &&
        isFiniteNumber(value.merchant.x) &&
        isFiniteNumber(value.merchant.y)))
  );
}

function isWorldBuildingSnapshot(value: unknown): value is WorldBuildingSnapshot {
  const collider = isRecord(value) && isRecord(value.collider) ? value.collider : null;
  return (
    isRecord(value) &&
    isWireId(value.id) &&
    isMoveCoordinate(value.x) &&
    isMoveCoordinate(value.z) &&
    isEditorAssetId(value.graphicAssetId) &&
    isEditorAssetId(value.destroyedAssetId) &&
    (value.orientation === undefined ||
      (Number.isSafeInteger(value.orientation) &&
        (value.orientation as number) >= 0 &&
        (value.orientation as number) <= 3)) &&
    (value.rotation === undefined ||
      (Number.isSafeInteger(value.rotation) &&
        (value.rotation as number) >= 0 &&
        (value.rotation as number) <= 359)) &&
    (value.dimensions === undefined || parseBuildingDimensions(value.dimensions) !== null) &&
    Number.isSafeInteger(value.hp) &&
    (value.hp as number) >= 0 &&
    Number.isSafeInteger(value.maxHp) &&
    (value.maxHp as number) > 0 &&
    (value.hp as number) <= (value.maxHp as number) &&
    typeof value.destructible === "boolean" &&
    typeof value.destroyed === "boolean" &&
    typeof value.interactive === "boolean" &&
    collider !== null &&
    isMoveCoordinate(collider.x) &&
    isMoveCoordinate(collider.z) &&
    isFiniteNumber(collider.w) &&
    collider.w > 0 &&
    isFiniteNumber(collider.h) &&
    collider.h > 0 &&
    hasOnlyKeys(collider, ["x", "z", "w", "h"]) &&
    (value.destroyed ? value.hp === 0 : (value.hp as number) > 0) &&
    (!value.interactive || !value.destroyed) &&
    hasOnlyKeys(value, [
      "id",
      "x",
      "z",
      "graphicAssetId",
      "destroyedAssetId",
      "orientation",
      "rotation",
      "dimensions",
      "hp",
      "maxHp",
      "destructible",
      "destroyed",
      "interactive",
      "collider",
    ])
  );
}

/** Same table-driven discipline as the snapshots above: every field is checked, and a malformed
 *  one drops the whole frame. `graphicAssetId` must be `null` or a real catalogue id — appearance
 *  only, so an unknown asset id is not something the renderer should ever be handed. */
function isWorldEventSnapshot(value: unknown): value is WorldEventSnapshot {
  const harvest = isRecord(value) ? value.harvest : undefined;
  return (
    isRecord(value) &&
    isWireId(value.id) &&
    Number.isSafeInteger(value.col) &&
    (value.col as number) >= 0 &&
    Number.isSafeInteger(value.row) &&
    (value.row as number) >= 0 &&
    (value.y === undefined || isFiniteNumber(value.y)) &&
    (value.undergroundDepth === undefined || validVerticalDepth(value.undergroundDepth)) &&
    (value.graphicAssetId === null || isEditorAssetId(value.graphicAssetId)) &&
    (value.scale === undefined || parseElementScale(value.scale) !== null) &&
    (value.graphicTint === undefined ||
      (Number.isSafeInteger(value.graphicTint) &&
        (value.graphicTint as number) >= 0 &&
        (value.graphicTint as number) <= 0xffffff)) &&
    typeof value.onTop === "boolean" &&
    Number.isSafeInteger(value.moveSpeed) &&
    (value.moveSpeed as number) >= 0 &&
    (value.moveSpeed as number) <= 5 &&
    Number.isSafeInteger(value.moveFrequency) &&
    (value.moveFrequency as number) >= 0 &&
    (value.moveFrequency as number) <= 4 &&
    typeof value.moveAnimation === "boolean" &&
    typeof value.directionFixed === "boolean" &&
    (value.interactive === undefined || value.interactive === true) &&
    (value.presentation === undefined ||
      value.presentation === "marker" ||
      value.presentation === "native") &&
    (value.showMarker === undefined || typeof value.showMarker === "boolean") &&
    (value.elevationOffset === undefined ||
      (isFiniteNumber(value.elevationOffset) &&
        value.elevationOffset >= 0 &&
        value.elevationOffset <= 16)) &&
    (value.floating === undefined || value.floating === true) &&
    (value.collider === undefined ||
      (value.collider !== null && isHarvestWorldCollider(value.collider))) &&
    (harvest === undefined ||
      (isRecord(harvest) &&
        (harvest.state === "intact" || harvest.state === "depleted") &&
        Number.isSafeInteger(harvest.generation) &&
        (harvest.generation as number) >= 0 &&
        Number.isSafeInteger(harvest.hits) &&
        (harvest.hits as number) >= 0 &&
        (harvest.hits as number) <= MAX_HARVEST_HITS &&
        Number.isSafeInteger(harvest.hitsRequired) &&
        (harvest.hitsRequired as number) >= 1 &&
        (harvest.hitsRequired as number) <= MAX_HARVEST_HITS &&
        (harvest.hits as number) <= (harvest.hitsRequired as number) &&
        (harvest.state !== "intact" ||
          (harvest.hits as number) < (harvest.hitsRequired as number)) &&
        (harvest.state !== "depleted" ||
          (harvest.hits as number) === (harvest.hitsRequired as number)) &&
        (harvest.lastHitAt === null ||
          (Number.isSafeInteger(harvest.lastHitAt) && (harvest.lastHitAt as number) >= 0)) &&
        (harvest.depletedAt === null ||
          (Number.isSafeInteger(harvest.depletedAt) && (harvest.depletedAt as number) >= 0)) &&
        (harvest.state !== "intact" || harvest.depletedAt === null) &&
        (harvest.depletedAt === null || harvest.lastHitAt === harvest.depletedAt) &&
        (harvest.respawnAt === null ||
          (Number.isSafeInteger(harvest.respawnAt) && (harvest.respawnAt as number) >= 0)) &&
        (harvest.exhaustionBehavior === "replace" ||
          harvest.exhaustionBehavior === "fade" ||
          harvest.exhaustionBehavior === "hide") &&
        (harvest.exhaustionBehavior === "replace"
          ? isEditorAssetId(harvest.exhaustedAssetId)
          : harvest.exhaustionBehavior === "hide"
            ? harvest.exhaustedAssetId === null
            : harvest.exhaustedAssetId === null || isEditorAssetId(harvest.exhaustedAssetId)) &&
        Number.isSafeInteger(harvest.fadeDurationMs) &&
        (harvest.fadeDurationMs as number) >= 0 &&
        (harvest.fadeDurationMs as number) <= HARVEST_PROFILE_LIMITS.fadeDurationMs.max &&
        (harvest.collisionPending === undefined || harvest.collisionPending === true) &&
        isHarvestWorldCollider(harvest.collider) &&
        (harvest.state !== "intact" ||
          harvest.collider !== null ||
          harvest.collisionPending === true) &&
        (harvest.collisionPending !== true ||
          (harvest.state === "intact" && harvest.collider === null)) &&
        (harvest.state !== "depleted" ||
          harvest.exhaustionBehavior === "replace" ||
          harvest.collider === null)))
  );
}

function isEntityDelta<T extends { id: string }>(
  value: unknown,
  validate: (entity: unknown) => entity is T,
): boolean {
  if (!isRecord(value) || !Array.isArray(value.upsert) || !Array.isArray(value.remove))
    return false;
  return value.upsert.every(validate) && value.remove.every((id) => isWireId(id));
}

/** A single reported coordinate: finite, and inside the largest world any map could describe. */
function isMoveCoordinate(value: unknown): value is number {
  return isFiniteNumber(value) && Math.abs(value) <= MOVE_COORDINATE_LIMIT;
}

/**
 * The client's report of its own hero's position. Authority moved; the parser did not relax.
 *
 * Every field is REQUIRED, including the three locomotion booleans. An absent key is malformed, not
 * a default — the rule `WorldInfo.heightfield` already follows, and the reason the map-events wire
 * makes a client emit an explicit `null` rather than omit a condition. Defaulting `swimming` to
 * `false` because the key was missing would draw a drowning hero walking on water, with nothing
 * anywhere saying the frame was wrong.
 */
function parseMove(value: Record<string, unknown>): MoveMessage | null {
  if (
    !hasOnlyKeys(value, [
      "t",
      "x",
      "y",
      "z",
      "vy",
      "facing",
      "airborne",
      "swimming",
      "gliding",
      "displacement",
    ]) ||
    !isMoveCoordinate(value.x) ||
    !isMoveCoordinate(value.y) ||
    !isMoveCoordinate(value.z) ||
    !isMoveCoordinate(value.vy) ||
    !isDirection(value.facing) ||
    typeof value.airborne !== "boolean" ||
    typeof value.swimming !== "boolean" ||
    typeof value.gliding !== "boolean" ||
    // The echoed stamp is under the same absent-key rule as the flags above: a frame that omits it
    // is malformed, never a frame that means "zero". Defaulting it would make every client that
    // forgot the field permanently exempt from the staleness check it exists to feed.
    !isNonNegativeInteger(value.displacement)
  ) {
    return null;
  }
  return {
    t: "move",
    x: value.x,
    y: value.y,
    z: value.z,
    vy: value.vy,
    facing: { x: value.facing.x, z: value.facing.z },
    airborne: value.airborne,
    swimming: value.swimming,
    gliding: value.gliding,
    displacement: value.displacement,
  };
}

/** Returns `null` for anything that is not a well-formed client message. */
export function parseClientMessage(raw: string | ArrayBuffer): ClientMessage | null {
  if (typeof raw !== "string") return null;

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isRecord(value) || typeof value.t !== "string") return null;
  if (value.t === "move") return parseMove(value);
  if (value.t === "attack" && hasOnlyKeys(value, ["t"])) return { t: "attack" };
  if (value.t === "sheep.hit" && isWireId(value.eventId) && hasOnlyKeys(value, ["t", "eventId"])) {
    return { t: "sheep.hit", eventId: value.eventId };
  }
  if (
    (value.t === "interact" || value.t === "release" || value.t === "drowned") &&
    hasOnlyKeys(value, ["t"])
  )
    return { t: value.t };
  if (
    value.t === "peasant.camp_gold" &&
    isWireId(value.id) &&
    (value.operation === "deposit" || value.operation === "withdraw") &&
    typeof value.amount === "number" &&
    Number.isSafeInteger(value.amount) &&
    value.amount >= 1 &&
    value.amount <= 1_000_000 &&
    hasOnlyKeys(value, ["t", "id", "operation", "amount"])
  ) {
    return {
      t: "peasant.camp_gold",
      id: value.id,
      operation: value.operation,
      amount: value.amount,
    };
  }
  if (
    value.t === "skill" &&
    isSkillSlot(value.slot) &&
    (value.direction === undefined || isDirection(value.direction)) &&
    hasOnlyKeys(value, ["t", "slot", "direction"])
  ) {
    return {
      t: "skill",
      slot: value.slot,
      ...(value.direction === undefined ? {} : { direction: value.direction }),
    };
  }
  if (value.t === "skill.release" && isSkillSlot(value.slot) && hasOnlyKeys(value, ["t", "slot"])) {
    return { t: "skill.release", slot: value.slot };
  }
  if (
    value.t === "talent.unlock" &&
    isTalentId(value.nodeId) &&
    hasOnlyKeys(value, ["t", "nodeId"])
  ) {
    return { t: "talent.unlock", nodeId: value.nodeId };
  }
  if (value.t === "talent.reset" && hasOnlyKeys(value, ["t"])) return { t: "talent.reset" };
  if (value.t === "use" && value.item === "potion" && hasOnlyKeys(value, ["t", "item"]))
    return { t: "use", item: "potion" };
  if (
    (value.t === "item.use" || value.t === "merchant.buy") &&
    isConsumableId(value.item) &&
    hasOnlyKeys(value, ["t", "item"])
  ) {
    return { t: value.t, item: value.item };
  }
  if (value.t === "world.resync" && hasOnlyKeys(value, ["t"])) return { t: "world.resync" };
  if (
    value.t === "navigation.debug" &&
    typeof value.enabled === "boolean" &&
    hasOnlyKeys(value, ["t", "enabled"])
  )
    return { t: "navigation.debug", enabled: value.enabled };
  if (value.t === "event.advance" && isWireId(value.runId) && hasOnlyKeys(value, ["t", "runId"]))
    return { t: "event.advance", runId: value.runId };
  if (
    value.t === "event.choose" &&
    isWireId(value.runId) &&
    // A wire-level sanity bound only; the server re-validates the index against the live pending
    // offer (`resumeWithChoice` range-checks it) so a well-formed-but-wrong index is still dropped.
    typeof value.index === "number" &&
    Number.isSafeInteger(value.index) &&
    value.index >= 0 &&
    value.index < MAX_CHOICE_OPTIONS &&
    hasOnlyKeys(value, ["t", "runId", "index"])
  ) {
    return { t: "event.choose", runId: value.runId, index: value.index };
  }
  if (
    value.t === "quest.action" &&
    isWireId(value.conversationId) &&
    (value.action === "accept" ||
      value.action === "refuse" ||
      value.action === "turn-in" ||
      value.action === "close") &&
    (value.questId === undefined || isWireId(value.questId)) &&
    (value.rewardChoiceId === undefined || isWireId(value.rewardChoiceId)) &&
    hasOnlyKeys(value, ["t", "conversationId", "questId", "action", "rewardChoiceId"])
  ) {
    if (value.action === "close") {
      return value.questId === undefined && value.rewardChoiceId === undefined
        ? { t: "quest.action", conversationId: value.conversationId, action: "close" }
        : null;
    }
    if (value.questId === undefined) return null;
    return {
      t: "quest.action",
      conversationId: value.conversationId,
      questId: value.questId,
      action: value.action,
      ...(value.rewardChoiceId === undefined ? {} : { rewardChoiceId: value.rewardChoiceId }),
    };
  }
  if (
    value.t === "quest.abandon" &&
    isWireId(value.questId) &&
    hasOnlyKeys(value, ["t", "questId"])
  ) {
    return { t: "quest.abandon", questId: value.questId };
  }
  if (
    (value.t === "party.create" || value.t === "party.leave" || value.t === "party.dissolve") &&
    hasOnlyKeys(value, ["t"])
  )
    return { t: value.t };
  if (
    (value.t === "party.invite" || value.t === "party.kick") &&
    isUuid(value.playerId) &&
    hasOnlyKeys(value, ["t", "playerId"])
  )
    return { t: value.t, playerId: value.playerId };
  if (
    (value.t === "party.accept" || value.t === "party.refuse") &&
    isUuid(value.inviteId) &&
    hasOnlyKeys(value, ["t", "inviteId"])
  )
    return { t: value.t, inviteId: value.inviteId };
  if (
    value.t === "chat" &&
    typeof value.text === "string" &&
    value.text.length <= 160 &&
    (value.channel === undefined || value.channel === "local" || value.channel === "party") &&
    hasOnlyKeys(value, ["t", "channel", "text"])
  ) {
    return { t: "chat", channel: value.channel === "party" ? "party" : "local", text: value.text };
  }
  return null;
}

export function encodeServerMessage(message: ServerMessage): string {
  return JSON.stringify(message);
}

export function parseServerMessage(raw: string): ServerMessage | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || typeof value.t !== "string") return null;
    if (
      value.t === "welcome" &&
      isNonNegativeInteger(value.tick) &&
      isWireId(value.selfId) &&
      isRecord(value.world) &&
      isWorldInfo(value.world) &&
      // A cached SPA build can be older than the server it talks to. If a future zone ever
      // reaches this client, drop the frame — like any other malformed message — rather than
      // hand an unrecognised zoneId to zoneDefinition() a frame later.
      isZoneId(value.world.zoneId) &&
      typeof value.world.revision === "number" &&
      Number.isSafeInteger(value.world.revision) &&
      value.world.revision >= 0 &&
      // The terrain arrives as data now, so it gets checked like data. `decodeTileMap` throws on a
      // ragged row or an unknown character — fine for a map read off disk at build time, fatal for
      // one arriving on a socket. Drop the frame instead of crashing the first paint. `isWorldInfo`
      // above already parses `tiles` and bounds-checks `elements` against it (it needs the same
      // cols/rows to do that), so there is nothing left to re-check here.
      // `layers` is appearance only — the same rule `elements` already follows — so validation only
      // needs to confirm the shape is well-formed, never re-derive collision from it.
      typeof value.world.tilesetId === "string" &&
      tilesetById(value.world.tilesetId) !== null &&
      Array.isArray(value.world.layers) &&
      value.world.layers.length === MAP_LAYERS &&
      value.world.layers.every((layer: unknown) => typeof layer === "string") &&
      // Events ride inside `world` (the `elements`/`layers` family), validated the same way:
      // appearance only, every field checked, a bad graphic id drops the frame.
      Array.isArray(value.world.events) &&
      value.world.events.every(isWorldEventSnapshot) &&
      Array.isArray(value.players) &&
      value.players.every(isPlayerSnapshot) &&
      value.players.some((player) => player.id === value.selfId) &&
      Array.isArray(value.seaGuardians) &&
      value.seaGuardians.every(isSeaGuardianSnapshot) &&
      Array.isArray(value.monsters) &&
      value.monsters.every(isMonsterSnapshot) &&
      Array.isArray(value.guards) &&
      value.guards.every(isGuardSnapshot) &&
      Array.isArray(value.loot) &&
      value.loot.every(isLootSnapshot) &&
      Array.isArray(value.corpses) &&
      value.corpses.every(isCorpseSnapshot) &&
      Array.isArray(value.projectiles) &&
      value.projectiles.every(isProjectileSnapshot) &&
      isSelfState(value.self)
    ) {
      return value as unknown as ServerMessage;
    }
    if (
      value.t === "world.delta" &&
      isNonNegativeInteger(value.tick) &&
      isEntityDelta(value.players, isPlayerSnapshot) &&
      isEntityDelta(value.seaGuardians, isSeaGuardianSnapshot) &&
      isEntityDelta(value.monsters, isMonsterSnapshot) &&
      isEntityDelta(value.guards, isGuardSnapshot) &&
      isEntityDelta(value.loot, isLootSnapshot) &&
      isEntityDelta(value.corpses, isCorpseSnapshot) &&
      isEntityDelta(value.projectiles, isProjectileSnapshot) &&
      isEntityDelta(value.events, isWorldEventSnapshot)
    ) {
      return value as unknown as ServerMessage;
    }
    if (
      value.t === "world.resync" &&
      isNonNegativeInteger(value.tick) &&
      Array.isArray(value.players) &&
      value.players.every(isPlayerSnapshot) &&
      Array.isArray(value.seaGuardians) &&
      value.seaGuardians.every(isSeaGuardianSnapshot) &&
      Array.isArray(value.monsters) &&
      value.monsters.every(isMonsterSnapshot) &&
      Array.isArray(value.guards) &&
      value.guards.every(isGuardSnapshot) &&
      Array.isArray(value.loot) &&
      value.loot.every(isLootSnapshot) &&
      Array.isArray(value.corpses) &&
      value.corpses.every(isCorpseSnapshot) &&
      Array.isArray(value.projectiles) &&
      value.projectiles.every(isProjectileSnapshot) &&
      Array.isArray(value.events) &&
      value.events.every(isWorldEventSnapshot)
    ) {
      return value as unknown as ServerMessage;
    }
    if (value.t === "world.resync_required" && hasOnlyKeys(value, ["t"]))
      return { t: "world.resync_required" };
    if (value.t === "state" && isSelfState(value.self)) return value as unknown as ServerMessage;
    if (
      value.t === "chat" &&
      (value.channel === "local" || value.channel === "party") &&
      isBoundedString(value.from, 32) &&
      isBoundedString(value.text, 500)
    ) {
      return value as unknown as ServerMessage;
    }
    if (
      value.t === "party.invite" &&
      isUuid(value.inviteId) &&
      isUuid(value.fromId) &&
      isBoundedString(value.from, 32) &&
      isFiniteNumber(value.expiresAt)
    )
      return value as unknown as ServerMessage;
    if (value.t === "party.state" && (value.party === null || isPartyState(value.party)))
      return value as unknown as ServerMessage;
    if (value.t === "merchant.open" && hasOnlyKeys(value, ["t"])) return { t: "merchant.open" };
    if (
      value.t === "building.state" &&
      isWorldBuildingSnapshot(value.building) &&
      hasOnlyKeys(value, ["t", "building"])
    ) {
      return value as unknown as ServerMessage;
    }
    if (
      value.t === "sea_guardian.devour" &&
      isWireId(value.guardianId) &&
      isWireId(value.victimId) &&
      isFiniteNumber(value.x) &&
      isFiniteNumber(value.z) &&
      isFiniteNumber(value.at) &&
      hasOnlyKeys(value, ["t", "guardianId", "victimId", "x", "z", "at"])
    ) {
      return value as unknown as ServerMessage;
    }
    if (
      value.t === "animation" &&
      (value.actorKind === "player" || value.actorKind === "monster") &&
      isWireId(value.actionId) &&
      isWireId(value.actorId) &&
      (value.action === "attack" || value.action === "skill") &&
      isDirection(value.direction) &&
      isFiniteNumber(value.startedAt) &&
      isFiniteNumber(value.impactAt) &&
      isFiniteNumber(value.recoveryEndsAt) &&
      value.startedAt <= value.impactAt &&
      value.impactAt <= value.recoveryEndsAt &&
      (value.impactTimes === undefined ||
        isCombatImpactTimes(value.impactTimes, value.impactAt, value.recoveryEndsAt)) &&
      (value.talented === undefined || value.talented === true) &&
      (value.evolved === undefined || value.evolved === true) &&
      (value.peasantTool === undefined ||
        (value.actorKind === "player" &&
          value.action === "attack" &&
          value.skillId === "woodcutters_swing" &&
          isHarvestTool(value.peasantTool))) &&
      (value.peasantResource === undefined ||
        (value.peasantTool !== undefined && isHarvestResourceKind(value.peasantResource))) &&
      ((value.actorKind === "monster" &&
        ((value.action === "attack" && value.skillId === undefined) ||
          (value.action === "skill" &&
            isMonsterSpecialTechnique(value.skillId) &&
            value.skillId !== "none"))) ||
        (value.actorKind === "player" &&
          typeof value.skillId === "string" &&
          value.skillId.length >= 1 &&
          value.skillId.length <= 64))
    ) {
      return value as unknown as ServerMessage;
    }
    if (
      value.t === "monster.special_impact" &&
      hasOnlyKeys(value, [
        "t",
        "actionId",
        "actorId",
        "technique",
        "x",
        "z",
        "direction",
        "impactAt",
      ]) &&
      isWireId(value.actionId) &&
      isWireId(value.actorId) &&
      isMonsterSpecialTechnique(value.technique) &&
      value.technique !== "none" &&
      isFiniteNumber(value.x) &&
      isFiniteNumber(value.z) &&
      isDirection(value.direction) &&
      isFiniteNumber(value.impactAt)
    ) {
      return value as unknown as ServerMessage;
    }
    if (isRogueShadowDanceSequence(value)) return value;
    if (
      isPriestLumenPortalVisual(value) ||
      isPriestLumenTrailVisual(value) ||
      isPriestPolarityOrbVisual(value)
    )
      return value;
    if (
      isPeasantCampVisual(value) ||
      isPeasantCampRemovedVisual(value) ||
      isPeasantRationVisual(value) ||
      isPeasantRationRemovedVisual(value) ||
      isPeasantCampBankVisual(value) ||
      isPeasantBombImpactVisual(value)
    )
      return value;
    if (
      value.t === "event" &&
      typeof value.code === "string" &&
      (EVENT_CODES as readonly string[]).includes(value.code) &&
      (value.params === undefined ||
        (isRecord(value.params) &&
          Object.keys(value.params).length <= 32 &&
          Object.entries(value.params).every(
            ([key, parameter]) =>
              key.length <= 64 &&
              ((typeof parameter === "string" && parameter.length <= 256) ||
                isFiniteNumber(parameter)),
          ))) &&
      (value.tone === "info" || value.tone === "good" || value.tone === "bad") &&
      (value.x === undefined || isFiniteNumber(value.x)) &&
      (value.z === undefined || isFiniteNumber(value.z))
    ) {
      return value as unknown as ServerMessage;
    }
    // The dialogue beats. Authored prose (`text`/`name`/`prompt`/`options`) is bounded and parsed as
    // the sanctioned data exception (see `isAuthoredText`); `runId` is a wire id; `name` is optional.
    if (
      value.t === "event.say" &&
      isWireId(value.runId) &&
      isAuthoredText(value.text) &&
      (value.name === undefined || isAuthoredText(value.name))
    ) {
      return value as unknown as ServerMessage;
    }
    if (
      value.t === "event.choices" &&
      isWireId(value.runId) &&
      isAuthoredText(value.prompt) &&
      Array.isArray(value.options) &&
      value.options.length >= 1 &&
      value.options.length <= MAX_CHOICE_OPTIONS &&
      value.options.every(isAuthoredText)
    ) {
      return value as unknown as ServerMessage;
    }
    if (value.t === "event.close" && isWireId(value.runId)) {
      return value as unknown as ServerMessage;
    }
    // The id is checked against the catalogue, not merely typed: a frame naming a cue this build
    // does not ship is a frame the client could not play anyway.
    if (value.t === "event.sound" && isWireId(value.runId) && isSoundEffectId(value.soundId)) {
      return value as unknown as ServerMessage;
    }
    if (value.t === "ambience" && parseAmbienceState(value) !== null) {
      return value as unknown as ServerMessage;
    }
    if (
      value.t === "quest.open" &&
      isWireId(value.conversationId) &&
      Array.isArray(value.entries) &&
      value.entries.length >= 1 &&
      value.entries.length <= MAX_AUTHORED_QUESTS &&
      value.entries.every(
        (entry) =>
          isRecord(entry) &&
          isWireId(entry.questId) &&
          isBoundedString(entry.speakerName, QUEST_TITLE_MAX) &&
          isBoundedString(entry.title, QUEST_TITLE_MAX) &&
          isBoundedString(entry.text, QUEST_DIALOGUE_TEXT_MAX, true) &&
          (entry.category === "main" || entry.category === "side" || entry.category === "lore") &&
          isBoundedString(entry.region, QUEST_CONTEXT_TEXT_MAX, true) &&
          isBoundedString(entry.landmark, QUEST_CONTEXT_TEXT_MAX, true) &&
          isBoundedString(entry.giverName, QUEST_CONTEXT_TEXT_MAX, true) &&
          (entry.phase === "offer" ||
            entry.phase === "active" ||
            entry.phase === "ready" ||
            entry.phase === "completed" ||
            entry.phase === "unavailable") &&
          typeof entry.canAccept === "boolean" &&
          typeof entry.canTurnIn === "boolean" &&
          Array.isArray(entry.rewardChoices) &&
          entry.rewardChoices.length <= MAX_QUEST_REWARD_CHOICES &&
          entry.rewardChoices.every(
            (choice) =>
              isRecord(choice) &&
              isWireId(choice.id) &&
              isBoundedString(choice.label, QUEST_TITLE_MAX),
          ),
      )
    ) {
      return value as unknown as ServerMessage;
    }
    if (
      value.t === "quest.result" &&
      isWireId(value.conversationId) &&
      isWireId(value.questId) &&
      isBoundedString(value.speakerName, QUEST_TITLE_MAX) &&
      isBoundedString(value.title, QUEST_TITLE_MAX) &&
      isBoundedString(value.text, QUEST_DIALOGUE_TEXT_MAX, true) &&
      (value.outcome === "accepted" ||
        value.outcome === "refused" ||
        value.outcome === "completed" ||
        value.outcome === "failed")
    ) {
      return value as unknown as ServerMessage;
    }
    if (value.t === "quest.close" && isWireId(value.conversationId)) {
      return value as unknown as ServerMessage;
    }
    return null;
  } catch {
    return null;
  }
}
