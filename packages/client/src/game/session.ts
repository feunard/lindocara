import type { PrimaryColor } from "@lindocara/engine/character.js";
import { WS_CLOSE } from "@lindocara/engine/close-codes.js";
import type { ConsumableId } from "@lindocara/engine/consumables.js";
import { isSpirit } from "@lindocara/engine/death.js";
import {
  INTERACTION_RANGE,
  isMonsterSpecialTechnique,
  isMonsterSpecies,
} from "@lindocara/engine/game.js";
import { type GroundVector, groundDistance } from "@lindocara/engine/ground.js";
import { decodeMap } from "@lindocara/engine/hd2d/map-data.js";
import type { MessageKey } from "@lindocara/engine/i18n/index.js";
import {
  DEFAULT_MAP_FIXED_LIGHTING,
  type MapFixedLighting,
} from "@lindocara/engine/map-lighting.js";
import type { MerchantDefinition } from "@lindocara/engine/merchant.js";
import type {
  CombatAnimation,
  EventCode,
  EventParams,
  MonsterSpecialImpact,
  PeasantBombImpactVisual,
  PeasantCampBankVisual,
  PeasantCampRemovedVisual,
  PeasantCampVisual,
  PlayerSnapshot,
  PriestLumenPortalVisual,
  PriestLumenTrailVisual,
  PriestPolarityOrbVisual,
  QuestState,
  RogueShadowDanceSequence,
  SelfState,
} from "@lindocara/engine/protocol.js";
import { SEA_GUARDIAN_AMBIENCE_RADIUS } from "@lindocara/engine/sea-guardian.js";
import { NO_INPUT } from "@lindocara/engine/simulation.js";
import type { SkillSlot } from "@lindocara/engine/skills.js";
import {
  DEFAULT_ZONE_ID,
  isKnownZone,
  type ZoneId,
  zoneDefinition,
} from "@lindocara/engine/zones.js";
import { getDisplaySettings } from "@lindocara/renderer/display-settings.js";
import { healingEffectColor, shouldFloatEvent } from "@lindocara/renderer/feedback.js";
import {
  type DayCycleOverride,
  fixedLightingOverride,
  mapDayCycleAt,
} from "@lindocara/renderer/hd2d/day-cycle.js";
import { Hd2dRenderer } from "@lindocara/renderer/hd2d/game-renderer.js";
import {
  limitedCameraYaw,
  rotateMovementInput,
  trackActions,
  trackCameraOrbit,
  trackInput,
} from "@lindocara/renderer/input.js";
import { type InteriorDoor, nearestInterior } from "@lindocara/renderer/interiors.js";
import { MapSurface } from "@lindocara/renderer/minimap-surface.js";
import type { RenderContext, RendererLike } from "@lindocara/renderer/renderer-api.js";
import { ServerClock } from "@lindocara/renderer/server-clock.js";
import type { PartyListing, StoredHero } from "../api.js";
import { t } from "../i18n.js";
import { questTrackerNotifications } from "../quest-presentation.js";
import { getGameNavigation } from "../state/navigation.js";
import { type LocalizedText, useUiStore } from "../store.js";
import { ChestFeedbackTracker } from "./chest-feedback.js";
import {
  activeReactivationDeadline,
  clientCooldownDeadlines,
  clientShadowReturnDeadline,
  skillCooldownBlocksCast,
} from "./cooldown-sync.js";
import { type Connection, type ConnectionHandlers, WorldClient } from "./net.js";
import { type PartyTargetResolution, resolvePartyTarget } from "./party.js";
import { SessionCombatAudio } from "./session-combat-audio.js";
import { SheepFeedbackTracker } from "./sheep-feedback.js";
import { GameSound } from "./sound.js";

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`index.html is missing ${selector}`);
  return element;
}

/** Shared by every teardown entry point below: `navigate: false` still clears the store/atoms but
 *  skips the router push, for a caller that already knows the browser is somewhere else (see
 *  `returnFromGameSession`'s docblock). Defaults to `true` everywhere else. */
type StopOptions = { navigate?: boolean };

const sound = new GameSound();
const sheepFeedback = new SheepFeedbackTracker();
const chestFeedback = new ChestFeedbackTracker();
let activeLaunchId = 0;
let stopActiveSession: ((options?: StopOptions) => void) | null = null;

function stopCurrentSession(options?: StopOptions): void {
  stopActiveSession?.(options);
}

/**
 * Clears the game session on the store, then navigates away through the seam — the store itself no
 * longer navigates (it dropped `screen`/`activeParty`). A live editor test session still returns to
 * the editor (`nav.toEditor()`); every other disconnect — whether or not it was a persistent party —
 * now lands on the main menu, since `GameNavigation` only names one non-game, non-auth, non-editor
 * destination. Shared by `endGame` and `launchGameIdentity`'s launch-failure catch, which previously
 * duplicated this exact branch.
 *
 * `options.navigate === false` still clears the store/active-party the same way, but skips the
 * `nav.toEditor()`/`nav.toMenu()` push — `ui/AppRouter.tsx`'s history-BACK leave effect is the one
 * caller that needs this: by the time it runs, the browser has ALREADY moved the URL out from under
 * `/game` (a real `popstate`, not a `router.push()`), so pushing again would either stack a
 * duplicate history entry on top of where the user already landed, or — if a deeper BACK skipped
 * past `/menu`/`/editor` entirely — forcibly override the destination the user actually chose. Every
 * other caller (a natural disconnect, the editor test overlay's own "Exit" button, a launch failure)
 * still wants the push: none of them already changed the URL themselves.
 */
function returnFromGameSession(options?: StopOptions): void {
  const store = useUiStore.getState();
  const nav = getGameNavigation();
  store.clearedGameSession();
  const testSession = nav?.getAdventureTestSession();
  if (!testSession) nav?.setActiveParty(null);
  if (options?.navigate === false) return;
  if (testSession) {
    nav?.toEditor();
  } else {
    nav?.toMenu();
  }
}

/** The store is the single source of truth for whether the interior panel is open;
 *  InteriorOverlay renders it from `interiorDoorId`. */
function interiorOpen(): boolean {
  return useUiStore.getState().interiorDoorId !== null;
}

function settingsOpen(): boolean {
  return useUiStore.getState().settingsOpen;
}

function talentsOpen(): boolean {
  return useUiStore.getState().talentsOpen;
}

export function isGameplayInputPaused(): boolean {
  const store = useUiStore.getState();
  return (
    interiorOpen() ||
    settingsOpen() ||
    talentsOpen() ||
    store.inventoryOpen ||
    store.questJournalOpen ||
    store.merchantOpen ||
    store.eventDialogue !== null ||
    store.questDialogue !== null ||
    store.heroLoading !== null
  );
}

