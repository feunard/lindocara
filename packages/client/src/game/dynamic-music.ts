import {
  type AdventureAudioConfig,
  type DynamicMusicState,
  type MusicSituation,
  musicTracksForSituation,
  musicTransitionMs,
  selectMusicSituation,
} from "@lindocara/engine/audio-catalog.js";

type PlaylistTrack = ReturnType<typeof musicTracksForSituation>[number];

interface MusicDeck {
  element: HTMLAudioElement;
  track: PlaylistTrack;
  situation: MusicSituation;
  weight: number;
}

interface DeckFade {
  startedAt: number;
  duration: number;
  fromIndex: number | null;
  fromWeight: number;
  toIndex: number | null;
  toWeight: number;
}

const DEFAULT_STATE: DynamicMusicState = {
  nightWeight: 0,
  discovery: false,
  danger: false,
  combat: false,
  boss: false,
};

function sameState(left: DynamicMusicState, right: DynamicMusicState): boolean {
  return (
    left.nightWeight === right.nightWeight &&
    left.discovery === right.discovery &&
    left.danger === right.danger &&
    left.combat === right.combat &&
    left.boss === right.boss
  );
}

function sceneKey(scene: AdventureAudioConfig): string {
  return [
    scene.music,
    scene.combatMusic,
    scene.explorationProfile,
    scene.nightProfile,
    scene.discoveryProfile,
    scene.dangerProfile,
    scene.combatProfile,
    scene.bossProfile,
  ].join("|");
}

/**
 * Two-deck music player. Every change and every generated-track seam uses one controlled
 * crossfade; a third incompatible track can never overlap. Generation metadata stays in the
 * studio while this class consumes only the typed runtime playlists.
 */
export class DynamicMusicPlayer {
  readonly #volume: () => number;
  readonly #canPlay: () => boolean;
  #scene: AdventureAudioConfig;
  #sceneKey: string;
  #state: DynamicMusicState = { ...DEFAULT_STATE };
  #situation: MusicSituation = "exploration";
  #decks: [MusicDeck | null, MusicDeck | null] = [null, null];
  #fade: DeckFade | null = null;
  #playlistCursor = new Map<string, number>();

  constructor(initialScene: AdventureAudioConfig, volume: () => number, canPlay: () => boolean) {
    this.#scene = { ...initialScene };
    this.#sceneKey = sceneKey(initialScene);
    this.#volume = volume;
    this.#canPlay = canPlay;
  }

  get activeSituation(): MusicSituation {
    return this.#situation;
  }

