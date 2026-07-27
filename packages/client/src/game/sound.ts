import {
  type AdventureAudioConfig,
  ambienceTrack,
  DEFAULT_ADVENTURE_AUDIO,
  musicTrack,
} from "@lindocara/engine/audio-catalog.js";
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

const MUSIC_BASE = 0.32;
const AMBIENCE_BASE = 0.1;
const CHARGE_IMPACT_WINDOW_MS = 900;
const COMBAT_MUSIC_HOLD_MS = 8_000;

export class GameSound {
  #context: AudioContext | null = null;
  #music: HTMLAudioElement | null = null;
  #ambience: HTMLAudioElement | null = null;
  #musicSrc: string | null = null;
  #ambienceSrc: string | null = null;
  #scene: AdventureAudioConfig = { ...DEFAULT_ADVENTURE_AUDIO };
  #combatUntil = 0;
  #unlocked = false;
  #visibilityBound = false;
  #settingsBound = false;
  #buffers = new Map<string, AudioBuffer>();
  #sampleLoad: Promise<void> | null = null;
  #lastCast: { skillId: string; at: number } | null = null;

  unlock(): void {
    if (!this.#context) this.#context = new AudioContext();
    if (this.#context.state === "suspended") void this.#context.resume();
    this.#unlocked = true;
    this.#bindVisibility();
    this.#bindSettings();
    this.#syncSceneAudio();
    void this.#loadSamples();
  }

  configureScene(audio: AdventureAudioConfig = DEFAULT_ADVENTURE_AUDIO): void {
    this.#scene = { ...audio };
    this.#combatUntil = 0;
    this.#syncSceneAudio();
  }

  combatPulse(): void {
    if (this.#scene.combatMusic === null) return;
    const wasExploring = performance.now() >= this.#combatUntil;
    this.#combatUntil = performance.now() + COMBAT_MUSIC_HOLD_MS;
    if (wasExploring) this.#syncMusic();
  }

  update(now = performance.now()): void {
    if (this.#combatUntil !== 0 && now >= this.#combatUntil) {
      this.#combatUntil = 0;
      this.#syncMusic();
    }
  }

  stopAmbient(): void {
    this.#stopElement(this.#music);
    this.#stopElement(this.#ambience);
    this.#music = null;
    this.#ambience = null;
    this.#musicSrc = null;
    this.#ambienceSrc = null;
    this.#combatUntil = 0;
    this.#unlocked = false;
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
    document.addEventListener("visibilitychange", () => this.#syncPlayback());
  }

  #bindSettings(): void {
    if (this.#settingsBound) return;
    this.#settingsBound = true;
    subscribeAudioSettings(() => {
      this.#syncVolumes();
      this.#syncPlayback();
    });
  }

  #syncSceneAudio(): void {
    this.#syncMusic();
    this.#syncAmbience();
    this.#syncVolumes();
    this.#syncPlayback();
  }

  #syncMusic(): void {
    const combatActive = this.#combatUntil > performance.now();
    const id = combatActive ? this.#scene.combatMusic : this.#scene.music;
    const src = musicTrack(id)?.src ?? null;
    if (src === this.#musicSrc) return;
    this.#stopElement(this.#music);
    this.#music = this.#createLoop(src);
    this.#musicSrc = src;
    this.#syncVolumes();
    this.#syncPlayback();
  }

  #syncAmbience(): void {
    const src = ambienceTrack(this.#scene.ambience)?.src ?? null;
    if (src === this.#ambienceSrc) return;
    this.#stopElement(this.#ambience);
    this.#ambience = this.#createLoop(src);
    this.#ambienceSrc = src;
    this.#syncVolumes();
    this.#syncPlayback();
  }

  #createLoop(src: string | null): HTMLAudioElement | null {
    if (src === null || typeof Audio === "undefined") return null;
    const element = new Audio(src);
    element.loop = true;
    element.preload = "auto";
    return element;
  }

  #stopElement(element: HTMLAudioElement | null): void {
    if (!element) return;
    element.pause();
    element.currentTime = 0;
  }

  #syncVolumes(): void {
    const { muted, ambientVolume, musicEnabled } = getAudioSettings();
    if (this.#music) {
      this.#music.volume = muted || !musicEnabled ? 0 : MUSIC_BASE * ambientVolume;
    }
    if (this.#ambience) {
      this.#ambience.volume = muted ? 0 : AMBIENCE_BASE * ambientVolume;
    }
  }

  #syncPlayback(): void {
    const { muted, musicEnabled } = getAudioSettings();
    const canPlay = this.#unlocked && !document.hidden && !muted;
    if (this.#music) {
      if (canPlay && musicEnabled) void this.#music.play().catch(() => undefined);
      else this.#music.pause();
    }
    if (this.#ambience) {
      if (canPlay) void this.#ambience.play().catch(() => undefined);
      else this.#ambience.pause();
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
