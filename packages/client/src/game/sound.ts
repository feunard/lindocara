import type { PlayerClass } from "@lindocara/engine/game.js";
import { getAudioSettings, subscribeAudioSettings } from "./audio-settings.js";
import {
  COMBAT_SAMPLES,
  type CombatSampleKey,
  castSampleForSkill,
  impactSampleForClass,
  type SampleSpec,
  UI_SAMPLES,
  type UiSampleKey,
  uniqueSampleSources,
} from "./combat-sounds.js";

const AMBIENT_SRC = "/assets/lindocara/audio/gloamwood-ambience.mp3";
const AMBIENT_BASE = 0.1;
const CHARGE_IMPACT_WINDOW_MS = 900;

export class GameSound {
  #context: AudioContext | null = null;
  #ambient: HTMLAudioElement | null = null;
  #ambientPlaying = false;
  #visibilityBound = false;
  #settingsBound = false;
  #buffers = new Map<string, AudioBuffer>();
  #sampleLoad: Promise<void> | null = null;
  #lastCast: { skillId: string; at: number } | null = null;

  unlock(): void {
    if (!this.#context) this.#context = new AudioContext();
    if (this.#context.state === "suspended") void this.#context.resume();
    this.#bindVisibility();
    this.#bindSettings();
    void this.#startAmbient();
    void this.#loadSamples();
  }

  stopAmbient(): void {
    const ambient = this.#ambient;
    if (!ambient) return;
    ambient.pause();
    ambient.currentTime = 0;
    this.#ambientPlaying = false;
  }

  skillCast(skillId: string): void {
    this.#lastCast = { skillId, at: performance.now() };
    const key = castSampleForSkill(skillId);
    if (key) void this.#playKey(key);
  }

  combatImpact(playerClass: PlayerClass): void {
    const recentCharge =
      playerClass === "warrior" &&
      this.#lastCast?.skillId === "shield_bash" &&
      performance.now() - this.#lastCast.at <= CHARGE_IMPACT_WINDOW_MS;
    if (recentCharge) {
      void this.#playKey("warrior.charge_impact");
      return;
    }
    void this.#playKey(impactSampleForClass(playerClass));
  }

  healReceived(): void {
    void this.#playKey("priest.heal_received");
  }

  monsterAttack(): void {
    void this.#playKey("monster.attack");
  }

  #bindVisibility(): void {
    if (this.#visibilityBound) return;
    this.#visibilityBound = true;
    document.addEventListener("visibilitychange", () => {
      const ambient = this.#ambient;
      if (!ambient || !this.#ambientPlaying) return;
      if (document.hidden || getAudioSettings().muted) ambient.pause();
      else void ambient.play().catch(() => undefined);
    });
  }

  #bindSettings(): void {
    if (this.#settingsBound) return;
    this.#settingsBound = true;
    subscribeAudioSettings(() => this.#syncAmbientVolume());
  }

  #syncAmbientVolume(): void {
    const ambient = this.#ambient;
    if (!ambient) return;
    const { muted, ambientVolume } = getAudioSettings();
    ambient.volume = muted ? 0 : AMBIENT_BASE * ambientVolume;
    if (muted && this.#ambientPlaying) ambient.pause();
    else if (!muted && this.#ambientPlaying && !document.hidden) {
      void ambient.play().catch(() => undefined);
    }
  }

  async #startAmbient(): Promise<void> {
    if (this.#ambientPlaying) return;
    if (!this.#ambient) {
      this.#ambient = new Audio(AMBIENT_SRC);
      this.#ambient.loop = true;
      this.#ambient.preload = "auto";
    }
    this.#syncAmbientVolume();
    const { muted } = getAudioSettings();
    if (muted) return;
    try {
      await this.#ambient.play();
      this.#ambientPlaying = true;
    } catch {
      // Still blocked — the next gesture will call unlock() again.
    }
  }

  async #loadSamples(): Promise<void> {
    if (this.#sampleLoad) return this.#sampleLoad;
    const context = this.#context;
    if (!context) return;
    this.#sampleLoad = Promise.allSettled(
      uniqueSampleSources().map(async (src) => {
        if (this.#buffers.has(src)) return;
        const response = await fetch(src);
        if (!response.ok) throw new Error(`missing combat sfx: ${src}`);
        const data = await response.arrayBuffer();
        try {
          this.#buffers.set(src, await context.decodeAudioData(data));
        } catch {
          if (import.meta.env.DEV) console.warn(`[sound] failed to decode: ${src}`);
        }
      }),
    ).then(() => undefined);
    return this.#sampleLoad;
  }

  async #playKey(key: CombatSampleKey): Promise<void> {
    await this.#playSpec(COMBAT_SAMPLES[key]);
  }

  async #playUi(key: UiSampleKey): Promise<void> {
    await this.#playSpec(UI_SAMPLES[key]);
  }

  async #playSpec(spec: SampleSpec): Promise<void> {
    const { muted, sfxVolume } = getAudioSettings();
    if (muted) return;
    await this.#loadSamples();
    const context = this.#context;
    const buffer = this.#buffers.get(spec.src);
    if (context?.state !== "running" || !buffer) return;
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    source.playbackRate.value = spec.playbackRate ?? 1;
    gain.gain.value = spec.volume * sfxVolume;
    source.connect(gain);
    gain.connect(context.destination);
    source.start();
  }

  hit(): void {
    void this.#playUi("hit");
  }

  loot(): void {
    void this.#playUi("loot");
  }

  levelUp(): void {
    void this.#playUi("levelUp");
  }

  interact(): void {
    void this.#playUi("interact");
  }

  death(): void {
    void this.#playUi("death");
  }

  chat(): void {
    void this.#playUi("chat");
  }
}
