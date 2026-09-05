/** DEV witness: shipped controller, animation clock, billboard registry, camera and lighting. */
import { starterEquipmentFor } from "@lindocara/engine/character.js";
import { PLAYER_ACTIONS } from "@lindocara/engine/combat-actions.js";
import { CLASS_STATS } from "@lindocara/engine/game.js";
import type { MapData } from "@lindocara/engine/hd2d/map-data.js";
import type {
  CombatActionSnapshot,
  PlayerSnapshot,
  RogueShadowDanceSequence,
} from "@lindocara/engine/protocol.js";
import { ROGUE_BALANCE } from "@lindocara/engine/rogue.js";
import { zoneTerrainFromHeightfield } from "@lindocara/engine/terrain-access.js";
import { ASSASSIN_V2_MANIFEST } from "@lindocara/renderer/assassin-v2-art.js";
import { CharacterAnimationTracker } from "@lindocara/renderer/character-animation.js";
import { Hd2dRenderer } from "@lindocara/renderer/hd2d/game-renderer.js";
import { ServerClock } from "@lindocara/renderer/server-clock.js";

import { createHeroController } from "../game/hero-controller.js";
import { acquireStageCanvas, releaseStageCanvas } from "../game/stage-canvas.js";

export async function startAssassinPreview(): Promise<void> {
  const canvas = acquireStageCanvas();
  const size = 40;
  const map: MapData = {
    version: 1,
    size,
    levelHeight: 0.9,
    waterLevel: -0.05,
    levels: Array.from({ length: size * size }, (_, i) =>
      i % size > 31 && Math.floor(i / size) < 15 ? null : 0,
    ),
    materials: Array.from({ length: size * size }, (_, i) =>
      (Math.floor(i / size) + (i % size)) % 6 === 0 ? "sable" : "herbe",
    ),
    colliders: [],
    spawns: [{ name: "default", x: 0, z: 0 }],
    elements: [],
    events: [],
  };
  const terrain = zoneTerrainFromHeightfield(map);
  const hero = createHeroController({
    terrain,
    spawn: { x: 0, y: 0, z: 0 },
    speed: CLASS_STATS.rogue.movementSpeed,
  });
  const clock = new ServerClock();
  clock.sample(0, 0);
  const renderer = await Hd2dRenderer.create(canvas, clock);
  renderer.configureMapTerrain("assassin-v2-witness", [], 1, map);
  renderer.setSelfId("assassin-v2-witness");
  renderer.setDayCycleOverride("day");
  const caption = document.createElement("pre");
  caption.style.cssText =
    "position:fixed;left:16px;top:12px;z-index:20;background:#14212be8;color:#e4e9e3;padding:12px 16px;font:12px/1.7 monospace;pointer-events:none;border-radius:4px";
  document.querySelector("#root")?.append(caption);
  const keys = new Set<string>();
  let now = 0,
    auto = true,
    paused = false,
    rate = 1,
    hp = 100,
    dead = false,
    action: CombatActionSnapshot | null = null;
  let lastCaption = -1_000,
    actionSerial = 0,
    heading: number | null = null,
    forcedJump = false;
  const tracker = new CharacterAnimationTracker();
  let latest: unknown = null;
  let partySize = 1;
  let showReferences = true;
  let released = false,
    invisibleUntil = 0,
    danceUntil = 0;
  const cast = (slot: number, heldMs = 0, aim?: { x: number; z: number }): void => {
    const definition = PLAYER_ACTIONS.rogue[slot - 1];
    if (!definition || dead) return;
    actionSerial++;
    released = false;
    action = {
      id: `witness-action-${actionSerial}`,
      kind: "skill",
      skillId: definition.skillId,
      direction: aim ?? { ...hero.facing },
      startedAt: now,
      impactAt: now + definition.anticipationMs,
      recoveryEndsAt: now + definition.anticipationMs + heldMs + definition.recoveryMs,
      resolved: false,
    };
    renderer.playCombatAnimation({
      t: "animation",
      actionId: action.id,
      actorKind: "player",
      actorId: "assassin-v2-witness",
      action: "skill",
      skillId: definition.skillId,
      direction: action.direction,
      startedAt: action.startedAt,
      impactAt: action.impactAt,
      recoveryEndsAt: action.recoveryEndsAt,
    });
  };
  const reset = (): void => {
    hero.teleport({ x: 0, y: 0, z: 0 });
    dead = false;
    hp = 100;
    action = null;
    invisibleUntil = 0;
    danceUntil = 0;
  };
  const keydown = (event: KeyboardEvent): void => {
    keys.add(event.code);
    if (["KeyW", "KeyA", "KeyS", "KeyD"].includes(event.code)) auto = false;
    if (event.repeat) return;
    if (/Digit[1-5]/.test(event.code)) cast(Number(event.code.slice(-1)));
    if (event.code === "KeyP") paused = !paused;
    if (event.code === "KeyT") {
      auto = !auto;
      heading = null;
    }
    if (event.code === "KeyK") {
      dead = true;
      action = null;
    }
    if (event.code === "KeyH") hp = Math.max(1, hp - 10);
    if (event.code === "KeyR") reset();
    if (event.code === "KeyN") {
      auto = false;
      hero.teleport({ x: 14, y: -0.05, z: -10 });
    }
    if (event.code === "Space") event.preventDefault();
    if (event.code === "BracketLeft") rate = Math.max(0.1, rate - 0.25);
    if (event.code === "BracketRight") rate = Math.min(2, rate + 0.25);
  };
  const keyup = (event: KeyboardEvent): void => {
    keys.delete(event.code);
  };
  window.addEventListener("keydown", keydown);
  window.addEventListener("keyup", keyup);
  const api = {
    read: () => latest,
    auto: (value: boolean) => {
      auto = value;
    },
    heading: (value: number | null) => {
      heading = value;
    },
    cast,
    reset,
    jump: () => {
      forcedJump = true;
    },
    die: () => {
      dead = true;
      action = null;
    },
    hurt: () => {
      hp = Math.max(1, hp - 10);
    },
    water: () => {
      auto = false;
      heading = null;
      hero.teleport({ x: 14, y: -0.05, z: -10 });
    },
    pause: (value: boolean) => {
      paused = value;
    },
    rate: (value: number) => {
      rate = Math.max(0.1, Math.min(2, value));
    },
    turnCamera: (radians: number) => {
      renderer.rotateCamera(radians);
    },
    pitch: (radians: number) => renderer.setCameraPitch(radians),
    party: (count: number) => {
      partySize = Math.max(1, Math.min(4, Math.floor(count)));
    },
    references: (visible: boolean) => {
      showReferences = visible;
    },
    step: (seconds = 1 / 60) => {
      paused = false;
      for (let remaining = seconds; remaining > 0.000001; remaining -= 1 / 60)
        frame(Math.min(1 / 60, remaining));
      paused = true;
    },
  };
  Object.assign(window, { assassinPreview: api });
  const frame = (frameDt: number): void => {
    if (paused && latest !== null) return;
    const dt = paused ? 0 : Math.min(0.05, Math.max(0, frameDt)) * rate;
    now += dt * 1_000;
    let x = Number(keys.has("KeyD")) - Number(keys.has("KeyA"));
    let z = Number(keys.has("KeyS")) - Number(keys.has("KeyW"));
    const angle = heading ?? (auto ? ((Math.floor(now / 1_500) % 8) * Math.PI) / 4 : null);
    if (angle !== null) {
      x = Math.sin(angle);
      z = Math.cos(angle);
    }
    if (dead || now < danceUntil) {
      x = 0;
      z = 0;
    }
    const events = hero.step({ x, z, jump: !dead && (forcedJump || keys.has("Space")) }, dt);
    forcedJump = false;
    if (keys.has("ArrowLeft")) renderer.rotateCamera(-dt);
    if (keys.has("ArrowRight")) renderer.rotateCamera(dt);
    if (action && now >= action.recoveryEndsAt) action = null;
    if (action && now >= action.impactAt && !released) {
      released = true;
      action.resolved = true;
      if (action.skillId === "vanish") invisibleUntil = now + 3000;
      if (action.skillId === "shadow_step")
        hero.teleport({
          x: hero.state.x + action.direction.x * 2.5,
          y: hero.state.y,
          z: hero.state.z + action.direction.z * 2.5,
        });
      if (action.skillId === "shadow_dance") {
        const origin = { x: hero.state.x, z: hero.state.z };
        const positions = [
          { x: origin.x + 1.8, z: origin.z },
          { x: origin.x + 1.8, z: origin.z + 1.8 },
          { x: origin.x, z: origin.z + 1.8 },
        ];
        const strikes = positions.map((landing, index) => ({
          targetId: `witness-target-${index}`,
          from: positions[index - 1] ?? origin,
          targetPosition: { x: landing.x + 0.5, z: landing.z + 0.5 },
          landing,
          impactAt: action
            ? action.impactAt + index * ROGUE_BALANCE.shadowDance.strikeIntervalMs
            : now,
          damage: 0,
          killed: false,
        }));
        const finalPosition = positions[2] ?? origin;
        danceUntil = action.impactAt + strikes.length * ROGUE_BALANCE.shadowDance.strikeIntervalMs;
        const sequence: RogueShadowDanceSequence = {
          t: "rogue.shadow_dance",
          actionId: action.id,
          actorId: "assassin-v2-witness",
          startedAt: action.impactAt,
          endsAt: danceUntil,
          strikes,
          finalPosition,
        };
        renderer.playShadowDance(sequence);
        hero.teleport({ ...finalPosition, y: hero.state.y });
      }
    }
    const state = hero.state;
    const player: PlayerSnapshot = {
      id: "assassin-v2-witness",
      nick: "Assassin 2",
      hp,
      maxHp: 100,
      level: 1,
      x: state.x,
      y: state.y,
      z: state.z,
      vy: state.vy,
      airborne: state.airborne,
      swimming: state.swimming,
      gliding: state.gliding,
      facing: { ...hero.facing },
      class: "rogue",
      appearance: { body: "assassin_v2", primaryColor: "violet" },
      equipment: starterEquipmentFor("rogue"),
      life: dead ? "corpse" : "alive",
      action,
      ...(now < invisibleUntil ? { invisible: true } : {}),
    };
    const animation = tracker.sample(player, now, ASSASSIN_V2_MANIFEST.strideDistance, {
      coordinatedTransitions: true,
    });
    const companions: PlayerSnapshot[] = [
      {
        ...player,
        id: "reference-ranger",
        nick: "Ranger",
        x: player.x - 5,
        class: "ranger",
        appearance: { body: "ranger", primaryColor: "moss" },
        action: null,
        life: "alive",
      },
      {
        ...player,
        id: "reference-assassin",
        nick: "Assassin",
        x: player.x - 2.5,
        class: "rogue",
        appearance: { body: "assassin", primaryColor: "violet" },
        action,
        life: player.life,
      },
      {
        ...player,
        id: "reference-runic",
        nick: "Runic Guardian",
        x: player.x + 2.5,
        class: "warrior",
        appearance: { body: "runic_guardian", primaryColor: "azure" },
        action: null,
        life: "alive",
      },
    ];
    if (partySize > 1) {
      companions.length = 0;
      for (let index = 1; index < partySize; index++)
        companions.push({
          ...player,
          id: `assassin-party-${index}`,
          x: player.x + (index % 2 ? -2.5 : 2.5),
          z: player.z + (index === 3 ? 2.5 : 0),
          life: "alive",
        });
    } else if (!showReferences) companions.length = 0;
    renderer.playHeroMovement(events, player);
    renderer.render(
      {
        players: [player, ...companions],
        corpses: dead
          ? [player, ...companions.filter((companion) => companion.life === "corpse")]
          : [],
        monsters: [],
        guards: [],
        seaGuardians: [],
        projectiles: [],
        loot: [],
        events: [],
      },
      {
        self: player,
        now,
        quest: { chapter: "three_offerings", status: "available", progress: 0, target: 3 },
        grid: true,
        healthBars: "none",
      },
    );
    latest = {
      now,
      x: state.x,
      y: state.y,
      z: state.z,
      vy: state.vy,
      airborne: state.airborne,
      gliding: state.gliding,
      swimming: state.swimming,
      dead,
      action,
      animation,
      released,
      rate,
    };
    if (now - lastCaption > 100) {
      caption.textContent = `ASSASSIN 2 · SHIPPED HD-2D RENDERER\nWASD move · Space jump / glider · 1–5 skills · H hit · K death · R reset\nT auto eight directions · N water · arrows orbit · P pause · [ ] speed\n${animation.motion} · phase ${animation.phase.toFixed(3)} · ${animation.speed.toFixed(3)} tiles/s · ${rate.toFixed(2)}×\n${partySize > 1 ? `${partySize} Assassins 2` : "Ranger · Assassin · Assassin V2 · Runic Guardian"} · normal game camera`;
      lastCaption = now;
    }
  };
  renderer.onFrame((_frameNow, frameDt) => frame(frameDt));
  window.addEventListener(
    "pagehide",
    () => {
      renderer.destroy();
      releaseStageCanvas();
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup);
    },
    { once: true },
  );
}
