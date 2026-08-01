import type { EventCode, MonsterSnapshot } from "@lindocara/engine/protocol.js";
import type { Connection } from "./net.js";

type AttackConnection = Pick<Connection, "attack">;
type CombatThreat = Pick<MonsterSnapshot, "dead" | "threatening">;

export interface SessionCombatSound {
  combatPulse(): void;
  setCombatThreatened(threatened: boolean): void;
}

/**
 * The testable boundary between session inputs/server facts and combat music. An attack intent is
 * deliberately audio-neutral: only authoritative threat or a confirmed combat event may pulse the
 * fight track.
 */
export class SessionCombatAudio {
  readonly #sound: SessionCombatSound;
  readonly #connection: () => AttackConnection | null;

  constructor(sound: SessionCombatSound, connection: () => AttackConnection | null) {
    this.#sound = sound;
    this.#connection = connection;
  }

  attack(): void {
    this.#connection()?.attack();
  }

  setServerThreat(monsters: readonly CombatThreat[]): void {
    this.#sound.setCombatThreatened(
      monsters.some((monster) => monster.threatening === true && !monster.dead),
    );
  }

  confirmedEvent(code: EventCode): void {
    if (code === "combat.hit" || code === "combat.hurt") this.#sound.combatPulse();
  }
}
