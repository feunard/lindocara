import * as THREE from "three";

/**
 * Une ambiance (jour, nuit, ...) : toutes les valeurs qui décrivent l'atmosphère de la scène —
 * lumières, brouillard, couleurs de l'eau, bloom, étalonnage. Les couleurs sont des chaînes
 * `#rrggbb` plutôt que des `THREE.Color` précisément pour que le mélange se fasse dans l'espace
 * couleur : un entier hexadécimal s'interpole composante par composante n'importe comment
 * (0xffffff vers 0x000000 passerait par du vert), un `THREE.Color` sait le faire proprement.
 *
 * Le catalogue des ambiances (jour/nuit/...) reste au labo — c'est du contenu, pas du moteur.
 */
export interface MoodConfig {
  exposure: number;
  sky: { top: string; horizon: string; glow: string; glowStrength: number; stars: number };
  fog: { near: number; far: number };
  sun: { color: string; intensity: number; position: readonly [number, number, number] };
  rim: { color: string; intensity: number; position: readonly [number, number, number] };
  hemi: { sky: string; ground: string; intensity: number };
  fire: number;
  clouds: number;
  water: { shallow: string; deep: string; sparkle: number };
  motes: number;
  fireflies: number;
  bloom: { strength: number; threshold: number };
  grade: { saturation: number; lift: number };
  /** Intensité d'aurore boréale, 0..1 — un canal de plus, comme `sky.stars` : le moteur mélange le
   *  nombre et l'envoie à un shader, il ne sait pas ce qu'il représente. Vaut 0 dans toute ambiance
   *  qui n'en a pas besoin ; c'est au contenu (pas à `hd2d`) de l'allumer là où ça a un sens. */
  aurora: number;
  /** Amplitude du pulse de brouillard, 0..1 — resserre périodiquement `fog.far` par rafales. Même
   *  logique que `aurora` : un canal générique, jamais lu ici pour ce qu'il représente. */
  fogPulse: number;
}

/** `MoodConfig`, une fois préparée : les couleurs y sont des `THREE.Color`, prêtes à être mélangées
 *  et copiées directement dans les matériaux/lumières de la scène. */
export type ResolvedMood = {
  exposure: number;
  sky: {
    top: THREE.Color;
    horizon: THREE.Color;
    glow: THREE.Color;
    glowStrength: number;
    stars: number;
  };
  fog: { near: number; far: number };
  sun: { color: THREE.Color; intensity: number; position: [number, number, number] };
  rim: { color: THREE.Color; intensity: number; position: [number, number, number] };
  hemi: { sky: THREE.Color; ground: THREE.Color; intensity: number };
  fire: number;
  clouds: number;
  water: { shallow: THREE.Color; deep: THREE.Color; sparkle: number };
  motes: number;
  fireflies: number;
  bloom: { strength: number; threshold: number };
  grade: { saturation: number; lift: number };
  aurora: number;
  fogPulse: number;
};

const estCouleur = (v: unknown): v is string => typeof v === "string" && v[0] === "#";

/** Copie récursive : chaîne `#rrggbb` -> `THREE.Color`, tableau -> tableau, objet -> objet, le
 *  reste (nombre) tel quel. Aucune valeur d'un `MoodConfig` fourni n'est aliasée : mélanger deux
 *  ambiances ne doit jamais muter le catalogue d'origine. */
function prepare(v: unknown): unknown {
  if (estCouleur(v)) return new THREE.Color(v);
  if (Array.isArray(v)) return v.slice();
  if (v && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(v)) o[k] = prepare((v as Record<string, unknown>)[k]);
    return o;
  }
  return v;
}

/** Écrit dans `out` le mélange de `a` et `b`. Aucune allocation par frame : `out` porte déjà la
 *  bonne forme (préparée une fois à la construction du mélangeur). */
function mix(
  out: Record<string, unknown>,
  a: Record<string, unknown>,
  b: Record<string, unknown>,
  t: number,
): void {
  for (const k of Object.keys(a)) {
    const va = a[k];
    const vb = b[k];
    if (va instanceof THREE.Color) (out[k] as THREE.Color).copy(va).lerp(vb as THREE.Color, t);
    else if (Array.isArray(va)) {
      const vo = out[k] as number[];
      const vbArr = vb as number[];
      for (let i = 0; i < va.length; i++) {
        const from = va[i] ?? 0;
        const to = vbArr[i] ?? 0;
        vo[i] = from + (to - from) * t;
      }
    } else if (va && typeof va === "object")
      mix(
        out[k] as Record<string, unknown>,
        va as Record<string, unknown>,
        vb as Record<string, unknown>,
        t,
      );
    else out[k] = (va as number) + ((vb as number) - (va as number)) * t;
  }
}