  configure(scene: AdventureAudioConfig, now = performance.now()): void {
    const nextKey = sceneKey(scene);
    if (nextKey === this.#sceneKey) return;
    this.#scene = { ...scene };
    this.#sceneKey = nextKey;
    this.#startSituation(selectMusicSituation(this.#state), now);
  }

  setState(state: DynamicMusicState, now = performance.now()): void {
    if (sameState(this.#state, state)) return;
    this.#state = { ...state };
    const next = selectMusicSituation(state);
    if (next !== this.#situation) this.#startSituation(next, now);
  }

  start(now = performance.now()): void {
    if (this.#decks.some(Boolean)) return;
    this.#startSituation(selectMusicSituation(this.#state), now);
  }

  update(now = performance.now()): void {
    this.#applyFade(now);
    if (this.#fade) return;
    const active = this.#loudestDeckIndex();
    if (active === null) return;
    const deck = this.#decks[active];
    if (!deck || deck.element.loop) return;
    const duration = deck.element.duration;
    if (!Number.isFinite(duration) || duration <= 0) return;
    const remainingMs = Math.max(0, duration - deck.element.currentTime) * 1000;
    const crossfadeMs = musicTransitionMs(this.#scene, this.#situation);
    if (remainingMs <= crossfadeMs) this.#startSituation(this.#situation, now);
  }

  sync(): void {
    const baseVolume = this.#volume();
    const canPlay = this.#canPlay();
    for (let index = 0; index < this.#decks.length; index += 1) {
      const deck = this.#decks[index];
      if (!deck) continue;
      deck.element.volume = Math.max(0, Math.min(1, baseVolume * deck.weight));
      const needed = deck.weight > 0 || this.#fade?.toIndex === index;
      if (canPlay && needed) {
        if (deck.element.paused) void deck.element.play().catch(() => undefined);
      } else deck.element.pause();
    }
  }

  stop(): void {
    this.#stopDeck(0);
    this.#stopDeck(1);
    this.#fade = null;
    this.#playlistCursor.clear();
    this.#state = { ...DEFAULT_STATE };
    this.#situation = "exploration";
  }

  #startSituation(situation: MusicSituation, now: number): void {
    this.#applyFade(now);
    const tracks = musicTracksForSituation(this.#scene, situation);
    const fromIndex = this.#loudestDeckIndex();
    const fromDeck = fromIndex === null ? null : this.#decks[fromIndex];
    if (
      fromDeck &&
      tracks.some((track) => track.id === fromDeck.track.id) &&
      situation !== this.#situation
    ) {
      fromDeck.situation = situation;
      this.#situation = situation;
      return;
    }
    const targetIndex = fromIndex === 0 ? 1 : 0;
    const cached = this.#decks[targetIndex];
    if (!(cached && tracks.some((track) => track.id === cached.track.id))) {
      this.#stopDeck(targetIndex);
      const track = this.#nextTrack(situation, tracks);
      if (track) {
        const deck = this.#createDeck(track, situation);
        if (deck) this.#decks[targetIndex] = deck;
      }
    } else {
      cached.situation = situation;
    }
    const targetDeck = this.#decks[targetIndex];
    this.#situation = situation;
    const duration = musicTransitionMs(this.#scene, situation);
    this.#fade = {
      startedAt: now,
      duration,
      fromIndex,
      fromWeight: fromDeck?.weight ?? 0,
      toIndex: targetDeck ? targetIndex : null,
      toWeight: targetDeck?.weight ?? 0,
    };
    if (duration === 0) this.#applyFade(now);
    this.sync();
  }

  #nextTrack(situation: MusicSituation, tracks: readonly PlaylistTrack[]): PlaylistTrack | null {
    if (tracks.length === 0) return null;
    const key = `${situation}:${tracks.map((track) => track.id).join(",")}`;
    const previous = this.#playlistCursor.get(key) ?? 0;
    const index = previous % tracks.length;
    this.#playlistCursor.set(key, index + 1);
    return tracks[index] ?? tracks[0] ?? null;
  }

  #createDeck(track: PlaylistTrack, situation: MusicSituation): MusicDeck | null {
    if (typeof Audio === "undefined") return null;
    const element = new Audio(track.src);
    element.loop = "loopable" in track ? Boolean(track.loopable) : false;
    element.preload = "auto";
    return { element, track, situation, weight: 0 };
  }

  #loudestDeckIndex(): 0 | 1 | null {
    const left = this.#decks[0];
    const right = this.#decks[1];
    if (!left) return right ? 1 : null;
    if (!right) return 0;
    return left.weight >= right.weight ? 0 : 1;
  }

  #applyFade(now: number): void {
    const fade = this.#fade;
    if (!fade) return;
    const progress =
      fade.duration === 0 ? 1 : Math.max(0, Math.min(1, (now - fade.startedAt) / fade.duration));
    if (fade.fromIndex !== null) {
      const deck = this.#decks[fade.fromIndex];
      if (deck) deck.weight = fade.fromWeight * (1 - progress);
    }
    if (fade.toIndex !== null) {
      const deck = this.#decks[fade.toIndex];
      if (deck) deck.weight = fade.toWeight + (1 - fade.toWeight) * progress;
    }
    this.sync();
    if (progress < 1) return;
    this.#fade = null;
    if (fade.fromIndex !== null && fade.fromIndex !== fade.toIndex) {
      const from = this.#decks[fade.fromIndex];
      const to = fade.toIndex === null ? null : this.#decks[fade.toIndex];
      const fromIsBase = from?.situation === "exploration" || from?.situation === "night";
      const toIsPriority =
        to?.situation === "danger" || to?.situation === "combat" || to?.situation === "boss";
      if (from && to) {
        from.weight = 0;
        from.element.pause();
        if (!(fromIsBase && toIsPriority)) from.element.currentTime = 0;
      } else this.#stopDeck(fade.fromIndex);
    }
  }

  #stopDeck(index: number): void {
    const deck = this.#decks[index];
    if (!deck) return;
    deck.element.pause();
    deck.element.currentTime = 0;
    this.#decks[index] = null;
  }
}
