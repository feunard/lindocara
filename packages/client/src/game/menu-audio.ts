/**
 * Audio for the launch menus, kept entirely separate from the in-game `GameSound` (which only
 * exists while a session is running). Two things live here:
 *   - a one-shot confirm sample played when the title screen hands off to the main menu, and
 *   - a looping music bed that plays while the player is anywhere in the launch menu.
 *
 * The bed is a recorded track (`MUSIC_SRC`) played through a looping `HTMLAudioElement`, faded in
 * and out so entering/leaving the menu never clicks. It replaces the earlier Web-Audio synth piano.
 * To swap the piece, drop another mp3 in `public/assets/lindocara/audio/` and point `MUSIC_SRC` at
 * it — `title-theme-epic.mp3` (an epic orchestral alternative) already ships beside the default.
 *
 * The confirm sample still runs through a small AudioContext (created/resumed inside the real
 * title-screen gesture, so autoplay policy is satisfied). The music element only calls `play()`
 * after that same gesture, so it is allowed to start.
 *
 * No React in here — components call the singleton (`menuAudio`) the same way they call `session`.
 */
import { getAudioSettings, subscribeAudioSettings } from "./audio-settings.js";

/** The title→menu confirm: a clean bell DING with a reverb tail, hit on the first sample. */
const CONFIRM_SRC = "/assets/lindocara/audio/sfx/title-ding.ogg";
/** Pre-slider gain for the confirm — this is the hand-off into the game. */
const CONFIRM_VOLUME = 0.7;

/** The looping menu bed. CC0. Swap this to change the title music. */
const MUSIC_SRC = "/assets/lindocara/audio/title-theme.mp3";
/** Pre-slider ceiling for the bed; the ambient slider scales it down from here. */
const MUSIC_BASE = 0.5;
/** Fade length when the bed starts or stops, in milliseconds. */
const MUSIC_FADE_MS = 600;

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

class MenuAudio {
  #ctx: AudioContext | null = null;
  #confirmBuffer: AudioBuffer | null = null;
  #confirmLoad: Promise<void> | null = null;
  #music: HTMLAudioElement | null = null;
  #musicOn = false;
  #fadeTimer: ReturnType<typeof setInterval> | null = null;
  #bound = false;

  #ensureContext(): AudioContext | null {
    if (this.#ctx) return this.#ctx;
    if (typeof AudioContext === "undefined") return null;
    this.#ctx = new AudioContext();
    this.#bind();
    return this.#ctx;
  }

  /** The looping bed element, created lazily. Null in a non-DOM (test) environment. */
  #ensureMusic(): HTMLAudioElement | null {
    if (this.#music) return this.#music;
    if (typeof Audio === "undefined") return null;
    const el = new Audio(MUSIC_SRC);
    el.loop = true;
    el.preload = "auto";
    el.volume = 0;
    this.#music = el;
    this.#bind();
    return el;
  }

  #bind(): void {
    if (this.#bound) return;
    this.#bound = true;
    subscribeAudioSettings(() => this.#syncMusicVolume());
    document.addEventListener("visibilitychange", () => {
      // A backgrounded tab goes silent and cheap; restore on return if the bed was playing.
      if (document.hidden) {
        this.#music?.pause();
        void this.#ctx?.suspend();
      } else if (this.#musicOn) {
        void this.#ctx?.resume();
        void this.#music?.play().catch(() => undefined);
      }
    });
  }

  /** Target element volume given the settings and whether the bed is meant to be playing. */
  #targetVolume(): number {
    const { muted, ambientVolume } = getAudioSettings();
    return muted || !this.#musicOn ? 0 : clamp01(MUSIC_BASE * ambientVolume);
  }

  /** Snap the bed to its target volume (used when the ambient slider or mute changes). */
  #syncMusicVolume(): void {
    if (!this.#music) return;
    this.#stopFade();
    this.#music.volume = this.#targetVolume();
  }

  /** Ramp the bed toward its target volume over `MUSIC_FADE_MS`. */
  #fadeToTarget(): void {
    const el = this.#music;
    if (!el) return;
    this.#stopFade();
    const target = this.#targetVolume();
    const stepMs = 40;
    const steps = Math.max(1, Math.round(MUSIC_FADE_MS / stepMs));
    const delta = (target - el.volume) / steps;
    let remaining = steps;
    this.#fadeTimer = setInterval(() => {
      remaining -= 1;
      el.volume = remaining <= 0 ? target : clamp01(el.volume + delta);
      if (remaining <= 0) {
        this.#stopFade();
        if (target === 0) el.pause();
      }
    }, stepMs);
  }

  #stopFade(): void {
    if (this.#fadeTimer !== null) {
      clearInterval(this.#fadeTimer);
      this.#fadeTimer = null;
    }
  }

  /** Resume audio inside a user gesture and play the menu confirm. Safe to call repeatedly. */
  playConfirm(): void {
    const ctx = this.#ensureContext();
    if (!ctx) return;
    if (ctx.state === "suspended") void ctx.resume();
    const { muted, sfxVolume } = getAudioSettings();
    if (muted) return;
    void this.#loadConfirm().then(() => {
      const buffer = this.#confirmBuffer;
      if (!buffer || ctx.state !== "running") return;
      const source = ctx.createBufferSource();
      const gain = ctx.createGain();
      source.buffer = buffer;
      gain.gain.value = CONFIRM_VOLUME * sfxVolume;
      source.connect(gain);
      gain.connect(ctx.destination);
      source.start();
    });
  }

  async #loadConfirm(): Promise<void> {
    if (this.#confirmBuffer) return;
    if (this.#confirmLoad) return this.#confirmLoad;
    const ctx = this.#ctx;
    if (!ctx) return;
    this.#confirmLoad = (async () => {
      const response = await fetch(CONFIRM_SRC);
      if (!response.ok) return;
      this.#confirmBuffer = await ctx.decodeAudioData(await response.arrayBuffer());
    })().catch(() => undefined);
    return this.#confirmLoad;
  }

  /** Begin the looping bed, fading it in. Idempotent; call on entering any launch-menu screen —
   *  including the title, where the first attempt is likely blocked by autoplay policy (no gesture
   *  yet). Retrying `play()` whenever the element is paused is what heals that: the attempt is
   *  harmless when it fails, and the next call after a real gesture (the title press) actually
   *  starts it, rather than the bed being stuck "on" but silent. */
  startMusic(): void {
    const el = this.#ensureMusic();
    if (!el) return;
    this.#musicOn = true;
    if (el.paused) void el.play().catch(() => undefined);
    this.#fadeToTarget();
  }

  /** Fade the bed out and pause it. Call on leaving the launch menu. */
  stopMusic(): void {
    if (!this.#musicOn) return;
    this.#musicOn = false;
    this.#fadeToTarget(); // ramps to 0, then pauses when the fade lands
  }
}

export const menuAudio = new MenuAudio();
