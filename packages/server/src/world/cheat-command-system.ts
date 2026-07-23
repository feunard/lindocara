import { CHEAT_COMMAND_SYNTAX, type CheatCommand } from "@lindocara/engine/cheats.js";
import { normalizeConsumables } from "@lindocara/engine/consumables.js";
import { maxHpForLevel } from "@lindocara/engine/game.js";
import type { EventCode, EventParams, EventTone } from "@lindocara/engine/protocol.js";
import { normalizeTalentSelection } from "@lindocara/engine/talents.js";
import { cancelCombatAction } from "./combat-action-system.js";
import type { PlayerRuntime } from "./world-runtime.js";

export type CheatLifeTransition = "die" | "ghost" | "revive";

export interface CheatCommandResult {
  event: { code: EventCode; params?: EventParams; tone: EventTone };
  stateChanged: boolean;
  transition?: CheatLifeTransition;
  /** World applies it with terrain validation; the executor only relays the intent. */
  teleport?: { col: number; row: number };
}

function event(
  code: EventCode,
  tone: EventTone = "good",
  params?: EventParams,
): CheatCommandResult["event"] {
  return { code, tone, ...(params ? { params } : {}) };
}

function resetCooldowns(player: PlayerRuntime): void {
  cancelCombatAction(player);
  player.lastAttackAt = 0;
  player.lastHealAt = 0;
  player.skillCooldowns = [0, 0, 0, 0, 0];
  player.lastResurrectAt = 0;
  player.guardUntil = 0;
  player.guarding = false;
  player.guardActivatedAt = 0;
}

/** Mutates session state only; World remains responsible for life-state transitions and sends. */
export function executeCheatCommand(
  player: PlayerRuntime,
  command: CheatCommand,
): CheatCommandResult {
  if (command.kind === "help") {
    return {
      event: event("cheat.help", "info", { commands: CHEAT_COMMAND_SYNTAX }),
      stateChanged: false,
    };
  }
  if (command.kind === "unknown") {
    return { event: event("cheat.unknown", "bad"), stateChanged: false };
  }
  if (command.kind === "level") {
    player.level = command.level;
    player.xp = 0;
    player.hp = maxHpForLevel(command.level);
    player.talents = normalizeTalentSelection(player.class, command.level, player.talents);
    player.dirty = true;
    return {
      event: event("cheat.level", "good", { level: command.level }),
      stateChanged: true,
    };
  }
  if (command.kind === "nodead") {
    player.cheatInvulnerable = !player.cheatInvulnerable;
    return {
      event: event(player.cheatInvulnerable ? "cheat.nodead_on" : "cheat.nodead_off"),
      stateChanged: false,
    };
  }
  if (command.kind === "heal") {
    if (player.life !== "alive")
      return { event: event("cheat.alive_only", "bad"), stateChanged: false };
    player.hp = maxHpForLevel(player.level);
    player.dirty = true;
    return { event: event("cheat.heal"), stateChanged: true };
  }
  if (command.kind === "hurt") {
    if (player.life !== "alive")
      return { event: event("cheat.alive_only", "bad"), stateChanged: false };
    player.hp = 1;
    player.dirty = true;
    return { event: event("cheat.hurt", "info"), stateChanged: true };
  }
  if (command.kind === "resource") {
    if (!player.resource)
      return { event: event("cheat.resource_none", "info"), stateChanged: false };
    player.resource.current = player.resource.max;
    player.dirty = true;
    return { event: event("cheat.resource"), stateChanged: true };
  }
  if (command.kind === "reset_cooldowns") {
    resetCooldowns(player);
    player.dirty = true;
    return { event: event("cheat.cooldowns"), stateChanged: true };
  }
  if (command.kind === "loot") {
    const consumables = normalizeConsumables(
      player.inventory.consumables,
      player.inventory.potions,
    );
    consumables.health_potion += 10;
    player.inventory.consumables = consumables;
    player.inventory.potions = consumables.health_potion;
    player.inventory.gold += 1_000;
    player.inventory.crystals += 100;
    player.dirty = true;
    return {
      event: event("cheat.loot", "good", { potions: 10, gold: 1_000, crystals: 100 }),
      stateChanged: true,
    };
  }
  if (command.kind === "where") {
    return {
      event: event("cheat.where", "info", {
        map: player.zoneId,
        x: Math.round(player.x),
        y: Math.round(player.y),
      }),
      stateChanged: false,
    };
  }
  if (command.kind === "teleport") {
    return {
      event: event("cheat.tp", "info", { col: command.col, row: command.row }),
      stateChanged: true,
      teleport: { col: command.col, row: command.row },
    };
  }
  if (command.kind === "die") {
    if (player.life !== "alive")
      return { event: event("cheat.alive_only", "bad"), stateChanged: false };
    return { event: event("cheat.death", "info"), stateChanged: true, transition: "die" };
  }
  if (command.kind === "ghost") {
    if (player.life === "ghost")
      return { event: event("cheat.already_ghost", "info"), stateChanged: false };
    return { event: event("cheat.ghost", "info"), stateChanged: true, transition: "ghost" };
  }
  if (command.kind === "revive") {
    if (player.life === "alive")
      return { event: event("cheat.already_alive", "info"), stateChanged: false };
    return { event: event("cheat.revive"), stateChanged: true, transition: "revive" };
  }

  resetCooldowns(player);
  player.cheatInvulnerable = false;
  player.hp = maxHpForLevel(player.level);
  if (player.resource) player.resource.current = player.resource.max;
  player.dirty = true;
  return {
    event: event("cheat.reset"),
    stateChanged: true,
    ...(player.life === "alive" ? {} : { transition: "revive" as const }),
  };
}
