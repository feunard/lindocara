/**
 * The authored sound-effect catalogue: the cues an adventure's own events may name.
 *
 * Same shape and same reasoning as `audio-catalog.ts` next door - ids, families and public URLs
 * live in the platform-free engine so the editor, the server's command parser and the browser agree
 * on the only values that may be persisted or sent over the wire, while the files themselves are
 * served by the client package from `public/assets/lindocara/`.
 *
 * **Ids are the contract, files are not.** An authored page stores `playSound: "chest"`, never a
 * path, so a cue can be re-recorded, re-levelled or moved without touching a single stored map.
 * That is also why the entries below are ids the game already had: the effects are shipped, mixed
 * and proven, and the only thing that was missing was an authored way to reach them.
 *
 * The `volume` is the same per-sample gain the combat/UI banks carry (`client/game/combat-sounds.ts`
 * is where those numbers were tuned), applied before the player's own effects slider. Authored cues
 * sit a little louder than combat ones on purpose: an author reaches for a sound because they want
 * it noticed.
 */

/** What a cue is FOR, so an editor can group a picker instead of showing a flat list of ids. */
export const SOUND_EFFECT_FAMILIES = ["voice", "impact", "item", "world", "magic", "ui"] as const;

export type SoundEffectFamily = (typeof SOUND_EFFECT_FAMILIES)[number];

export interface SoundEffectDefinition {
  readonly id: string;
  readonly family: SoundEffectFamily;
  /** Public URL, served by the client package. */
  readonly src: string;
  /** Per-sample gain before the player's effects slider. */
  readonly volume: number;
}

const SFX = "/assets/lindocara/audio/sfx";
const LEGACY = "/assets/lindocara/sfx";

export const SOUND_EFFECTS: readonly SoundEffectDefinition[] = [
  // Voice and body: what happens to a person.
  { id: "hurt", family: "voice", src: `${SFX}/authored-hurt.ogg`, volume: 0.3 },
  { id: "cheer", family: "voice", src: `${SFX}/authored-cheer.ogg`, volume: 0.3 },
  { id: "death", family: "voice", src: `${SFX}/ui-death.ogg`, volume: 0.28 },
  { id: "battle_cry", family: "voice", src: `${SFX}/warrior-battle-cry.ogg`, volume: 0.26 },
  { id: "bleat", family: "voice", src: `${LEGACY}/bleat-1.ogg`, volume: 0.3 },

  // Impacts: something hits something.
  { id: "hit", family: "impact", src: `${SFX}/ui-hit.ogg`, volume: 0.26 },
  { id: "heavy_blow", family: "impact", src: `${SFX}/warrior-charge-impact.ogg`, volume: 0.28 },
  { id: "blade", family: "impact", src: `${SFX}/warrior-cleave.ogg`, volume: 0.26 },
  { id: "arrow", family: "impact", src: `${SFX}/ranger-quick-shot.ogg`, volume: 0.26 },
  { id: "explosion", family: "impact", src: `${SFX}/peasant-homemade-bomb.wav`, volume: 0.26 },

  // Items and money.
  { id: "chest", family: "item", src: `${LEGACY}/chest-1.ogg`, volume: 0.3 },
  { id: "chest_close", family: "item", src: `${LEGACY}/chest-close-1.ogg`, volume: 0.3 },
  { id: "coins", family: "item", src: `${SFX}/harvest-gold.wav`, volume: 0.28 },
  { id: "loot", family: "item", src: `${SFX}/ui-loot.ogg`, volume: 0.28 },
  { id: "potion", family: "item", src: `${SFX}/consumable-health-potion.wav`, volume: 0.26 },

  // The world itself.
  { id: "door", family: "world", src: `${SFX}/ui-interact.ogg`, volume: 0.28 },
  { id: "wood", family: "world", src: `${SFX}/harvest-wood.wav`, volume: 0.28 },
  { id: "stone", family: "world", src: `${SFX}/harvest-stone.wav`, volume: 0.28 },
  { id: "pop", family: "world", src: `${LEGACY}/pop-1.ogg`, volume: 0.3 },

  // Magic and the uncanny.
  { id: "spell", family: "magic", src: `${SFX}/priest-radiant-bolt.wav`, volume: 0.26 },
  { id: "heal", family: "magic", src: `${SFX}/priest-heal.ogg`, volume: 0.26 },
  { id: "blink", family: "magic", src: `${SFX}/priest-blink.ogg`, volume: 0.26 },
  { id: "nova", family: "magic", src: `${SFX}/priest-nova.ogg`, volume: 0.26 },

  // Framing a beat, rather than an object making a noise.
  { id: "fanfare", family: "ui", src: `${SFX}/ui-level-up.ogg`, volume: 0.3 },
  { id: "confirm", family: "ui", src: `${SFX}/ui-confirm.ogg`, volume: 0.26 },
  { id: "refuse", family: "ui", src: `${SFX}/ui-back.ogg`, volume: 0.26 },
] as const;

const BY_ID = new Map(SOUND_EFFECTS.map((effect) => [effect.id, effect]));

/** Every id an authored `playSound` may carry, in catalogue order. */
export const SOUND_EFFECT_IDS: readonly string[] = SOUND_EFFECTS.map((effect) => effect.id);

/**
 * Whether a value names a shipped cue. The command parser gates on this, which is what makes an id
 * a contract: a page can never be stored asking for a sound that does not exist, and a cue can
 * never be deleted without this refusing every map that named it.
 */
export function isSoundEffectId(value: unknown): value is string {
  return typeof value === "string" && BY_ID.has(value);
}

export function soundEffect(id: string): SoundEffectDefinition | undefined {
  return BY_ID.get(id);
}
