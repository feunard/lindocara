/**
 * Audio for the launch menus, kept entirely separate from the in-game `GameSound` (which only
 * exists while a session is running). Two things live here:
 *   - a one-shot confirm sample played when the title screen hands off to the main menu, and
 *   - a looping music bed that plays while the player is anywhere in the launch menu.
 *
 * The bed is a recorded track (`MUSIC_SRC`) played through a looping `HTMLAudioElement`, faded in
 * and out so entering/leaving the menu never clicks. It replaces the earlier Web-Audio synth piano.
 * To swap the piece, drop another mp3 in `public/assets/lindocara/audio/` and point `MUSIC_SRC` at
 * it — `menu_2.mp3` (a second take of the same caption) already ships beside the default.
 *
 * The confirm sample still runs through a small AudioContext (created/resumed inside the real
 * title-screen gesture, so autoplay policy is satisfied). The music element only calls `play()`
 * after that same gesture, so it is allowed to start.
 *
 * No React in here — components call the singleton (`menuAudio`) the same way they call `session`.
 */
import { getAudioSettings, subscribeAudioSettings } from "./audio-settings.js";

// The menu UI SFX, generated in-house with the studio sfx lane — prompts, seeds and mastering
// are recorded in audio/CREDITS.md (they replaced the CC-BY leohpaz set). Each is a one-shot
// sample played through the AudioContext, gated by mute + the sfx slider (not the music toggle).
/** The title→menu confirm and menu-item select. */
const CONFIRM_SRC = "/assets/lindocara/audio/sfx/ui-confirm.ogg";
/** Backing out of a menu (Escape / B / the Back item). */
const BACK_SRC = "/assets/lindocara/audio/sfx/ui-back.ogg";
/** Pre-slider gains, before the sfx slider scales them. There is deliberately NO cursor-move
 *  sound: a per-step sample pool was tried and removed — it read as noise, not feedback. */
const CONFIRM_VOLUME = 0.8;
const BACK_VOLUME = 0.6;

/** The looping menu bed. Generated in-house (see audio/CREDITS.md). Swap this to change it. */
const MUSIC_SRC = "/assets/lindocara/audio/menu_1.mp3";
/** Pre-slider ceiling for the bed; the ambient slider scales it down from here. */
const MUSIC_BASE = 0.5;
/** Fade length when the bed starts or stops, in milliseconds. */
const MUSIC_FADE_MS = 600;

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** `HTMLMediaElement.play()` returns a Promise in every real browser, but jsdom's stub (no
 *  `HTMLMediaElement` implementation) returns `undefined` — calling `.catch` straight off it then
 *  throws instead of rejecting. `Promise.resolve` normalizes both shapes so a component that
 *  starts the bed under jsdom (an app-shell test navigating into the launch menu, say) degrades
 *  silently instead of crashing the render. */
function safePlay(el: HTMLMediaElement): void {
  void Promise.resolve(el.play()).catch(() => undefined);
}

class MenuAudio {
  #ctx: AudioContext | null = null;
  /** Decoded one-shot samples, keyed by src; and the in-flight loads, so each decodes once. */
  #buffers = new Map<string, AudioBuffer>();
  #loads = new Map<string, Promise<void>>();
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
        if (this.#music) safePlay(this.#music);
      }
    });
  }

  /** Target element volume given the settings and whether the bed is meant to be playing. */
  #targetVolume(): number {
    const { muted, ambientVolume, musicEnabled } = getAudioSettings();
    return muted || !musicEnabled || !this.#musicOn ? 0 : clamp01(MUSIC_BASE * ambientVolume);
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

  /** The title→menu hand-off / menu-item select. Resumes audio inside the title gesture. */
  playConfirm(): void {
    this.#playSample(CONFIRM_SRC, CONFIRM_VOLUME);
  }

  /** Backing out of a menu. */
  playBack(): void {
    this.#playSample(BACK_SRC, BACK_VOLUME);
  }

  /** Play a one-shot sample, gated by mute + the sfx slider. Safe to call repeatedly. */
  #playSample(src: string, volume: number): void {
    const ctx = this.#ensureContext();
    if (!ctx) return;
    if (ctx.state === "suspended") void ctx.resume();
    const { muted, sfxVolume } = getAudioSettings();
    if (muted) return;
    void this.#loadSample(src).then(() => {
      const buffer = this.#buffers.get(src);
      if (!buffer || ctx.state !== "running") return;
      const source = ctx.createBufferSource();
      const gain = ctx.createGain();
      source.buffer = buffer;
      gain.gain.value = volume * sfxVolume;
      source.connect(gain);
      gain.connect(ctx.destination);
      source.start();
    });
  }

  async #loadSample(src: string): Promise<void> {
    if (this.#buffers.has(src)) return;
    const inFlight = this.#loads.get(src);
    if (inFlight) return inFlight;
    const ctx = this.#ctx;
    if (!ctx) return;
    const load = (async () => {
      const response = await fetch(src);
      if (!response.ok) return;
      this.#buffers.set(src, await ctx.decodeAudioData(await response.arrayBuffer()));
    })().catch(() => undefined);
    this.#loads.set(src, load);
    return load;
  }

  /** Begin the looping bed, fading it in. Idempotent; call on entering any launch-menu screen. */
  startMusic(): void {
    if (this.#musicOn) return;
    const el = this.#ensureMusic();
    if (!el) return;
    this.#musicOn = true;
    safePlay(el);
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
