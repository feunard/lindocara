import {
  type AdventureAudioConfig,
  ambienceTrack,
  DEFAULT_ADVENTURE_AUDIO,
  MUSIC_PROFILE_FIELDS,
} from "@lindocara/engine/audio-catalog.js";
import type { PlayerClass } from "@lindocara/engine/game.js";
import type { HeroEvent } from "@lindocara/engine/hd2d/hero-state.js";
import type { MonsterImpactSound } from "@lindocara/renderer/combat-art.js";
import { getAudioSettings, subscribeAudioSettings } from "./audio-settings.js";
import {
  COMBAT_SAMPLES,
  type CombatSampleKey,
  castSampleForSkill,
  impactSampleForClass,
  monsterImpactSample,
  type SampleSpec,
  UI_SAMPLES,
  type UiSampleKey,
  uniqueSampleSources,
} from "./combat-sounds.js";
import { DynamicMusicPlayer } from "./dynamic-music.js";
import {
  type MovementSoundCue,
  movementSkidIntensity,
  movementSoundCue,
} from "./movement-sounds.js";

const MUSIC_BASE = 0.32;
const AMBIENCE_BASE = 0.1;
const SEA_GUARDIAN_AMBIENCE_BASE = 0.26;
const SEA_GUARDIAN_NEAR = "/assets/lindocara/audio/sfx/sea-guardian-near.wav";
const SEA_GUARDIAN_DEVOUR = "/assets/lindocara/audio/sfx/sea-guardian-devour.wav";
const CHARGE_IMPACT_WINDOW_MS = 900;
const COMBAT_MUSIC_HOLD_MS = 8_000;
const COMBAT_THREAT_RELEASE_MS = 500;
const SHEEP_BLEATS = [1, 2, 3, 4].map((index) => `/assets/lindocara/sfx/bleat-${index}.ogg`);
const SHEEP_POPS = [1, 2, 3].map((index) => `/assets/lindocara/sfx/pop-${index}.ogg`);
const CHEST_OPEN = [1, 2].map((index) => `/assets/lindocara/sfx/chest-${index}.ogg`);
const CHEST_CLOSE = [1, 2].map((index) => `/assets/lindocara/sfx/chest-close-${index}.ogg`);

type SceneAudioInput = Pick<AdventureAudioConfig, "music" | "ambience" | "combatMusic"> &
  Partial<AdventureAudioConfig>;

function normalizeSceneAudio(audio: SceneAudioInput): AdventureAudioConfig {
  if (MUSIC_PROFILE_FIELDS.some((field) => Object.hasOwn(audio, field))) {
    return { ...DEFAULT_ADVENTURE_AUDIO, ...audio };
  }
  // A welcome from a pre-profile server only has the original three fields. Preserve that exact
  // soundtrack instead of allowing newly introduced defaults to shadow its authored tracks.
  return {
    ...DEFAULT_ADVENTURE_AUDIO,
    ...audio,
    explorationProfile: null,
    nightProfile: null,
    discoveryProfile: null,
    dangerProfile: null,
    combatProfile: null,
    bossProfile: null,
  };
}

function sameSceneAudio(left: AdventureAudioConfig, right: AdventureAudioConfig): boolean {
  return (
    left.music === right.music &&
    left.ambience === right.ambience &&
    left.combatMusic === right.combatMusic &&
    MUSIC_PROFILE_FIELDS.every((field) => left[field] === right[field])
  );
}