function heroLoadingColor(persistentParty: PartyListing): PrimaryColor {
  switch (persistentParty.myColor) {
    case "red":
      return "ember";
    case "yellow":
      return "moss";
    case "purple":
      return "violet";
    default:
      return "azure";
  }
}

function setStatus(key: MessageKey, params?: Record<string, string | number>): void {
  const status: LocalizedText = params === undefined ? { key } : { key, params };
  useUiStore.getState().setStatus(status);
}

function renderState(state: SelfState): void {
  useUiStore.getState().setSelfState(state);
  useUiStore.getState().setQuestStatus(state.quest.status);
}

function openInterior(door: InteriorDoor): void {
  useUiStore.getState().setInteriorDoorId(door.id);
}

function closeInterior(): void {
  useUiStore.getState().setInteriorDoorId(null);
}

function renderPlayer(
  player: PlayerSnapshot | undefined,
  corpse: GroundVector | null,
  movement: { breath: number; maxBreath: number; swimming: boolean } | null,
): void {
  useUiStore.getState().setSelf(
    player
      ? {
          id: player.id,
          nick: player.nick,
          level: player.level,
          hp: player.hp,
          maxHp: player.maxHp,
          breath: movement?.swimming
            ? {
                // One React update per elapsed second, not one per animation frame.
                current: Math.ceil(Math.max(0, movement.breath)),
                max: Math.ceil(movement.maxBreath),
              }
            : null,
          life: player.life,
          // Rounded, so a walking ghost does not re-render the HUD every frame.
          corpseDistance:
            player.life === "ghost" && corpse ? Math.round(groundDistance(player, corpse)) : null,
          class: player.class,
          appearance: { ...player.appearance },
          equipment: { ...player.equipment },
          guarding: player.guarding === true,
        }
      : null,
  );
}

/** Resolve species/kind params to localized names, then apply the event template. */
function eventText(
  code: EventCode,
  params: EventParams = {},
  playerClass?: PlayerSnapshot["class"],
): string {
  const resolved: EventParams = { ...params };
  if (typeof resolved.species === "string") {
    resolved.species = t(`monster.${resolved.species}` as MessageKey);
  }
  if (typeof resolved.kind === "string") {
    resolved.kind = t(`item.${resolved.kind}` as MessageKey);
  }
  if (typeof resolved.item === "string") {
    resolved.item = t(`consumable.${resolved.item}.name` as MessageKey);
  }
  if (typeof resolved.currency === "string") {
    resolved.currency = t(
      `item.${resolved.currency === "crystals" ? "crystal" : resolved.currency}` as MessageKey,
    );
  }
  if (typeof resolved.skill === "string" && playerClass) {
    resolved.skill = t(`skill.${playerClass}.${resolved.skill}.name` as MessageKey);
  }
  if (typeof resolved.chapter === "string") {
    resolved.chapter = t(`quest.${resolved.chapter}.name` as MessageKey);
  }
  if (typeof resolved.site === "string") {
    resolved.site = t(`quest.site.${resolved.site}` as MessageKey);
  }
  if (typeof resolved.nameKey === "string") {
    resolved.name = t(resolved.nameKey as MessageKey);
  }
  return t(`event.${code}` as MessageKey, resolved);
}

/** Your own hits spam the combat log; everything else is worth a line. */
function shouldLogEvent(code: EventCode): boolean {
  return code !== "combat.hit" && code !== "quest.site_harvested";
}

function healingSkillId(value: unknown): "mend" | "prayer" | "divine_nova" {
  return value === "prayer" || value === "divine_nova" ? value : "mend";
}

/**
 * Distance from a hero to a piece of COMPILED CATALOGUE content — a quest giver, a quest site, the
 * merchant. Their coordinates are pixel `Vec2`s whose `y` is a ground axis; a hero is now a tile-
 * unit `{x, y, z}` whose `y` is elevation, so the two cannot be compared at all.
 *
 * Every call site is behind `isKnownZone(zoneId)` (or a `merchant` that
 * `merchantForRuntimeRoom()` always returns `null` for), and no live room is ever built from a
 * catalogue zone — `WorldRoom` builds its world with `zoneFromMapPayload`, always. So this measures
 * nothing on any reachable path, and it exists as ONE named seam saying so rather than as five
 * inline hypotenuses that each look like a converted call site.
 */
function catalogueDistance(self: GroundVector, marker: { x: number; y: number }): number {
  return Math.hypot(self.x - marker.x, self.z - marker.y);
}

function updatePrompt(
  self: PlayerSnapshot | undefined,
  quest: QuestState,
  interiorDoor: InteriorDoor | undefined,
  zoneId: ZoneId,
  merchant: MerchantDefinition | null,
): void {
  let result: LocalizedText | null = null;
  // Prompt.tsx hides the floating prompt whenever the interior panel is open, so a
  // "close_interior" key here would never render - don't bother computing one. A D1 map has no
  // catalogue quests or interiors either, so `zoneDefinition`'s fallback-to-Verdant must not be
  // allowed to conjure a phantom quest prompt over a user map.
  if (interiorOpen() || !self || isSpirit(self.life)) {
    result = null;
  } else if (merchant && catalogueDistance(self, merchant) <= INTERACTION_RANGE) {
    result = { key: "prompt.merchant" };
  } else if (!isKnownZone(zoneId)) {
    result = null;
  } else {
    const chapter = quest.chapter ?? "three_offerings";
    const zone = zoneDefinition(zoneId);
    const definition = zone.quests.find((candidate) => candidate.id === chapter);
    if (!definition) {
      useUiStore.getState().setPrompt(null);
      return;
    }
    const giver = definition.giver;
    const nearNpc = catalogueDistance(self, giver) <= INTERACTION_RANGE;
    const site = zone.questSites.find(
      (candidate) =>
        candidate.chapter === chapter && catalogueDistance(self, candidate) <= INTERACTION_RANGE,
    );
    if (interiorDoor && !nearNpc) {
      result = { key: "prompt.look_inside", params: { name: t(interiorDoor.nameKey) } };
    } else if (
      nearNpc &&
      (quest.status === "available" || quest.status === "ready" || quest.status === "completed")
    ) {
      result = {
        key:
          quest.status === "available"
            ? "prompt.swear"
            : quest.status === "ready"
              ? "prompt.claim"
              : "prompt.speak",
      };
    } else if (quest.status === "active" && site) {
      result = {
        key: "prompt.quest_site" as MessageKey,
        params: { name: t(`quest.site.${site.id}` as MessageKey) },
      };
    } else if (quest.status === "active") {
      // "Go hunt outside the walls" only means something where there are walls, and there is no
      // longer a way to say where the walls are: `ZoneTerrain` carries no safe zone, because a
      // stored heightfield has no way to declare one. So the hunt prompt never applies — which
      // costs nothing on any reachable path, since the whole branch is behind `isKnownZone` and no
      // live room is built from a catalogue zone.
      result = null;
    } else if (quest.status === "available") {
      result = catalogueDistance(self, giver) > 420 ? null : { key: "prompt.approach" };
    }
  }
  useUiStore.getState().setPrompt(result);
}

