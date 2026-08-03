/**
 * L'état de la glace fine, case par case. Pur — pas de `three`, pas de DOM, pas d'horloge, pas de
 * `Math.random` — comme `locomotion.ts` et `zones.ts` : c'est un module de RÈGLES, appelé à chaque
 * image par `hero.ts` avec un `dt` déjà mesuré, jamais une horloge à lui tout seul. Il suivra le
 * même chemin vers `@lindocara/engine` en S2 que les autres modules de `world/`.
 *
 * Trois temps, dans cet ordre et pas un autre : **intacte** → **craquelée** sous le poids (elle
 * prévient, on a le temps de partir) → **rompue** (on tombe). Une case relâchée avant la rupture
 * REGÈLE après un délai plutôt que de rester un trou définitif — dans un labo, réessayer est tout
 * ce qu'on y fait (voir le spec, section « La glace fine »).
 */
export type EtatGlace = "intacte" | "craquelee" | "rompue";

export interface ThinIceOptions {
  /** Charge cumulée (secondes de poids dessus) à partir de laquelle la case craque. */
  seuilCraquement: number;
  /** Charge cumulée à partir de laquelle la case cède. */
  seuilRupture: number;
  /** Délai, une fois relâchée, avant que la case regèle et oublie tout. */
  regel: number;
}

export interface ThinIce {
  /** Ajoute `dt` à la charge de la case `cle` (poids qui reste dessus) et rend son nouvel état.
   *  Annule tout regel en cours : remonter dessus avant qu'elle ait regelé reprend la craquelure
   *  où elle en était, elle ne repart pas de zéro. */
  charge(cle: string, dt: number): EtatGlace;
  /** Le poids quitte la case : elle ne charge plus, et le compte à rebours du regel démarre. Sans
   *  effet sur une case jamais chargée ou déjà en train de regeler. */
  relache(cle: string): void;
  /** Fait avancer le regel de toutes les cases relâchées de `dt`. Une case dont le délai s'épuise
   *  est PURGÉE de la table (voir `taille`) : elle redevient intacte en oubliant tout, pas en
   *  gardant une entrée à charge nulle. */
  update(dt: number): void;
  /** L'état de `cle` — "intacte" si elle n'a jamais été chargée, ou si elle a fini de regeler. */
  etat(cle: string): EtatGlace;
  /** Nombre de cases actuellement suivies (chargées, ou relâchées en attente de regel). Existe
   *  pour que le test puisse prouver la purge : sans lui, rien ne distingue une table qui se vide
   *  d'une table qui grossit sans borne au fil d'une session — le défaut exact qu'a eu le registre
   *  de billboards en S1. */
  taille(): number;
}

interface Case {
  /** Secondes de poids cumulées. Ne redescend jamais par petits pas : soit elle reste telle
   *  quelle (on remonte dessus avant regel), soit la case entière est purgée (regel terminé). */
  charge: number;
  /** `null` tant qu'on est dessus (ou qu'on vient d'y remonter) ; sinon le temps restant avant
   *  regel, décompté par `update`. */
  regelRestant: number | null;
}

function etatDe(c: Case, opts: ThinIceOptions): EtatGlace {
  if (c.charge >= opts.seuilRupture) return "rompue";
  if (c.charge >= opts.seuilCraquement) return "craquelee";
  return "intacte";
}

export function createThinIce(opts: ThinIceOptions): ThinIce {
  const cases = new Map<string, Case>();

  return {
    charge(cle, dt) {
      let c = cases.get(cle);
      if (!c) {
        c = { charge: 0, regelRestant: null };
        cases.set(cle, c);
      }
      c.charge += dt;
      // Remonter dessus annule tout regel amorcé : elle ne redevient pas intacte pendant qu'on y
      // est encore, ce serait le pire moment pour le faire.
      c.regelRestant = null;
      return etatDe(c, opts);
    },
    relache(cle) {
      const c = cases.get(cle);
      // Rien à charger n'a jamais existé dans la table (jamais foulée) : rien à relâcher non plus.
      if (!c) return;
      // Déjà en train de regeler (deux appels sans repasser par `charge` entre les deux, ce que
      // l'appelant ne devrait pas faire, mais rester idempotent coûte une ligne) : on ne relance
      // pas le délai depuis le début.
      if (c.regelRestant === null) c.regelRestant = opts.regel;
    },
    update(dt) {
      for (const [cle, c] of cases) {
        // Toujours sous le poids : rien à décompter, elle n'a pas encore été relâchée.
        if (c.regelRestant === null) continue;
        c.regelRestant -= dt;
        // Regelée : purge complète, pas une remise à charge nulle — sinon la table grossit sans
        // borne au fil d'une session (voir `taille`, et le registre de billboards de S1).
        if (c.regelRestant <= 0) cases.delete(cle);
      }
    },
    etat(cle) {
      const c = cases.get(cle);
      return c ? etatDe(c, opts) : "intacte";
    },
    taille() {
      return cases.size;
    },
  };
}