function stableHash(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

export class GameSound {
  #context: AudioContext | null = null;
  #ambience: HTMLAudioElement | null = null;
  #seaGuardianAmbience: HTMLAudioElement | null = null;
  #seaGuardianNearby = false;
  #ambienceSrc: string | null = null;
  #scene: AdventureAudioConfig = { ...DEFAULT_ADVENTURE_AUDIO };
  readonly #music: DynamicMusicPlayer;
  #combatUntil = 0;
  #discoveryUntil = 0;
  #combatThreatened = false;
  #bossThreatened = false;
  #combatThreatReleaseAt = 0;
  #nightWeight = 0;
  #unlocked = false;
  #visibilityBound = false;
  #settingsBound = false;
  #buffers = new Map<string, AudioBuffer>();
  #sampleLoad: Promise<void> | null = null;
  #lastCast: { skillId: string; at: number } | null = null;
  #movementTake = 0;
  #skidIntensity = 0;
  #skidSource: AudioBufferSourceNode | null = null;
  #skidGain: GainNode | null = null;

  constructor() {
    this.#music = new DynamicMusicPlayer(
      this.#scene,
      () => {
        const { muted, ambientVolume, musicEnabled } = getAudioSettings();
        return muted || !musicEnabled ? 0 : MUSIC_BASE * ambientVolume;
      },
      () => {
        const { muted, musicEnabled } = getAudioSettings();
        return (
          this.#unlocked &&
          (typeof document === "undefined" || !document.hidden) &&
          !muted &&
          musicEnabled
        );
      },
    );
  }

  unlock(): void {
    if (!this.#context) this.#context = new AudioContext();
    if (this.#context.state === "suspended") void this.#context.resume();
    this.#unlocked = true;
    this.#bindVisibility();
    this.#bindSettings();
    this.#music.start();
    this.#syncSceneAudio();
    void this.#loadSamples();
  }

  configureScene(audio: SceneAudioInput = DEFAULT_ADVENTURE_AUDIO): void {
    const nextScene = normalizeSceneAudio(audio);
    if (sameSceneAudio(this.#scene, nextScene)) return;
    this.#scene = nextScene;
    this.#combatUntil = 0;
    this.#discoveryUntil = 0;
    this.#combatThreatened = false;
    this.#bossThreatened = false;
    this.#combatThreatReleaseAt = 0;
    this.#music.configure(nextScene);
    this.#refreshDynamicMusic(performance.now());
    this.#syncSceneAudio();
  }

  combatPulse(): void {
    const now = performance.now();
    this.#combatUntil = now + COMBAT_MUSIC_HOLD_MS;
    this.#refreshDynamicMusic(now);
  }

  discoveryPulse(durationMs = 6_000): void {
    const now = performance.now();
    this.#discoveryUntil = now + Math.max(0, durationMs);
    this.#refreshDynamicMusic(now);
  }

  /**
   * Installs the latest server-authored aggro state for this player. Losing the last threat clears
   * any activity hold left by previous hits after a short confirmation window. That window absorbs
   * one missing/delayed snapshot without hiding a real end of combat.
   */
  setCombatThreatened(threatened: boolean, boss = false): void {
    if (threatened === this.#combatThreatened && boss === this.#bossThreatened) return;
    const wasThreatened = this.#combatThreatened;
    this.#combatThreatened = threatened;
    this.#bossThreatened = threatened && boss;
    const now = performance.now();
    if (threatened) this.#combatThreatReleaseAt = 0;
    else if (wasThreatened) {
      this.#combatUntil = 0;
      this.#combatThreatReleaseAt = now + COMBAT_THREAT_RELEASE_MS;
    }
    this.#refreshDynamicMusic(now);
  }

  setNightWeight(weight: number): void {
    const next = Math.max(0, Math.min(1, weight));
    if (next === this.#nightWeight) return;
    this.#nightWeight = next;
    this.#refreshDynamicMusic(performance.now());
  }

  update(now = performance.now()): void {
    if (this.#combatThreatReleaseAt !== 0 && now >= this.#combatThreatReleaseAt) {
      this.#combatThreatReleaseAt = 0;
    }
    if (this.#combatUntil !== 0 && now >= this.#combatUntil) {
      this.#combatUntil = 0;
    }
    if (this.#discoveryUntil !== 0 && now >= this.#discoveryUntil) this.#discoveryUntil = 0;
    this.#refreshDynamicMusic(now);
    this.#music.update(now);
  }

  /** Executes the decorative consequences narrated by the pure movement rule. */
  movement(events: readonly HeroEvent[]): void {
    for (const event of events) {
      const cue = movementSoundCue(event, this.#movementTake);
      if (cue) {
        this.#movementTake += 1;
        this.#playMovementCue(cue);
      }
    }
    this.#setSkidIntensity(movementSkidIntensity(events));
  }

  /** The warning exists only while this hero is swimming within 100 gameplay metres. */
  setSeaGuardianNearby(nearby: boolean): void {
    if (nearby === this.#seaGuardianNearby) return;
    this.#seaGuardianNearby = nearby;
    if (nearby && !this.#seaGuardianAmbience) {
      this.#seaGuardianAmbience = this.#createLoop(SEA_GUARDIAN_NEAR);
    }
    this.#syncVolumes();
    this.#syncPlayback();
  }

  seaGuardianDevour(): void {
    void this.#playSpec({ src: SEA_GUARDIAN_DEVOUR, volume: 1 });
  }

  stopAmbient(): void {
    this.#music.stop();
    this.#stopElement(this.#ambience);
    this.#stopElement(this.#seaGuardianAmbience);
    this.#ambience = null;
    this.#seaGuardianAmbience = null;
    this.#seaGuardianNearby = false;
    this.#ambienceSrc = null;
    this.#combatUntil = 0;
    this.#discoveryUntil = 0;
    this.#combatThreatened = false;
    this.#bossThreatened = false;
    this.#combatThreatReleaseAt = 0;
    this.#nightWeight = 0;
    this.#skidSource?.stop();
    this.#skidSource?.disconnect();
    this.#skidGain?.disconnect();
    this.#skidSource = null;
    this.#skidGain = null;
    this.#skidIntensity = 0;
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

  monsterSpecialImpact(kind: MonsterImpactSound): void {
    void this.#playKey(monsterImpactSample(kind));
  }

  sheepBleat(eventId: string, hit: number): void {
    const hash = stableHash(eventId);
    const src = SHEEP_BLEATS[hash % SHEEP_BLEATS.length];
    if (!src) return;
    const ownPitch = ((hash >>> 8) % 700) / 100 - 3.5;
    void this.#playSpec({
      src,
      volume: 0.5,
      playbackRate: 2 ** ((ownPitch + hit * 1.5) / 12),
    });
  }

  sheepExplosion(eventId: string): void {
    const src = SHEEP_POPS[stableHash(eventId) % SHEEP_POPS.length];
    if (src) void this.#playSpec({ src, volume: 0.7 });
  }

  chest(open: boolean): void {
    const variants = open ? CHEST_OPEN : CHEST_CLOSE;
    const src = variants[Math.floor(Math.random() * variants.length)];
    if (src) void this.#playSpec({ src, volume: 0.9 });
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
    this.#music.start();
    this.#syncAmbience();
    this.#syncVolumes();
    this.#syncPlayback();
  }

  #refreshDynamicMusic(now: number): void {
    const danger = this.#combatThreatened || this.#combatThreatReleaseAt > now;
    this.#music.setState(
      {
        nightWeight: this.#nightWeight,
        discovery: this.#discoveryUntil > now,
        danger,
        combat: this.#combatUntil > now,
        boss: danger && this.#bossThreatened,
      },
      now,
    );
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
    const { muted, ambientVolume } = getAudioSettings();
    this.#music.sync();
    if (this.#ambience) {
      this.#ambience.volume = muted ? 0 : AMBIENCE_BASE * ambientVolume;
    }
    if (this.#seaGuardianAmbience) {
      this.#seaGuardianAmbience.volume = muted ? 0 : SEA_GUARDIAN_AMBIENCE_BASE * ambientVolume;
    }
    this.#syncSkidVolume();
  }

  #syncPlayback(): void {
    const { muted } = getAudioSettings();
    const canPlay = this.#unlocked && !document.hidden && !muted;
    this.#music.sync();
    if (this.#ambience) {
      if (canPlay) {
        if (this.#ambience.paused) void this.#ambience.play().catch(() => undefined);
      } else this.#ambience.pause();
    }
    if (this.#seaGuardianAmbience) {
      if (canPlay && this.#seaGuardianNearby) {
        if (this.#seaGuardianAmbience.paused)
          void this.#seaGuardianAmbience.play().catch(() => undefined);
      } else this.#seaGuardianAmbience.pause();
    }
    this.#syncSkidVolume();
  }

  #playMovementCue(cue: MovementSoundCue): void {
    const { muted, sfxVolume } = getAudioSettings();
    const context = this.#context;
    if (muted || context?.state !== "running") return;
    const now = context.currentTime;
    const gain = context.createGain();
    gain.gain.setValueAtTime(Math.max(0.0001, cue.volume * sfxVolume), now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + cue.duration);
    gain.connect(context.destination);

    if (cue.kind === "tone") {
      const source = context.createOscillator();
      source.type = "triangle";
      source.frequency.setValueAtTime(cue.frequency, now);
      source.frequency.exponentialRampToValueAtTime(cue.endFrequency, now + cue.duration);
      source.connect(gain);
      source.start(now);
      source.stop(now + cue.duration);
      return;
    }

    const source = context.createBufferSource();
    source.buffer = this.#noiseBuffer(context, cue.duration);
    const filter = context.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = cue.frequency;
    filter.Q.value = cue.q;
    source.connect(filter);
    filter.connect(gain);
    source.start(now);
  }

  #noiseBuffer(context: AudioContext, duration: number): AudioBuffer {
    const frames = Math.max(1, Math.ceil(context.sampleRate * duration));
    const buffer = context.createBuffer(1, frames, context.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < channel.length; i += 1) channel[i] = Math.random() * 2 - 1;
    return buffer;
  }

  #setSkidIntensity(intensity: number): void {
    this.#skidIntensity = intensity;
    const context = this.#context;
    if (intensity > 0 && context?.state === "running" && !this.#skidSource) {
      const source = context.createBufferSource();
      source.buffer = this.#noiseBuffer(context, 0.35);
      source.loop = true;
      const filter = context.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = 1_600;
      filter.Q.value = 1.4;
      const gain = context.createGain();
      gain.gain.value = 0;
      source.connect(filter);
      filter.connect(gain);
      gain.connect(context.destination);
      source.start();
      this.#skidSource = source;
      this.#skidGain = gain;
    }
    this.#syncSkidVolume();
  }

  #syncSkidVolume(): void {
    const context = this.#context;
    const gain = this.#skidGain;
    if (!context || !gain) return;
    const { muted, sfxVolume } = getAudioSettings();
    const audible = this.#unlocked && !document.hidden && !muted;
    const target = audible ? this.#skidIntensity * sfxVolume * 0.035 : 0;
    gain.gain.setTargetAtTime(target, context.currentTime, 0.025);
  }

  async #loadSamples(): Promise<void> {
    if (this.#sampleLoad) return this.#sampleLoad;
    const context = this.#context;
    if (!context) return;
    this.#sampleLoad = Promise.allSettled(
      [
        ...new Set([
          ...uniqueSampleSources(),
          ...SHEEP_BLEATS,
          ...SHEEP_POPS,
          ...CHEST_OPEN,
          ...CHEST_CLOSE,
          SEA_GUARDIAN_DEVOUR,
        ]),
      ].map(async (src) => {
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
