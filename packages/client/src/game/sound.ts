import { movementSampleKeys, SKID_LOOP_END_SECONDS, skidLoopUrl } from "@lindocara/audio/assets.js";
import { createSampleBank, type SampleBank } from "@lindocara/audio/bank.js";
import type { HeldLoop } from "@lindocara/audio/held-loop.js";
import { SKID_MAX_GAIN } from "@lindocara/audio/movement.js";
import {
  type AdventureAudioConfig,
  ambienceTrack,
  DEFAULT_ADVENTURE_AUDIO,
  MUSIC_PROFILE_FIELDS,
} from "@lindocara/engine/audio-catalog.js";
import type { ConsumableId } from "@lindocara/engine/consumables.js";
import type { PlayerClass } from "@lindocara/engine/game.js";
import type { HarvestResourceKind } from "@lindocara/engine/harvest.js";
import type { HeroEvent } from "@lindocara/engine/hd2d/hero-state.js";
import type { MonsterImpactSound } from "@lindocara/renderer/combat-art.js";
import { getAudioSettings, subscribeAudioSettings } from "./audio-settings.js";
import {
  COMBAT_SAMPLES,
  type CombatSampleKey,
  castSampleForSkill,
  consumeSample,
  impactSampleForClass,
  monsterImpactSample,
  type SampleSpec,
  UI_SAMPLES,
  type UiSampleKey,
  uniqueSampleSources,
} from "./combat-sounds.js";
import { DynamicMusicPlayer } from "./dynamic-music.js";
import { movementSkidIntensity, movementSoundCue } from "./movement-sounds.js";

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
  /** The recorded movement bank, shared with the lab. Opened on unlock, with the context. */
  #movement: SampleBank | null = null;
  #movementLoad: Promise<void> | null = null;
  #skidIntensity = 0;
  #skid: HeldLoop | null = null;

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
    void this.#loadMovement();
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

  /**
   * Executes the decorative consequences narrated by the pure movement rule.
   *
   * Silent until the bank has decoded — which is a few hundred milliseconds after the first
   * gesture, and deliberately not awaited: a hero must start walking on the frame the player
   * pressed a key, not on the frame the footsteps finished downloading.
   */
  movement(events: readonly HeroEvent[]): void {
    const bank = this.#movement;
    if (bank) {
      const { muted, sfxVolume } = getAudioSettings();
      if (!muted) {
        for (const event of events) {
          const cue = movementSoundCue(event);
          if (cue) bank.play(cue.key, { gain: cue.gain * sfxVolume });
        }
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
    this.#skid?.stop();
    this.#skid = null;
    this.#skidIntensity = 0;
    this.#unlocked = false;
  }

  skillCast(skillId: string, peasantResource?: HarvestResourceKind): void {
    this.#lastCast = { skillId, at: performance.now() };
    const key = castSampleForSkill(skillId, peasantResource);
    if (key) void this.#playKey(key);
  }

  consume(item: ConsumableId): void {
    void this.#playKey(consumeSample(item));
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

  /**
   * The movement bank, opened once per context.
   *
   * Separate from `#loadSamples` (the combat/UI specs) on purpose: those are one url per key with
   * an authored level, this is a set of interchangeable takes per key, and the two are decoded into
   * different structures. Sharing a loader would mean flattening the takes back into single urls,
   * which is the variety this whole migration exists to restore.
   */
  async #loadMovement(): Promise<void> {
    if (this.#movementLoad) {
      // Already decoded, but `stopAmbient` disposed the skid loop on the way out of the last map.
      // Re-opening it here rather than only on the first load is the difference between a skid that
      // works for one map and a skid that works for the session — and nothing would have failed.
      this.#openSkid();
      return this.#movementLoad;
    }
    const context = this.#context;
    if (!context) return;
    const bank = createSampleBank({ context });
    for (const [key, urls] of Object.entries(movementSampleKeys())) bank.define(key, urls);
    this.#movement = bank;
    this.#movementLoad = bank.load([...bank.sources(), skidLoopUrl()]).then(() => {
      this.#openSkid();
    });
    return this.#movementLoad;
  }

  /** The skid is a HELD loop, opened once and then driven by gain — never re-triggered per frame. */
  #openSkid(): void {
    if (this.#skid || !this.#movement) return;
    this.#skid =
      this.#movement.loop(skidLoopUrl(), {
        loopEnd: SKID_LOOP_END_SECONDS,
      }) ?? null;
    this.#syncSkidVolume();
  }

  #setSkidIntensity(intensity: number): void {
    this.#skidIntensity = intensity;
    this.#syncSkidVolume();
  }

  #syncSkidVolume(): void {
    const skid = this.#skid;
    if (!skid) return;
    const { muted, sfxVolume } = getAudioSettings();
    const audible = this.#unlocked && !document.hidden && !muted;
    skid.setGain(audible ? this.#skidIntensity * sfxVolume * SKID_MAX_GAIN : 0, 0.025);
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
