/**
 * Une zone est une région nommée qui porte son ambiance : nappe sonore, piste de musique et taux
 * de souffle. Pur — pas de `three`, pas de DOM, pas d'horloge — comme `locomotion.ts` et
 * `terrain-query.ts` : c'est un module de RÈGLES, pas de rendu ni de son. `main.ts` lit `zoneAt`
 * à chaque image et câble le résultat vers `core/audio.ts` (la nappe, la musique) et le héros (le
 * souffle) ; ce module ne connaît ni l'un ni l'autre.
 */
export interface Zone {
  nom: string;
  /** Centre `[x, z]`, dans les mêmes unités monde que le terrain. */
  centre: readonly [number, number];
  /** `Infinity` pour la zone par défaut : elle couvre alors tout point qu'aucune autre n'a pris. */
  rayon: number;
  /** Clef de piste dans `MUSIQUE` (`core/audio.ts`), ou `null` tant qu'aucune n'est déclarée —
   *  cette task câble la NAPPE, pas la musique (Task 5 générera la piste et fera obéir le choix à
   *  la zone). */
  musique: string | null;
  /** Clef de nappe d'ambiance passée telle quelle à `setAmbience` (`core/audio.ts`). */
  nappe: string;
  /** Multiplicateur de la consommation de souffle du héros — 1 = normal, 2 = deux fois plus vite
   *  (Task 7, l'eau polaire). Une seule notion explique la musique, le vent et la noyade plus
   *  rapide (voir le spec, section « Les zones »). */
  souffle: number;
}

/**
 * La zone qui contient `(x, z)`, ou la première dont le point est HORS de portée d'aucune des
 * précédentes. Parcourt la liste dans l'ORDRE et rend la première zone à portée : ça évite
 * d'inventer un champ de priorité — l'ordre EST la priorité. Rend TOUJOURS une zone : un appelant
 * obligé de tester la nullité à chaque image finit par oublier une fois, donc la zone par défaut
 * (rayon infini) doit être la DERNIÈRE de la liste appelante pour agir de filet.
 */
export function zoneAt(zones: readonly Zone[], x: number, z: number): Zone {
  for (const zone of zones) {
    const [cx, cz] = zone.centre;
    const dx = x - cx;
    const dz = z - cz;
    // Comparaison au carré : pas de racine à chaque appel, et `rayon: Infinity` reste correct
    // puisque `Infinity ** 2` vaut toujours `Infinity`.
    if (dx * dx + dz * dz <= zone.rayon * zone.rayon) return zone;
  }
  // N'est atteint que si l'appelant a omis la zone par défaut — un bug de configuration, pas un
  // cas normal. On ne peut renvoyer `undefined` (la signature l'interdit), donc on force l'échec
  // au lieu de mentir avec une zone inventée.
  throw new Error(
    "zoneAt: aucune zone ne couvre ce point — la liste doit finir par une zone à rayon Infinity",
  );
}
