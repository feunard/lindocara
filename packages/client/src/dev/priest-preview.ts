/** DEV witness: shipped controller, animation clock, billboard registry, camera and lighting. */
import { starterEquipmentFor } from "@lindocara/engine/character.js";
import { PLAYER_ACTIONS } from "@lindocara/engine/combat-actions.js";
import { CLASS_STATS } from "@lindocara/engine/game.js";
import type { MapData } from "@lindocara/engine/hd2d/map-data.js";
import type { CombatActionSnapshot, PlayerSnapshot } from "@lindocara/engine/protocol.js";
import { zoneTerrainFromHeightfield } from "@lindocara/engine/terrain-access.js";
import { CharacterAnimationTracker } from "@lindocara/renderer/character-animation.js";
import { Hd2dRenderer } from "@lindocara/renderer/hd2d/game-renderer.js";
import { PRIEST_MANIFEST } from "@lindocara/renderer/priest-art.js";
import { ServerClock } from "@lindocara/renderer/server-clock.js";

import { createHeroController } from "../game/hero-controller.js";
import { acquireStageCanvas, releaseStageCanvas } from "../game/stage-canvas.js";

export async function startPriestPreview(): Promise<void> {
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
    speed: CLASS_STATS.priest.movementSpeed,
  });
  const clock = new ServerClock();
  clock.sample(0, 0);
  const renderer = await Hd2dRenderer.create(canvas, clock);
  renderer.configureMapTerrain("priest-witness", [], 1, map);
  renderer.setSelfId("priest-witness");
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
  const cast = (slot: number, heldMs = 0, aim?: { x: number; z: number }): void => {
    const definition = PLAYER_ACTIONS.priest[slot - 1];
    if (!definition || dead) return;
    actionSerial++;
    action = {
      id: `witness-action-${actionSerial}`,
      kind: "skill",
      skillId: definition.skillId,
      direction: aim ?? { ...hero.facing },
      startedAt: now,
      impactAt: now + definition.anticipationMs,
      recoveryEndsAt: now + definition.anticipationMs + heldMs + definition.recoveryMs,
      resolved: false,
      ...(definition.skillId === "blink"
        ? { channelEndsAt: now + definition.anticipationMs + heldMs }
        : {}),
    };
  };
  const reset = (): void => {
    hero.teleport({ x: 0, y: 0, z: 0 });
    dead = false;
    hp = 100;
    action = null;
  };
  const keydown = (event: KeyboardEvent): void => {
    keys.add(event.code);
    if (["KeyW", "KeyA", "KeyS", "KeyD"].includes(event.code)) auto = false;
    if (event.repeat) return;
    if (/Digit[1-5]/.test(event.code))
      cast(Number(event.code.slice(-1)), event.code === "Digit3" ? 1_000 : 0);
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
    step: (seconds = 1 / 60) => {
      paused = false;
      for (let remaining = seconds; remaining > 0.000001; remaining -= 1 / 60)
        frame(Math.min(1 / 60, remaining));
      paused = true;
    },
  };
  Object.assign(window, { priestPreview: api });
  const frame = (frameDt: number): void => {
    const dt = paused ? 0 : Math.min(0.05, Math.max(0, frameDt)) * rate;
    now += dt * 1_000;
    let x = Number(keys.has("KeyD")) - Number(keys.has("KeyA"));
    let z = Number(keys.has("KeyS")) - Number(keys.has("KeyW"));
    const angle = heading ?? (auto ? ((Math.floor(now / 1_500) % 8) * Math.PI) / 4 : null);
    if (angle !== null) {
      x = Math.sin(angle);
      z = Math.cos(angle);
    }
    if (dead) {
      x = 0;
      z = 0;
    }
    const events = hero.step({ x, z, jump: !dead && (forcedJump || keys.has("Space")) }, dt);
    forcedJump = false;
    if (keys.has("ArrowLeft")) renderer.rotateCamera(-dt);
    if (keys.has("ArrowRight")) renderer.rotateCamera(dt);
    if (action && now >= action.recoveryEndsAt) action = null;
    const state = hero.state;
    const player: PlayerSnapshot = {
      id: "priest-witness",
      nick: "Dawn Priest",
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
      class: "priest",
      appearance: { body: "priest", primaryColor: "azure" },
      equipment: starterEquipmentFor("priest"),
      life: dead ? "corpse" : "alive",
      action,
    };
    const animation = tracker.sample(player, now, PRIEST_MANIFEST.strideDistance);
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
        action: null,
        life: "alive",
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
          id: `priest-party-${index}`,
          x: player.x + (index % 2 ? -2.5 : 2.5),
          z: player.z + (index === 3 ? 2.5 : 0),
          life: "alive",
        });
    }
    renderer.playHeroMovement(events, player);
    renderer.render(
      {
        players: [player, ...companions],
        corpses: dead ? [player] : [],
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
      rate,
      rig: renderer.priestAnimationStats(),
    };
    if (now - lastCaption > 100) {
      caption.textContent = `PRIEST · SHIPPED HD-2D RENDERER\nWASD move · Space jump / glider · 1–5 skills · H hit · K death · R reset\nT auto eight directions · N water · arrows orbit · P pause · [ ] speed\n${animation.motion} · phase ${animation.phase.toFixed(3)} · ${animation.speed.toFixed(3)} tiles/s · ${rate.toFixed(2)}×\n${partySize > 1 ? `${partySize} Priests` : "Ranger · Assassin · Priest · Runic Guardian"} · normal game camera`;
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
