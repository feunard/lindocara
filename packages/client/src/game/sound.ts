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
const COMBAT_THREAT_RELEASE_MS = 500;
const MUSIC_CROSSFADE_MS = 650;

interface MusicFade {
  startedAt: number;
  explorationFrom: number;
  combatFrom: number;
  explorationTo: number;
  combatTo: number;
}

export class GameSound {
  #context: AudioContext | null = null;
  #explorationMusic: HTMLAudioElement | null = null;
  #combatMusic: HTMLAudioElement | null = null;
  #ambience: HTMLAudioElement | null = null;
  #explorationMusicSrc: string | null = null;
  #combatMusicSrc: string | null = null;
  #ambienceSrc: string | null = null;
  #scene: AdventureAudioConfig = { ...DEFAULT_ADVENTURE_AUDIO };
  #combatUntil = 0;
  #combatThreatened = false;
  #combatThreatReleaseAt = 0;
  #combatActive = false;
  #explorationWeight = 1;
  #combatWeight = 0;
  #musicFade: MusicFade | null = null;
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
    this.#combatThreatened = false;
    this.#combatThreatReleaseAt = 0;
    this.#combatActive = false;
    this.#explorationWeight = 1;
    this.#combatWeight = 0;
    this.#musicFade = null;
    this.#syncSceneAudio();
  }

  combatPulse(): void {
    if (this.#scene.combatMusic === null) return;
    const now = performance.now();
    this.#combatUntil = now + COMBAT_MUSIC_HOLD_MS;
    this.#refreshCombatMusic(now);
  }

  /**
   * Installs the latest server-authored aggro state for this player. Losing the last threat clears
   * any activity hold left by previous hits after a short confirmation window. That window absorbs
   * one missing/delayed snapshot without hiding a real end of combat.
   */
  setCombatThreatened(threatened: boolean): void {
    if (threatened === this.#combatThreatened) return;
    const wasThreatened = this.#combatThreatened;
    this.#combatThreatened = threatened;
    const now = performance.now();
    if (threatened) this.#combatThreatReleaseAt = 0;
    else if (wasThreatened) {
      this.#combatUntil = 0;
      this.#combatThreatReleaseAt = now + COMBAT_THREAT_RELEASE_MS;
    }
    this.#refreshCombatMusic(now);
  }

  update(now = performance.now()): void {
    if (this.#combatThreatReleaseAt !== 0 && now >= this.#combatThreatReleaseAt) {
      this.#combatThreatReleaseAt = 0;
    }
    if (this.#combatUntil !== 0 && now >= this.#combatUntil) {
      this.#combatUntil = 0;
    }
    this.#refreshCombatMusic(now);
    this.#applyMusicFade(now);
  }

  stopAmbient(): void {
    this.#stopElement(this.#explorationMusic);
    this.#stopElement(this.#combatMusic);
    this.#stopElement(this.#ambience);
    this.#explorationMusic = null;
    this.#combatMusic = null;
    this.#ambience = null;
    this.#explorationMusicSrc = null;
    this.#combatMusicSrc = null;
    this.#ambienceSrc = null;
    this.#combatUntil = 0;
    this.#combatThreatened = false;
    this.#combatThreatReleaseAt = 0;
    this.#combatActive = false;
    this.#explorationWeight = 1;
    this.#combatWeight = 0;
    this.#musicFade = null;
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
    const explorationSrc = musicTrack(this.#scene.music)?.src ?? null;
    if (explorationSrc !== this.#explorationMusicSrc) {
      this.#stopElement(this.#explorationMusic);
      this.#explorationMusic = this.#createLoop(explorationSrc);
      this.#explorationMusicSrc = explorationSrc;
    }
    const combatSrc = musicTrack(this.#scene.combatMusic)?.src ?? null;
    if (combatSrc !== this.#combatMusicSrc) {
      this.#stopElement(this.#combatMusic);
      this.#combatMusic = null;
      this.#combatMusicSrc = combatSrc;
    } else if (this.#combatMusic) {
      this.#combatMusic.pause();
      this.#combatMusic.currentTime = 0;
    }
    this.#syncVolumes();
    this.#syncPlayback();
  }

  #refreshCombatMusic(now: number): void {
    const shouldFight =
      this.#combatMusicSrc !== null &&
      (this.#combatThreatened || this.#combatThreatReleaseAt > now || this.#combatUntil > now);
    if (shouldFight === this.#combatActive) return;
    this.#applyMusicFade(now);
    this.#combatActive = shouldFight;
    if (shouldFight && !this.#combatMusic)
      this.#combatMusic = this.#createLoop(this.#combatMusicSrc);
    this.#musicFade = {
      startedAt: now,
      explorationFrom: this.#explorationWeight,
      combatFrom: this.#combatWeight,
      explorationTo: shouldFight ? 0 : 1,
      combatTo: shouldFight ? 1 : 0,
    };
    this.#syncPlayback();
    this.#applyMusicFade(now);
  }

  #applyMusicFade(now: number): void {
    const fade = this.#musicFade;
    if (!fade) return;
    const progress = Math.max(0, Math.min(1, (now - fade.startedAt) / MUSIC_CROSSFADE_MS));
    this.#explorationWeight =
      fade.explorationFrom + (fade.explorationTo - fade.explorationFrom) * progress;
    this.#combatWeight = fade.combatFrom + (fade.combatTo - fade.combatFrom) * progress;
    this.#syncVolumes();
    if (progress < 1) return;
    this.#musicFade = null;
    if (this.#explorationWeight === 0) this.#explorationMusic?.pause();
    if (this.#combatWeight === 0 && this.#combatMusic) {
      this.#combatMusic.pause();
      this.#combatMusic.currentTime = 0;
    }
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
    const musicVolume = muted || !musicEnabled ? 0 : MUSIC_BASE * ambientVolume;
    if (this.#explorationMusic) {
      this.#explorationMusic.volume = musicVolume * this.#explorationWeight;
    }
    if (this.#combatMusic) {
      this.#combatMusic.volume = musicVolume * this.#combatWeight;
    }
    if (this.#ambience) {
      this.#ambience.volume = muted ? 0 : AMBIENCE_BASE * ambientVolume;
    }
  }

  #syncPlayback(): void {
    const { muted, musicEnabled } = getAudioSettings();
    const canPlay = this.#unlocked && !document.hidden && !muted;
    const explorationNeeded =
      this.#explorationWeight > 0 || (this.#musicFade?.explorationTo ?? 0) > 0;
    const combatNeeded = this.#combatWeight > 0 || (this.#musicFade?.combatTo ?? 0) > 0;
    if (this.#explorationMusic) {
      if (canPlay && musicEnabled && explorationNeeded)
        void this.#explorationMusic.play().catch(() => undefined);
      else this.#explorationMusic.pause();
    }
    if (this.#combatMusic) {
      if (canPlay && musicEnabled && combatNeeded)
        void this.#combatMusic.play().catch(() => undefined);
      else this.#combatMusic.pause();
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
