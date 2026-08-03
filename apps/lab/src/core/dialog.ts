/**
 * Bandeau de dialogue. Une réplique s'écrit lettre à lettre ; l'action, elle,
 * fait deux choses selon le moment : tant que la réplique s'écrit, elle la
 * termine d'un coup ; une fois écrite, elle passe à la suivante. C'est la
 * convention de tous les jeux à dialogues, et elle évite d'avoir à choisir
 * entre « lire à son rythme » et « ne pas attendre ».
 */
// Cadence de repli, quand la réplique n'a pas de prise enregistrée.
const VITESSE = 42; // caractères par seconde
// Le texte finit un peu AVANT la voix : le chevron doit apparaître quand le
// personnage achève sa phrase, pas trois mots plus tard.
const AVANCE = 0.88;

function requireElement<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Élément #${id} manquant du DOM`);
  return el as T;
}

export interface DialogHandlers {
  /** Lance la réplique `i` du personnage `voice` (une clef de `VOIX`, `core/audio.ts`) et
   *  renvoie sa durée en secondes (0 si non décodée, ou si `voice` est vide/inconnue). */
  say?(voice: string, i: number): number;
  /** Coupe la voix en cours. */
  stop?(): void;
  /** Le « toc » de validation, au passage d'une réplique à la suivante. */
  next?(): void;
}

export interface Dialog {
  readonly open: boolean;
  /** Ouvre le bandeau sur une série de répliques. `voice` sélectionne le jeu de prises doublées
   *  (Task 12 de l'île de neige : Grota et l'habitant de la banquise partagent CE bandeau, pas
   *  deux bandeaux distincts) — omis ou inconnu, le texte s'affiche à la cadence de repli
   *  (`VITESSE`), sans voix. */
  start(speaker: string, lines: readonly string[], portrait?: string, voice?: string): void;
  close(): void;
  /** L'action : terminer la réplique, ou passer à la suivante. Ferme au bout. */
  advance(): void;
  update(dt: number): void;
}

export function createDialog(handlers: DialogHandlers = {}): Dialog {
  const say = handlers.say ?? (() => 0);
  const stop = handlers.stop ?? (() => {});
  const next = handlers.next ?? (() => {});

  const boite = requireElement<HTMLDivElement>("dialog");
  const nom = requireElement<HTMLDivElement>("dialog-name");
  const ligne = requireElement<HTMLDivElement>("dialog-line");
  const avatar = requireElement<HTMLImageElement>("dialog-avatar");

  let repliques: readonly string[] = [];
  let index = 0;
  let reveles = 0; // caractères déjà écrits, en flottant
  let vitesse = VITESSE;
  let ouvert = false;
  // Le personnage qui parle EN CE MOMENT — posé par `start()`, relu à chaque réplique par
  // `dire()`. Un seul bandeau pour tous les PNJ (voir la JSDoc de `Dialog.start`) : sans cette
  // mémoire, `dire()` ne saurait pas quelle voix demander à `say()` au passage d'une réplique à
  // la suivante (`advance()` n'a accès qu'à l'index, pas au personnage d'origine).
  let voixActuelle = "";

  const texte = (): string => repliques[index] ?? "";

  function peindre(): void {
    const n = Math.floor(reveles);
    ligne.textContent = texte().slice(0, n);
    boite.classList.toggle("ready", n >= texte().length);
  }

  /**
   * Lance la réplique courante et cale la frappe sur sa durée. Une prise de
   * neuf secondes écrite en une seconde et demie laisserait le personnage parler
   * devant un texte déjà terminé ; c'est la voix qui donne le tempo, pas
   * l'inverse.
   */
  function dire(): void {
    reveles = 0;
    const duree = say(voixActuelle, index);
    vitesse = duree > 0 ? texte().length / (duree * AVANCE) : VITESSE;
    peindre();
  }

  return {
    get open() {
      return ouvert;
    },
    start(speaker, lines, portrait, voice) {
      repliques = lines;
      index = 0;
      ouvert = true;
      voixActuelle = voice ?? "";
      nom.textContent = speaker;
      if (portrait) avatar.src = portrait;
      boite.classList.add("on");
      dire();
    },
    close() {
      ouvert = false;
      stop();
      boite.classList.remove("on", "ready");
    },
    advance() {
      if (!ouvert) return;
      // Rattraper le texte ne valide rien : on n'a pas encore lu la réplique,
      // on a juste demandé à la voir en entier. Pas de ding, et la voix continue.
      if (reveles < texte().length) {
        reveles = texte().length;
        peindre();
        return;
      }
      index++;
      if (index >= repliques.length) {
        this.close();
        return;
      }
      next(); // le ding : il ponctue le passage, donc il ne sonne qu'ici
      dire();
    },
    update(dt) {
      if (!ouvert || reveles >= texte().length) return;
      reveles = Math.min(texte().length, reveles + dt * vitesse);
      peindre();
    },
  };
}

/** L'invite « F — parler », montrée quand on est à portée et qu'on ne parle pas. */
export interface Prompt {
  shown: boolean;
}

export function createPrompt(): Prompt {
  const el = requireElement<HTMLDivElement>("prompt");
  let visible = false;
  return {
    get shown() {
      return visible;
    },
    set shown(v) {
      if (v === visible) return;
      visible = v;
      el.classList.toggle("on", v);
    },
  };
}