/** Le mélangeur d'ambiances : lu à chaque frame pour `value`, avancé avec `update(dt)`. */
export interface MoodMixer<K extends string> {
  /** L'ambiance visée — celle qu'affiche le HUD, pas forcément celle actuellement affichée. */
  readonly name: K;
  /** Les valeurs mélangées, à lire à chaque frame. */
  readonly value: ResolvedMood;
  goTo(name: K): void;
  /** Avance le fondu de `dt` secondes. Renvoie `true` tant que l'ambiance bouge encore, `false`
   *  une fois arrivée : `main.js` ne repousse l'ambiance dans le reste de la scène (`pushMood`)
   *  que quand ça bouge, pour ne pas refaire ce travail à chaque frame une fois stabilisé. */
  update(dt: number): boolean;
}

/** Continuous two-mood blend for clocks and weather systems that provide their own weight. */
export interface MoodBlend {
  readonly value: ResolvedMood;
  set(weight: number): void;
}

export function createMoodBlend(from: MoodConfig, to: MoodConfig): MoodBlend {
  const preparedFrom = prepare(from) as ResolvedMood;
  const preparedTo = prepare(to) as ResolvedMood;
  const current = prepare(from) as ResolvedMood;
  return {
    value: current,
    set(weight) {
      mix(
        current as unknown as Record<string, unknown>,
        preparedFrom as unknown as Record<string, unknown>,
        preparedTo as unknown as Record<string, unknown>,
        Math.max(0, Math.min(1, weight)),
      );
    },
  };
}

/**
 * Mélangeur d'ambiances. Le basculement jour <-> nuit était sec dans le PoC ; il dure désormais
 * `fadeSeconds` secondes, et TOUT ce que décrit une ambiance est interpolé — couleurs comprises.
 *
 * `moods` et `fadeSeconds` arrivent en argument plutôt que d'un import de config : le catalogue
 * d'ambiances (jour/nuit/...) est du contenu de labo, pas du moteur.
 */
// `M` s'infère du littéral `moods` (donc capte VRAIMENT toutes ses clés) ; `K` est ensuite dérivé de
// `M` avec `keyof M & string`, jamais un second paramètre de type inféré indépendamment. Deux
// paramètres de type inférés chacun de leur côté (`K extends string` sur `start: K`) auraient ancré
// `K` sur le seul argument `start` — `createMoodMixer({ day, night }, "day", …)` aurait alors typé
// `K` comme le littéral `"day"`, et `goTo("night")` aurait été un rejet du compilateur.
export function createMoodMixer<M extends Record<string, MoodConfig>>(
  moods: M,
  start: keyof M & string,
  fadeSeconds: number,
): MoodMixer<keyof M & string> {
  type K = keyof M & string;
  const prepared = {} as Record<K, ResolvedMood>;
  for (const nom of Object.keys(moods) as K[]) prepared[nom] = prepare(moods[nom]) as ResolvedMood;

  // `depuis` est un instantané de l'état COURANT, pas de l'ambiance de départ : rebasculer en
  // pleine transition doit repartir d'où l'on en est, sans à-coup. Un aller-retour rapide sauterait
  // sinon d'un bout à l'autre du fondu.
  const depuis = prepare(moods[start]) as Record<string, unknown>;
  const courant = prepare(moods[start]) as ResolvedMood;
  let vers = start;
  let t = 1;

  return {
    get name() {
      return vers;
    },
    get value() {
      return courant;
    },
    goTo(nom) {
      if (nom === vers || !prepared[nom]) return;
      mix(
        depuis,
        courant as unknown as Record<string, unknown>,
        courant as unknown as Record<string, unknown>,
        0,
      ); // instantané de l'état courant
      vers = nom;
      t = 0;
    },
    update(dt) {
      if (t >= 1) return false;
      t = Math.min(1, t + dt / fadeSeconds);
      // Lissage en S : le basculement démarre et finit en douceur.
      const s = t * t * (3 - 2 * t);
      mix(
        courant as unknown as Record<string, unknown>,
        depuis,
        prepared[vers] as unknown as Record<string, unknown>,
        s,
      );
      return true;
    },
  };
}