function partyTargetError(
  reason: Extract<PartyTargetResolution, { ok: false }>["reason"],
): MessageKey {
  return reason === "self" ? "party.error.self" : "party.error.unknown_player";
}

function addEvent(text: string, tone: "info" | "good" | "bad"): void {
  useUiStore.getState().addEvent(text, tone);
}

async function startGameIdentity(
  identity: StoredHero,
  persistentParty: PartyListing,
  launchId: number,
): Promise<void> {
  const loadingStartedAt = performance.now();
  const initialStore = useUiStore.getState();
  getGameNavigation()?.setActiveParty(persistentParty);
  initialStore.setAdventureVictory(false);
  // Claims store ownership of this launch's `heroLoading`/`game` state synchronously, before the
  // one `await` below — see `UiState.launchOwner`'s docblock. A newer launch overwrites this
  // immediately when it starts, which is exactly the signal the stale branch below needs.
  initialStore.setLaunchOwner(launchId);
  initialStore.setHeroLoading({
    name: identity.name,
    class: identity.class,
    color: heroLoadingColor(persistentParty),
    phase: "preparing",
    progress: 8,
  });
  setStatus("status.connecting", { name: identity.name });
  const canvas = required<HTMLCanvasElement>("#stage");
  const serverClock = new ServerClock();
  const renderer: RendererLike = await Hd2dRenderer.create(canvas, serverClock);
  // Renderer creation is asynchronous — the ONLY `await` between "loading started" and "the game
  // handle is installed". `activeLaunchId` may have moved on for two reasons: another hero was
  // launched while assets were loading (`launchGameIdentity`'s own `++activeLaunchId`), or an
  // explicit external stop fired mid-load — the browser navigated away from `/game`
  // (`ui/AppRouter.tsx`'s leave effect, widened to also watch `heroLoading`) or the editor playtest
  // overlay reset/returned, both calling `stopActiveGameSession()`, which bumps the same counter.
  // Either way this result no longer owns the page and must destroy what it built — but the
  // store-wide clear must run ONLY if this launch still OWNS the store (`UiState.launchOwner`):
  // ownership is current truth, stamped synchronously by whichever launch is newest, so it stays
  // correct through any number of further launches/stops that happened during this await — unlike
  // a generation counter, which cannot tell an external stop already absorbed by a further
  // legitimate launch from one still waiting on this launch. If a newer launch took over, it
  // already re-stamped ownership to itself; wiping the store here would stomp its state.
  if (launchId !== activeLaunchId) {
    renderer.destroy();
    if (useUiStore.getState().launchOwner === launchId) {
      returnFromGameSession({ navigate: false });
    }
    return;
  }
  useUiStore.getState().setHeroLoading({
    name: identity.name,
    class: identity.class,
    color: heroLoadingColor(persistentParty),
    phase: "preparing",
    progress: 32,
  });
  let client = new WorldClient();
  let connection: Connection | null = null;
  const combatAudio = new SessionCombatAudio(sound, () => connection);
  let reconnectTimer: number | null = null;
  let loadingTimer: number | null = null;
  let loadingCompletionScheduled = false;
  let reconnectAttempts = 0;
  let reconnectCancelled = false;
  let intentionallyClosed = false;
  let ended = false;
  const input = trackInput();
  const cameraOrbit = trackCameraOrbit(canvas);
  let cameraYaw = 0;
  let stopActions: (() => void) | null = null;
  let questState: QuestState = {
    chapter: "three_offerings",
    status: "available",
    progress: 0,
    target: 3,
  };
  let welcomed = false;
  let currentSelf: PlayerSnapshot | undefined;
  let selfCorpse: GroundVector | null = null;
  let mapSurface: MapSurface | null = null;
  let activeZoneId: ZoneId = DEFAULT_ZONE_ID;
  let audioDayCycleOverride: DayCycleOverride = null;
  let dayNightCycleEnabled = true;
  let fixedLighting: MapFixedLighting = DEFAULT_MAP_FIXED_LIGHTING;
  const effectiveDayCycleOverride = (): DayCycleOverride =>
    audioDayCycleOverride ?? (dayNightCycleEnabled ? null : fixedLightingOverride(fixedLighting));
  let currentMerchant: MerchantDefinition | null = null;
  // A cross-map authored teleport shows its departure before the transition close, then its arrival
  // on the next authoritative welcome. Ordinary network reconnects never set this flag.
  let pendingTeleportArrival = false;
  // Remembered so a reconnect can re-attach them to a fresh surface: React mounted its canvases
  // once, and it will not re-run its effect just because the socket dropped.
  let minimapCanvas: HTMLCanvasElement | null = null;
  let worldMapCanvas: HTMLCanvasElement | null = null;

  const applyAuthoritativeState = (state: SelfState) => {
    const receivedAt = performance.now();
    if (typeof state.serverNow === "number") serverClock.sample(state.serverNow, receivedAt);
    const previous = useUiStore.getState().selfState;
    const notifications = previous
      ? questTrackerNotifications(previous.authoredQuests ?? [], state.authoredQuests ?? [])
      : [];
    renderState(state);
    for (const notification of notifications) addEvent(notification.text, notification.tone);
    if (notifications.some((notification) => notification.tone === "good")) sound.loot();
    renderer.setAuthoredQuestMarkers(state.authoredQuestMarkers ?? []);
    const deadlines = clientCooldownDeadlines(state.cooldowns, serverClock);
    const store = useUiStore.getState();
    store.setAttackCooldownUntil(deadlines.attackUntil);
    store.setHealCooldownUntil(deadlines.healUntil);
    for (const slot of [1, 2, 3, 4, 5] as const) {
      store.setSkillCooldown(slot, deadlines.skills[slot]);
    }
  };
  const playerClass = () => currentSelf?.class ?? identity.class;

  const onWorldPointerMove = (event: PointerEvent) => {
    const sheepId = renderer.pickSheep?.(event.clientX, event.clientY);
    canvas.classList.toggle("sheep-hover", sheepId !== null && sheepId !== undefined);
  };
  const onWorldPointerLeave = () => canvas.classList.remove("sheep-hover");
  const onWorldPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || isGameplayInputPaused()) return;
    const sheepId = renderer.pickSheep?.(event.clientX, event.clientY);
    if (!sheepId) return;
    event.preventDefault();
    connection?.sheepHit(sheepId);
  };
  canvas.addEventListener("pointermove", onWorldPointerMove);
  canvas.addEventListener("pointerleave", onWorldPointerLeave);
  canvas.addEventListener("pointerdown", onWorldPointerDown);

  const unlockAudio = () => sound.unlock();
  window.addEventListener("pointerdown", unlockAudio);
  window.addEventListener("keydown", unlockAudio);

  const handlers: Omit<ConnectionHandlers, "onClose"> = {
    onWelcome: (selfId, world, state) => {
      reconnectAttempts = 0;
      useUiStore.getState().setReconnect(null);
      // A reconnect lands a fresh welcome and the server aborted any run this hero triggered on the
      // disconnect, so no run is left to answer the panel — clear it rather than strand a dead panel.
      useUiStore.getState().setEventDialogue(null);
      useUiStore.getState().setQuestDialogue(null);
      if (!welcomed) {
        useUiStore.getState().setHeroLoading({
          name: identity.name,
          class: identity.class,
          color: heroLoadingColor(persistentParty),
          phase: "world",
          progress: 68,
        });
      }
      renderer.setSelfId(selfId);
      sound.configureScene(world.audio);
      sheepFeedback.reset(world.size, world.events);
      chestFeedback.reset(world.events);
      // Harvest replacements are explicit appearance metadata in the welcome. Queue them before
      // the first playable frame so the last authoritative hit never initiates their texture load.
      renderer.preloadWorldEventAssets(world.events);
      activeZoneId = world.zoneId;
      dayNightCycleEnabled = world.dayNightCycle ?? true;
      fixedLighting = world.fixedLighting ?? DEFAULT_MAP_FIXED_LIGHTING;
      renderer.setDayCycleOverride?.(effectiveDayCycleOverride());
      // Every live room is a database map: `WorldRoom` builds its world with `zoneFromMapPayload`
      // and never reads the compiled catalogue, so the old `isKnownZone(world.zoneId)` branch to
      // `configureZone` was routing that no snapshot could reach. It went with the PixiJS path,
      // which was the only renderer that could draw a compiled zone. The remaining `isKnownZone`
      // guards in this file are about catalogue QUESTS and interiors, not terrain, and still hold.
      // `parseServerMessage` refused the welcome outright if its heightfield did not decode, so
      // `heightfield` here is the terrain the server itself baked from — never a stand-in, and
      // never `null`.
      const heightfield = decodeMap(world.heightfield);
      if (heightfield) {
        renderer.configureMapTerrain(world.zoneId, world.elements, world.revision, heightfield, {
          tilesetId: world.tilesetId,
          layers: world.layers,
        });
      }
      currentMerchant = world.merchant;
      renderer.configureMerchant(world.merchant);
      // The welcome carries the whole zone: dimensions, obstacles, safe zone, quest sites. Baking
      // the texture measures 126-138ms warm — expensive enough that a reconnect landing back in
      // the same zone must reuse the existing bake rather than repaint an identical one. Only a
      // genuine zone change (mapSurface.matches(world) false) pays for a fresh bake; either way
      // the canvases are re-attached below, so a reconnect never leaves the map blank.
      if (!mapSurface?.matches(world)) {
        mapSurface = new MapSurface(world);
      }
      mapSurface.attachMinimap(minimapCanvas);
      mapSurface.attachWorldMap(worldMapCanvas);
      questState = state.quest;
      selfCorpse = state.corpse;
      applyAuthoritativeState(state);
      if (pendingTeleportArrival) {
        pendingTeleportArrival = false;
        const arrival = client
          .sample(performance.now())
          .players.find((player) => player.id === selfId);
        renderer.playTeleportEffect(arrival?.x, arrival?.z);
      }
      useUiStore.getState().setZoneNameKey(world.zoneNameKey as MessageKey);
      useUiStore.getState().setWorldSize({ size: world.size });
      useUiStore.getState().setMapHeroSettings(world.heroSettings ?? null);
      setStatus("status.connected_zone", { zone: t(world.zoneNameKey as MessageKey) });
      if (!welcomed) {
        welcomed = true;
        useUiStore.getState().setHeroLoading({
          name: identity.name,
          class: identity.class,
          color: heroLoadingColor(persistentParty),
          phase: "world",
          progress: 90,
        });
        addEvent(t("status.welcome_hint"), "info");
      }
    },
    onState: (state) => {
      questState = state.quest;
      selfCorpse = state.corpse;
      applyAuthoritativeState(state);
    },
    onChat: (from, text, channel) => {
      useUiStore.getState().addChat(from, text, channel);
      sound.chat();
    },
    onPartyInvite: (inviteId, fromId, from, expiresAt) => {
      useUiStore.getState().setPartyInvite({ inviteId, fromId, from, expiresAt });
      addEvent(t("party.invite_received", { name: from }), "info");
    },
    onPartyState: (party) => useUiStore.getState().setParty(party),
    onMerchantOpen: () => {
      const store = useUiStore.getState();
      store.setMapOpen(false);
      store.setTalentsOpen(false);
      store.setSettingsOpen(false);
      store.setInventoryOpen(false);
      store.setQuestJournalOpen(false);
      store.setMerchantOpen(true);
      input.reset();
    },
    onSeaGuardianDevour: () => sound.seaGuardianDevour(),
    onAnimation: (animation: CombatAnimation) => {
      renderer.playCombatAnimation(animation);
      if (animation.actorKind === "monster") sound.monsterAttack();
      else if (animation.skillId) sound.skillCast(animation.skillId);
    },
    onMonsterSpecialImpact: (impact: MonsterSpecialImpact) => {
      const impactSound = renderer.playMonsterSpecialImpact(impact);
      if (impactSound) sound.monsterSpecialImpact(impactSound);
    },
    onShadowDance: (sequence: RogueShadowDanceSequence) => {
      renderer.playShadowDance(sequence);
      sound.combatPulse();
    },
    onLumenPortal: (portal: PriestLumenPortalVisual) => renderer.playLumenPortal(portal),
    onLumenTrail: (trail: PriestLumenTrailVisual) => renderer.playLumenTrail(trail),
    onPolarityOrb: (orb: PriestPolarityOrbVisual) => renderer.playPolarityOrb(orb),
    onPeasantCamp: (camp: PeasantCampVisual) => renderer.showPeasantCamp(camp),
    onPeasantCampBank: (bank: PeasantCampBankVisual) => {
      const store = useUiStore.getState();
      if (bank.opened || store.campBank?.id === bank.id) {
        store.setCampBank({ id: bank.id, gold: bank.gold });
        if (bank.opened) input.reset();
      }
    },
    onPeasantCampRemoved: (camp: PeasantCampRemovedVisual) => {
      renderer.removePeasantCamp(camp.id);
      const store = useUiStore.getState();
      if (store.campBank?.id === camp.id) store.setCampBank(null);
    },
    onPeasantBombImpact: (impact: PeasantBombImpactVisual) =>
      renderer.playPeasantBombImpact(impact),
    // The dialogue panel (spec Decision 4): the server pushes beats to THIS player, the store holds
    // the open panel, EventDialoguePanel renders it. Prose is authored data rendered verbatim; the
    // panel's own chrome stays i18n. `event.close` only clears if it names the run currently shown —
    // a late close for an already-superseded run must not blank a fresh one.
    onEventSay: (runId, text, name) => {
      sound.interact();
      input.reset();
      useUiStore
        .getState()
        .setEventDialogue(
          name === undefined ? { kind: "say", runId, text } : { kind: "say", runId, text, name },
        );
    },
    onEventChoices: (runId, prompt, options) => {
      input.reset();
      useUiStore.getState().setEventDialogue({ kind: "choices", runId, prompt, options });
    },
    onEventClose: (runId) => {
      const store = useUiStore.getState();
      if (store.eventDialogue?.runId === runId) {
        input.reset();
        store.setEventDialogue(null);
      }
    },
    onQuestOpen: (conversationId, entries) => {
      sound.interact();
      input.reset();
      const store = useUiStore.getState();
      store.setEventDialogue(null);
      store.setQuestDialogue({ kind: "open", conversationId, entries });
    },
    onQuestResult: (conversationId, questId, speakerName, title, text, outcome) => {
      const store = useUiStore.getState();
      if (store.questDialogue?.conversationId !== conversationId) return;
      store.setQuestDialogue({
        kind: "result",
        conversationId,
        questId,
        speakerName,
        title,
        text,
        outcome,
      });
      if (outcome === "accepted" || outcome === "completed") sound.loot();
    },
    onQuestClose: (conversationId) => {
      const store = useUiStore.getState();
      if (store.questDialogue?.conversationId === conversationId) {
        input.reset();
        store.setQuestDialogue(null);
      }
    },
    onEvent: (code, params, tone, x, z) => {
      const text = eventText(code, params, currentSelf?.class ?? identity.class);
      if (shouldLogEvent(code)) addEvent(text, tone);
      if (code === "adventure.victory") {
        useUiStore.getState().setAdventureVictory(true);
        const nav = getGameNavigation();
        const activeParty = nav?.getActiveParty() ?? null;
        if (activeParty) nav?.setActiveParty({ ...activeParty, status: "completed" });
      }
      if (shouldFloatEvent(code)) {
        const compact =
          code === "combat.hit" || code === "combat.hurt"
            ? `-${String(params?.damage ?? "")}`
            : code === "heal.cast" || code === "heal.received"
              ? `+${String(params?.amount ?? "")}`
              : text;
        renderer.showWorldEvent(
          compact,
          tone,
          x,
          z,
          typeof params?.targetId === "string" ? params.targetId : undefined,
        );
      }
      if (code === "quest.site_harvested" && typeof params?.site === "string") {
        renderer.hideQuestSite(params.site, 15_000);
      }
      // `skill.cast` remains visible through the event log and CombatAnimation owns its sound/art.
      // It intentionally has no switch branch: only SelfState may update cooldown deadlines.
      switch (code) {
        case "zone.transition":
          if (params?.teleport === 1) {
            renderer.playTeleportEffect(x, z);
            if (
              params.sameMap === 1 &&
              typeof params.toX === "number" &&
              typeof params.toZ === "number"
            ) {
              renderer.playTeleportEffect(params.toX, params.toZ);
            } else {
              pendingTeleportArrival = true;
            }
          }
          break;
        case "level_up":
        case "quest.fulfilled":
          sound.levelUp();
          break;
        case "heal.cast":
          renderer.playHealingImpact(
            healingEffectColor(params?.color),
            healingSkillId(params?.skill),
            x,
            z,
          );
          break;
        case "loot.picked":
        case "authored_quest.reward":
        case "quest.accepted":
        case "quest.site_harvested":
        case "item.used":
          sound.loot();
          break;
        case "heal.received":
          sound.healReceived();
          renderer.playHealingImpact(
            healingEffectColor(params?.color),
            healingSkillId(params?.skill),
            x,
            z,
          );
          break;
        case "player.down":
        case "death.fallen":
        case "death.released":
          sound.death();
          break;
        case "death.reclaimed":
        case "death.resurrected":
          sound.levelUp();
          break;
        case "resurrect.cast":
          sound.healReceived();
          break;
        case "combat.hit":
          combatAudio.confirmedEvent(code);
          if (typeof params?.skill === "string" && typeof x === "number" && typeof z === "number") {
            const actorId = typeof params.actorId === "string" ? params.actorId : client.selfId;
            const poisonOutcome = params.poisonTick === 1 || params.poisonRupture === 1;
            const targetId = typeof params.targetId === "string" ? params.targetId : undefined;
            const impactClass = poisonOutcome
              ? renderer.playRoguePoisonImpact(x, z, params.poisonRupture === 1, targetId)
              : actorId
                ? renderer.playCombatImpact(actorId, params.skill, x, z, targetId)
                : undefined;
            sound.combatImpact(impactClass ?? playerClass());
          }
          break;
        case "skill.blocked":
          if (typeof params?.skill === "string" && typeof x === "number" && typeof z === "number")
            if (client.selfId) renderer.playCombatImpact(client.selfId, params.skill, x, z);
          break;
        case "combat.hurt":
          combatAudio.confirmedEvent(code);
          sound.hit();
          if (
            typeof params?.species === "string" &&
            isMonsterSpecies(params.species) &&
            !(
              typeof params.technique === "string" &&
              isMonsterSpecialTechnique(params.technique) &&
              params.technique !== "none"
            )
          ) {
            renderer.playMonsterImpact(params.species, x, z);
          }
          break;
        default:
          break;
      }
    },
  };

  const beforeUnload = () => {
    intentionallyClosed = true;
    connection?.close();
  };
  let stopSession: (options?: StopOptions) => void;
  const endGame = (key: MessageKey, options?: StopOptions) => {
    if (ended) return;
    ended = true;
    if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
    if (loadingTimer !== null) window.clearTimeout(loadingTimer);
    reconnectTimer = null;
    loadingTimer = null;
    input.stop();
    cameraOrbit.stop();
    stopActions?.();
    window.removeEventListener("pointerdown", unlockAudio);
    window.removeEventListener("keydown", unlockAudio);
    window.removeEventListener("beforeunload", beforeUnload);
    canvas.removeEventListener("pointermove", onWorldPointerMove);
    canvas.removeEventListener("pointerleave", onWorldPointerLeave);
    canvas.removeEventListener("pointerdown", onWorldPointerDown);
    canvas.classList.remove("sheep-hover");
    sound.stopAmbient();
    renderer.destroy();
    if (stopActiveSession === stopSession) stopActiveSession = null;
    // Also clears mapOpen and settingsOpen: without that, either overlay survives a terminal
    // disconnect and reappears full-screen the instant the next character's world loads, over a
    // world that has not sent it a welcome yet.
    returnFromGameSession(options);
    setStatus("status.disconnected", { reason: t(key) });
  };
  stopSession = (options?: StopOptions) => {
    intentionallyClosed = true;
    connection?.close();
    endGame("status.close.generic", options);
  };
  stopActiveSession = stopSession;

  const cancelReconnect = () => {
    reconnectCancelled = true;
    endGame("status.close.generic");
  };

  const openConnection = () => {
    client = new WorldClient();
    let closed = false;
    // `WorldClient.connect()` itself resolves `GET /api/join` before opening the socket (identity
    // and party id below), on every call — so the ZONE_TRANSITION (4008) branch's near-immediate
    // `scheduleReconnect(120)` below, which calls `openConnection()` again, automatically re-runs
    // resolveJoin and reads the hero's map AFTER the transition. No extra plumbing is needed here:
    // this reconnect table only reacts to close codes, it never has to know a room changed.
    connection = client.connect(
      {
        ...handlers,
        onClose: (code, reason) => {
          if (closed) return;
          closed = true;
          if (intentionallyClosed || reconnectCancelled) return;
          // The raw wire reason is English server prose; never render it directly.
          console.debug("connection closed", code, reason);
          if (code === WS_CLOSE.ZONE_TRANSITION) {
            reconnectAttempts = 0;
            useUiStore.getState().setReconnect({ kind: "transition", attempt: 0, cancelReconnect });
            scheduleReconnect(120);
            return;
          }
          const terminal: MessageKey | null =
            code === WS_CLOSE.CHARACTER_REPLACED
              ? "status.close.elsewhere"
              : code === WS_CLOSE.CHARACTER_DELETED
                ? "status.close.deleted"
                : code === WS_CLOSE.SESSION_EXPIRED
                  ? "status.close.session_expired"
                  : code === WS_CLOSE.PRESENCE_LOST || code === WS_CLOSE.PRESENCE_ERROR
                    ? "status.close.presence"
                    : code === WS_CLOSE.ROOM_FULL
                      ? "status.close.room_full"
                      : code === WS_CLOSE.INVALID_LOCATION
                        ? "status.close.invalid_location"
                        : code === 1008 || code === 1009
                          ? "status.close.policy"
                          : null;
          if (terminal) {
            endGame(terminal);
            return;
          }
          if (reconnectAttempts >= 4) {
            endGame("status.close.generic");
            return;
          }
          reconnectAttempts += 1;
          useUiStore
            .getState()
            .setReconnect({ kind: "network", attempt: reconnectAttempts, cancelReconnect });
          scheduleReconnect(250 * 2 ** (reconnectAttempts - 1));
        },
      },
      identity.id,
      persistentParty.id,
    );
  };

  const scheduleReconnect = (delayMs: number) => {
    if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      if (!reconnectCancelled) openConnection();
    }, delayMs);
  };

  useUiStore.getState().setHeroLoading({
    name: identity.name,
    class: identity.class,
    color: heroLoadingColor(persistentParty),
    phase: "connecting",
    progress: 48,
  });
  openConnection();

  const attack = (): boolean => {
    if (interiorOpen()) return false;
    sound.unlock();
    // The intent itself does not start combat music: an attack into empty space has no threat.
    // Authoritative aggro snapshots and confirmed hit/hurt events own that transition.
    combatAudio.attack();
    return true;
  };
  const interact = () => {
    sound.unlock();
    // Mid-dialogue, the interact key (the RPG convention) ADVANCES the say page rather than
    // re-triggering the event — the server's one-run lock would drop a re-trigger anyway, but routing
    // here keeps the interact key meaning "continue" while a panel is open. A choices panel swallows
    // interact (a pick needs an explicit option), so it never falls through to re-trigger either.
    const dialogue = useUiStore.getState().eventDialogue;
    if (dialogue) {
      if (dialogue.kind === "say") connection?.eventAdvance(dialogue.runId);
      input.reset();
      return;
    }
    if (useUiStore.getState().questDialogue) {
      input.reset();
      return;
    }
    if (interiorOpen()) {
      closeInterior();
      input.reset();
      return;
    }
    const door = nearestInterior(currentSelf, activeZoneId);
    const chapter = questState.chapter ?? "three_offerings";
    // Only a catalogue zone has quests; on a D1 map `zoneDefinition` would fall back to Verdant and
    // hand back its quest giver, making the player "near" a keeper who is not on this map.
    const giver = isKnownZone(activeZoneId)
      ? zoneDefinition(activeZoneId).quests.find((candidate) => candidate.id === chapter)?.giver
      : undefined;
    const nearNpc =
      currentSelf && giver && catalogueDistance(currentSelf, giver) <= INTERACTION_RANGE;
    if (door && !nearNpc) {
      sound.interact();
      input.reset();
      openInterior(door);
      return;
    }
    sound.interact();
    renderer.playInteraction();
    connection?.interact();
  };
  const usePotion = () => {
    if (interiorOpen()) return;
    sound.unlock();
    sound.loot();
    connection?.usePotion();
  };
  const useItem = (item: ConsumableId) => {
    if (interiorOpen()) return;
    sound.unlock();
    sound.loot();
    connection?.useItem(item);
  };
  const release = () => {
    if (interiorOpen()) return;
    sound.unlock();
    connection?.release();
  };
  const castSkill = (slot: SkillSlot) => {
    if (interiorOpen()) return;
    const store = useUiStore.getState();
    const now = performance.now();
    const cooldownUntil =
      slot === 1 ? store.attackCooldownUntil : (store.skillCooldowns[slot] ?? 0);
    const shadowReturnUntil =
      store.self?.class === "rogue" && slot === 2
        ? clientShadowReturnDeadline(store.selfState?.rogue?.shadowReturnUntil ?? 0, serverClock)
        : 0;
    const afterimageUntil =
      store.self?.class === "ranger" && slot === 4
        ? clientShadowReturnDeadline(store.selfState?.ranger?.afterimageUntil ?? 0, serverClock)
        : 0;
    const danceMarksUntil =
      store.self?.class === "rogue" && slot === 5
        ? clientShadowReturnDeadline(store.selfState?.rogue?.danceMarksUntil ?? 0, serverClock)
        : 0;
    const danceMarksAvailableAt =
      store.self?.class === "rogue" && slot === 5
        ? clientShadowReturnDeadline(
            store.selfState?.rogue?.danceMarksAvailableAt ?? 0,
            serverClock,
          )
        : 0;
    const danceReactivationUntil = activeReactivationDeadline(
      danceMarksAvailableAt,
      danceMarksUntil,
      now,
    );
    if (
      skillCooldownBlocksCast(
        cooldownUntil,
        Math.max(shadowReturnUntil, afterimageUntil, danceReactivationUntil),
        now,
      )
    )
      return;
    if (slot === 1) {
      attack();
      return;
    }
    sound.unlock();
    connection?.skill(slot);
  };
  const releaseSkill = (slot: SkillSlot) => {
    connection?.releaseSkill(slot);
  };
  const switchCharacter = () => {
    stopSession();
  };
  const logoutAndReload = () => {
    stopSession();
    // `GameNavigation.logout()` (Task 3): Alepha's `ReactAuth.logout()`, a `<form>` POST whose
    // server-side redirect navigates the browser away on its own — no manual reload needed after
    // it, unlike the old `api.ts` `logout()` this replaces.
    getGameNavigation()?.logout();
  };
  /**
   * Leave the running game and go back to the title screen, KEEPING the session.
   *
   * Deliberately not `logout()`: that revokes the cookie server-side and reloads, so the player has
   * to sign in again. Stepping out of a party is not signing out — `stopSession` already closes the
   * socket and ends the game cleanly, and the title screen is one store transition away.
   */
  const returnToTitle = () => {
    stopSession();
    // `stopSession` already ran `endGame` -> `returnFromGameSession` above (clearing the session
    // and navigating), but that branch can land on the editor screen for a live test session — this
    // button's contract is unconditional ("go back to the title/menu"), so it always finishes by
    // overriding to the menu.
    const nav = getGameNavigation();
    nav?.setActiveParty(null);
    nav?.toMenu();
  };
  const toggleSettings = () => {
    if (interiorOpen()) {
      closeInterior();
      input.reset();
      return;
    }
    if (useUiStore.getState().mapOpen) {
      useUiStore.getState().setMapOpen(false);
      input.reset();
      return;
    }
    if (talentsOpen()) {
      useUiStore.getState().setTalentsOpen(false);
      input.reset();
      return;
    }
    const overlayStore = useUiStore.getState();
    if (overlayStore.questJournalOpen) {
      overlayStore.setQuestJournalOpen(false);
      input.reset();
      return;
    }
    if (overlayStore.inventoryOpen || overlayStore.merchantOpen) {
      overlayStore.setInventoryOpen(false);
      overlayStore.setMerchantOpen(false);
      input.reset();
      return;
    }
    const nextOpen = !settingsOpen();
    useUiStore.getState().setSettingsOpen(nextOpen);
    if (nextOpen) input.reset();
  };

  stopActions = trackActions(
    {
      attack,
      interact,
      usePotion,
      useQuickItem: (index) => {
        const item = getGameNavigation()?.getQuickItems()[index];
        if (item) useItem(item);
      },
      release,
      castSkill,
      releaseSkill,
      focusChat: () => {
        input.reset();
        useUiStore.getState().requestChatFocus();
      },
      toggleMap: () => {
        const store = useUiStore.getState();
        store.setTalentsOpen(false);
        store.setInventoryOpen(false);
        store.setQuestJournalOpen(false);
        store.setMerchantOpen(false);
        store.setMapOpen(!store.mapOpen);
      },
      toggleTalents: () => {
        const store = useUiStore.getState();
        store.setMapOpen(false);
        store.setSettingsOpen(false);
        store.setInventoryOpen(false);
        store.setQuestJournalOpen(false);
        store.setMerchantOpen(false);
        store.setTalentsOpen(!store.talentsOpen);
        input.reset();
      },
      toggleInventory: () => {
        const store = useUiStore.getState();
        store.setMapOpen(false);
        store.setTalentsOpen(false);
        store.setSettingsOpen(false);
        store.setQuestJournalOpen(false);
        store.setMerchantOpen(false);
        store.setInventoryOpen(!store.inventoryOpen);
        input.reset();
      },
      toggleQuests: () => {
        const store = useUiStore.getState();
        store.setMapOpen(false);
        store.setTalentsOpen(false);
        store.setSettingsOpen(false);
        store.setInventoryOpen(false);
        store.setMerchantOpen(false);
        store.setQuestJournalOpen(!store.questJournalOpen);
        input.reset();
      },
      toggleSettings,
    },
    () => !isGameplayInputPaused(),
  );

  useUiStore.getState().setGame({
    attack,
    interact,
    campGold: (id, operation, amount) => connection?.campGold(id, operation, amount),
    usePotion,
    useItem,
    buyItem: (item) => connection?.buyItem(item),
    release,
    castSkill,
    releaseSkill,
    unlockTalent: (nodeId) => connection?.unlockTalent(nodeId),
    resetTalents: () => connection?.resetTalents(),
    setMovement: (movement) => input.setVirtual(movement),
    sendChat: (text, channel) => connection?.sendChat(text, channel),
    partyCreate: () => connection?.partyCreate(),
    partyInvite: (query) => {
      const target = resolvePartyTarget(
        client.sample(performance.now()).players,
        query,
        client.selfId,
      );
      if (!target.ok) return addEvent(t(partyTargetError(target.reason)), "bad");
      connection?.partyInvite(target.playerId);
    },
    partyAccept: (inviteId) => {
      connection?.partyAccept(inviteId);
      useUiStore.getState().setPartyInvite(null);
    },
    partyRefuse: (inviteId) => {
      connection?.partyRefuse(inviteId);
      useUiStore.getState().setPartyInvite(null);
    },
    partyLeave: () => connection?.partyLeave(),
    partyKick: (query) => {
      const target = resolvePartyTarget(
        client.sample(performance.now()).players,
        query,
        client.selfId,
      );
      if (!target.ok) return addEvent(t(partyTargetError(target.reason)), "bad");
      connection?.partyKick(target.playerId);
    },
    partyDissolve: () => connection?.partyDissolve(),
    eventAdvance: (runId) => connection?.eventAdvance(runId),
    eventChoose: (runId, index) => connection?.eventChoose(runId, index),
    questAction: (conversationId, action, questId, rewardChoiceId) =>
      connection?.questAction(conversationId, action, questId, rewardChoiceId),
    abandonQuest: (questId) => connection?.abandonQuest(questId),
    switchCharacter,
    logout: logoutAndReload,
    returnToTitle,
    setTestDayCycle: (override) => {
      audioDayCycleOverride = override;
      renderer.setDayCycleOverride?.(effectiveDayCycleOverride());
    },
    attachMinimap: (canvas) => {
      minimapCanvas = canvas;
      mapSurface?.attachMinimap(canvas);
    },
    attachWorldMap: (canvas) => {
      worldMapCanvas = canvas;
      mapSurface?.attachWorldMap(canvas);
    },
  });

  renderer.onFrame((now, dt) => {
    sound.setNightWeight(
      mapDayCycleAt(Date.now(), activeZoneId, effectiveDayCycleOverride()).nightWeight,
    );
    sound.update(now);
    const paused = isGameplayInputPaused();
    const cameraSample = cameraOrbit.takeSample(dt);
    const nextCameraYaw = limitedCameraYaw(
      cameraYaw,
      paused ? 0 : cameraSample.delta,
      !paused && cameraSample.orbiting,
      dt,
    );
    const cameraDelta = nextCameraYaw - cameraYaw;
    cameraYaw = nextCameraYaw;
    if (cameraDelta !== 0) renderer.rotateCamera(cameraDelta);
    const movementEvents = client.update(
      paused ? NO_INPUT : rotateMovementInput(input.current(), cameraYaw),
      dt,
    );
    sound.movement(movementEvents);
    const movementStatus = client.movementStatus();
    const sample = client.sample(now);
    for (const feedback of sheepFeedback.sync(sample.events)) {
      if (feedback.type === "bleat") sound.sheepBleat(feedback.eventId, feedback.hit);
      else {
        sound.sheepExplosion(feedback.eventId);
        renderer.playSheepExplosion(feedback.x, feedback.z);
      }
    }
    for (const feedback of chestFeedback.sync(sample.events)) sound.chest(feedback === "open");
    combatAudio.setServerThreat(sample.monsters);
    const self = sample.players.find((player) => player.id === client.selfId);
    sound.setSeaGuardianNearby(
      Boolean(
        self?.swimming &&
          sample.seaGuardians.some(
            (guardian) => groundDistance(self, guardian) <= SEA_GUARDIAN_AMBIENCE_RADIUS,
          ),
      ),
    );
    currentSelf = self;
    renderer.playHeroMovement(movementEvents, self ?? null);
    if (welcomed && self && !loadingCompletionScheduled) {
      loadingCompletionScheduled = true;
      useUiStore.getState().setHeroLoading({
        name: identity.name,
        class: identity.class,
        color: heroLoadingColor(persistentParty),
        phase: "ready",
        progress: 100,
      });
      const remainingMs = Math.max(180, 850 - (performance.now() - loadingStartedAt));
      loadingTimer = window.setTimeout(() => {
        loadingTimer = null;
        useUiStore.getState().setHeroLoading(null);
      }, remainingMs);
    }
    const door = nearestInterior(self, activeZoneId);
    const context: RenderContext = {
      quest: questState,
      now,
      healthBars: getDisplaySettings().healthBars,
      grid: getDisplaySettings().grid,
      ...(self ? { self } : {}),
      ...(movementStatus
        ? {
            movement: {
              breath: movementStatus.breath,
              maxBreath: movementStatus.maxBreath,
              swimming: movementStatus.swimming,
            },
          }
        : {}),
    };
    renderer.render(sample, context);
    mapSurface?.draw(sample, self, selfCorpse);
    renderPlayer(self, selfCorpse, movementStatus);
    updatePrompt(self, questState, door, activeZoneId, currentMerchant);
  });
  window.addEventListener("beforeunload", beforeUnload);

  // A handle for measuring input latency and interpolation from the outside. Dev builds only.
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).__lindocara = {
      all: () => client.sample(performance.now()),
      self: () => {
        const player = client.sample(performance.now()).players.find((p) => p.id === client.selfId);
        if (!player) return undefined;
        const movement = client.movementStatus();
        return {
          ...player,
          breath: movement?.breath ?? null,
          maxBreath: movement?.maxBreath ?? null,
          vy: movement?.vy ?? 0,
        };
      },
      attack: () => attack(),
      renderStats: () => renderer.diagnostics(),
      /**
       * Pin the light, or hand it back to the clock.
       *
       * A map's phase is `mapDayCycleOffset(mapId)` against the wall clock, so which light a given
       * map opens in is effectively arbitrary and a full cycle is 24 real minutes. That is fine for
       * play and useless for looking at terrain: a screenshot of a cliff face is a screenshot of a
       * black rectangle for half the day, and "wait twelve minutes" is not a workflow. The
       * adventure-test overlay already owns exactly this switch (`setTestDayCycle`); this only
       * reaches it from outside React, the way the rest of this handle reaches the simulation.
       */
      setDayCycle: (override: DayCycleOverride) => {
        audioDayCycleOverride = override;
        renderer.setDayCycleOverride?.(override);
      },
    };
  }
}

async function launchGameIdentity(
  identity: StoredHero,
  persistentParty: PartyListing,
): Promise<void> {
  const launchId = ++activeLaunchId;
  stopCurrentSession();
  stopActiveSession = null;
  getGameNavigation()?.toGame();
  try {
    await startGameIdentity(identity, persistentParty, launchId);
  } catch (error) {
    if (launchId === activeLaunchId) {
      stopCurrentSession();
      stopActiveSession = null;
      returnFromGameSession();
    }
    throw error;
  }
}

export function startGameAsHero(hero: StoredHero, party: PartyListing): Promise<void> {
  return launchGameIdentity(hero, party);
}

/**
 * Cleanly tear down the current renderer/socket before an editor playtest reset or return.
 *
 * `{ navigate: false }` is for `ui/AppRouter.tsx`'s history-BACK leave effect only — see
 * `returnFromGameSession`'s docblock for why that one caller must not also push a route.
 */
export function stopActiveGameSession(options?: StopOptions): void {
  activeLaunchId += 1;
  stopCurrentSession(options);
  stopActiveSession = null;
}
