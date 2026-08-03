// Échantillons du pack Free Fantasy SFX (TomMusic), joués par WebAudio — plus les pas de neige et
// de glace de l'île du nord (Task 6), générés par le studio local (`~/git/pixel-art-model`, voie
// `sfx`) : le pack n'a pas de banquise.
//
// Les variantes "Chain" des pas sont choisies exprès : le héros porte une
// armure, et le cliquetis fait la moitié du travail. Chaque déclenchement tire
// une variante au hasard ET une hauteur légèrement différente — sans ça, cinq
// échantillons en boucle s'entendent au bout de dix secondes.

import type { TerrainMaterial } from "../world/terrain-query.js";

type BankKey =
  | "pasHerbe"
  | "pasSable"
  | "pasNeige"
  | "pasGlace"
  | "brasse"
  | "pop"
  | "coffre"
  | "coffreFerme"
  | "porte"
  | "porteFerme"
  | "attaque"
  | "belement"
  | "saut"
  | "reception"
  | "entreeEau"
  | "sortieEau"
  | "suivant"
  | "rafale"
  | "craquement"
  | "rupture"
  | "ploufGlace";

const BANQUE: Record<BankKey, readonly string[]> = {
  pasHerbe: [1, 2, 3, 4, 5].map((i) => `/sfx/step-grass-${i}.ogg`),
  pasSable: [1, 2, 3, 4, 5].map((i) => `/sfx/step-sand-${i}.ogg`),
  // Trois variantes seulement, contre cinq pour herbe/sable : générées une par une (le studio
  // local n'a pas de banque toute faite), et trois suffisent déjà à casser la répétition avec le
  // tirage aléatoire de `jouer()`. Les trois crêtes sont alignées au montage — voir le rapport de
  // la task, un pas sur trois traînait avant ce travail.
  pasNeige: [1, 2, 3].map((i) => `/sfx/pas-neige-${i}.ogg`),
  pasGlace: [1, 2, 3].map((i) => `/sfx/pas-glace-${i}.ogg`),
  brasse: [1, 2, 3, 4].map((i) => `/sfx/swim-${i}.ogg`),
  pop: [1, 2, 3].map((i) => `/sfx/pop-${i}.ogg`),
  coffre: [1, 2].map((i) => `/sfx/chest-${i}.ogg`),
  coffreFerme: [1, 2].map((i) => `/sfx/chest-close-${i}.ogg`),
  porte: [1, 2].map((i) => `/sfx/door-open-${i}.ogg`),
  porteFerme: [1, 2].map((i) => `/sfx/door-close-${i}.ogg`),
  attaque: [1, 2, 3].map((i) => `/sfx/attack-${i}.ogg`),
  // Le pack n'a pas de mouton : quatre prises maison, taillées par
  // scripts/sync-assets.sh. Elles vont de 0.97 s à 1.97 s — un bêlement n'a pas
  // de durée standard, et c'est tant mieux.
  belement: [1, 2, 3, 4].map((i) => `/sfx/bleat-${i}.ogg`),
  saut: ["/sfx/jump.ogg"],
  reception: ["/sfx/land.ogg"],
  entreeEau: ["/sfx/water-in.ogg"],
  sortieEau: ["/sfx/water-out.ogg"],
  // Validation d'une réplique. Le pack n'a aucun son d'interface, mais il a des
  // pas : un pas sur planche, détaché de la marche, n'est plus qu'un bloc de
  // bois frappé — le son de validation des jeux à dialogues, et il va bien à un
  // panda en chapeau de paille. Trois variantes, comme partout ailleurs.
  suivant: [1, 2, 3].map((i) => `/sfx/next-${i}.ogg`),
  // Une rafale de vent isolée, générée ici avec le reste des sons du lieu pour éviter un
  // aller-retour au studio pour un seul fichier — mais NON déclenchée par ce travail : Task 9 la
  // reliera au pulse visuel du brouillard polaire. Déclarée au catalogue (donc pesée et décodée
  // à l'écran de chargement) sans fonction d'export : décider QUAND elle joue est le travail de
  // Task 9, pas de celui-ci.
  rafale: ["/sfx/rafale.ogg"],
  // La glace fine (Task 7, `world/thin-ice.ts`) : trois temps, trois sons. Le craquement est
  // RÉPÉTÉ tant qu'on reste dessus après le premier avertissement (voir `hero.ts`) — il lui faut
  // donc des variantes comme les pas, pour la même raison (`jouer()` en tire une au hasard à
  // chaque appel). Rupture et plongeon n'arrivent qu'une fois par chute : un seul fichier chacun,
  // comme `saut`/`reception`/`entreeEau` plus haut.
  craquement: [1, 2, 3].map((i) => `/sfx/craquement-${i}.ogg`),
  rupture: ["/sfx/rupture.ogg"],
  ploufGlace: ["/sfx/plouf-glace.ogg"],
};

type Ambiance = "jour" | "nuit";

// Toutes les boucles WebAudio du module — nappes d'ambiance, foyer, ET depuis Task 6 la nappe
// polaire et la glisse — partagent la même infrastructure (`demarrerBoucles`, `boucles`, plus
// bas) : un seul type nommé plutôt que répéter l'union à quatre endroits, ce qui aurait fini par
// en oublier un le jour où une cinquième boucle s'ajoute.
type BoucleKey = Ambiance | "mer" | "feu" | "polaire" | "glisse";

// Une piste par clef. La clef n'est plus l'heure du jour : depuis l'île de neige (Task 5), c'est
// une ZONE (`Zone.musique`, `world/zones.ts`) qui la choisit, via `setZoneMusic` — le cycle
// jour/nuit ne pilote plus jamais la musique, seulement la nappe (`setAmbience`, plus bas). Une
// seule piste joue à la fois, et changer de clef reprend l'autre au même endroit du morceau, en
// fondu croisé (voir `setZoneMusic`) : deux pistes qui tourneraient en phase, sans ça, finiraient
// déphasées puis superposées à la relance.
const MUSIQUE: Record<string, string> = {
  // Le thème de la banquise (Task 5) : nappe éparse, cloches lointaines, pensé pour tenir SOUS le
  // souffle du vent polaire (Task 6) sans s'y battre. Généré par le studio local
  // (`~/git/pixel-art-model`, voie `music`), trois variantes jugées, celle-ci retenue pour son
  // entrée douce et sa fin qui s'éteint TOUTE SEULE — voir le rapport de la task : c'est ce qui
  // rend la pause de trente secondes qui suit indiscernable de la fin naturelle du morceau.
  neige: "/music/neige.ogg",
};

// Les répliques de Grota, une prise par ligne. Elles ne passent pas par
// `jouer()` : celui-ci tire une variante et une hauteur au hasard, ce qui est
// exactement ce qu'il ne faut pas faire à une voix.
const VOIX = [1, 2, 3, 4].map((i) => `/voice/grota-${i}.ogg`);

const BOUCLES: Record<BoucleKey, string> = {
  jour: "/sfx/amb-day.ogg",
  nuit: "/sfx/amb-night.ogg",
  mer: "/sfx/amb-sea.ogg",
  feu: "/sfx/fire.ogg",
  // Le souffle polaire (Task 6) : `ZONE_POLAIRE` (`settings.ts`) porte `nappe: "polaire"` depuis
  // la Task 4, mais `setAmbience` n'avait encore aucune clef "polaire" à jouer et éteignait
  // silencieusement jour/nuit à l'arrivée sur la banquise, faute de mieux — voir sa docstring,
  // mise à jour plus bas, pour le câblage réel.
  polaire: "/sfx/amb-polaire.ogg",
  // La glisse (Task 6, simplifiée Task 7b) : PAS une ambiance de zone — un son TENU piloté image
  // par image par `setSkid` depuis `hero.ts`, actif pendant une glisse verrouillée et muet sinon
  // (voir la docstring de `setSkid`, plus bas). Elle emprunte quand même cette infrastructure de
  // boucle plutôt que d'en inventer une seconde : `demarrerBoucles`
  // (plus bas) la crée une fois, silencieuse par défaut puisque `ambiance` ne vaut jamais
  // "glisse" — exactement comme le foyer avant que `setFireDistance` ne lui donne un gain.
  glisse: "/sfx/glisse.ogg",
};

// `glisse`/`polaire` sont exportées avec une marge de queue au-delà du point de bouclage réel
// (voir le rapport de la task 6) : Opus déforme perceptiblement les tout derniers échantillons
// d'un flux encodé — sa fenêtre de transform n'a aucun contexte au-delà de la fin du fichier — ce
// qui créait un clic mesurable au raccord (jusqu'à 36× le saut échantillon-à-échantillon normal
// du signal, contre ~1× une fois cette marge en place). `loopEnd` fait boucler la lecture AVANT
// cette zone abîmée ; la marge elle-même n'est jamais entendue. Les boucles du pack (jour/nuit/
// mer/feu) n'ont pas cette marge — elles n'ont pas été réencodées par ce travail, seulement
// recopiées telles quelles depuis le pack.
const LOOP_END_S: Partial<Record<BoucleKey, number>> = {
  glisse: 1.0,
  polaire: 17.5,
};

/** Tout ce que le son a besoin de charger — l'écran de chargement le pèse. */
export const AUDIO_URLS: readonly string[] = [
  ...Object.values(BANQUE).flat(),
  ...VOIX,
  ...Object.values(BOUCLES),
  ...Object.values(MUSIQUE),
];

const NIVEAUX: Record<BoucleKey, number> = {
  jour: 0.5,
  nuit: 0.5,
  mer: 0.22,
  feu: 0.5,
  polaire: 0.42,
  // Le plafond de la glisse à pleine intensité — `setSkid` le multiplie par 0 ou 1 (verrouillé ou
  // pas, voir sa docstring), jamais utilisé directement comme les autres nappes.
  glisse: 0.6,
};
// La musique se fait attendre : elle entre en fondu long, et laisse un vrai
// silence entre deux passages. Une boucle sans respiration s'entend au bout de
// deux tours ; une pause, non.
const MUSIQUE_ATTENTE = 10; // secondes avant la première note
const MUSIQUE_PAUSE = 30; // secondes de silence entre deux passages
const MUSIQUE_FONDU = 6; // secondes de montée
const MUSIQUE_SORTIE = 2; // secondes de descente quand on l'éteint
const MUSIQUE_NIVEAU = 0.4;
const MUSIQUE_BASCULE = 2.5; // secondes pour croiser jour et nuit
const PORTEE_FEU = 13; // au-delà, on n'entend plus le foyer

interface Boucle {
  gain: GainNode;
}

interface Arrangement {
  src: AudioBufferSourceNode;
  gain: GainNode;
  // `string`, pas `Ambiance` : une clef de `MUSIQUE` vient d'une zone (`Zone.musique`,
  // `world/zones.ts`), qui n'est pas bornée à "jour"/"nuit" — `Ambiance` reste le type des
  // NAPPES (`BOUCLES`/`NIVEAUX`), une notion distincte depuis que Task 5 a séparé musique et
  // nappe (voir `setZoneMusic` vs `setAmbience`).
  clef: string;
}

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
const tampons = new Map<string, AudioBuffer>(); // url -> AudioBuffer
const boucles: Partial<Record<BoucleKey, Boucle>> = {};
let debloque = false;
// `string` pour la même raison que `Arrangement.clef` : une zone (Task 4) peut demander une nappe
// que `Ambiance` ne connaît pas encore.
let ambiance: string = "jour";
let musiqueGain: GainNode | null = null; // niveau d'ensemble : allumage, extinction, fondu
let actif: Arrangement | null = null; // l'arrangement qui joue
let debutMusique = 0; // instant du contexte correspondant à l'offset 0 du morceau
// La clef que la zone courante réclame (`Zone.musique`, `world/zones.ts`), `null` pour silence —
// voir `setZoneMusic`. Distincte d'`ambiance` : une zone peut porter une nappe ("polaire") et une
// musique ("neige") qui ne portent pas le même nom.
let pisteZone: string | null = null;
// La clef de la DERNIÈRE piste réellement lancée par `jouerArrangement`, qu'elle joue encore ou
// qu'on l'ait coupée en sortant de zone — jamais remise à `null` par une sortie, seulement par la
// FIN naturelle d'un passage (`onended`, plus bas). C'est la mémoire qui permet à `lancerPiste` de
// reprendre où on en était plutôt que de rejouer le début à chaque entrée dans la zone (voir la
// task 5 : sortir dix secondes puis revenir ne doit pas relancer les dix premières secondes).
let pisteEnCours: string | null = null;
// Position RÉELLEMENT jouée dans `pisteEnCours` au moment de la dernière coupure
// (`arreterMusique`, plus bas) — PAS une horloge murale qu'on recalculerait à la reprise. Entre
// deux séjours dans une zone à thème il peut s'écouler une minute comme une heure sans qu'une
// seule seconde de musique ait joué ; si `lancerPiste` recalculait `ctx.currentTime - debutMusique`
// à la reprise, il compterait tout ce temps d'absence comme du temps joué et retomberait sur la
// toute fin du morceau après une longue balade ailleurs (voir la revue de la task 5, Important 1).
let pisteOffsetPause = 0;
// Allumée d'entrée : elle démarrera au premier geste, en même temps que le
// reste du son — un navigateur n'autorise rien avant.
let musiqueActive = true;
let minuterie: ReturnType<typeof setTimeout> | null = null;
// Le nœud qu'`arreterMusique` a mis en fondu de sortie, en attente de son arrêt différé de
// `MUSIQUE_SORTIE` secondes. Retenu dans l'état du MODULE, pas seulement dans la fermeture locale
// du `setTimeout` qui l'arrête : si la musique redémarre avant l'expiration de ce délai (sortie
// puis rentrée rapide en zone), `jouerArrangement` doit pouvoir le stopper tout de suite, sinon il
// continue de jouer EN MÊME TEMPS que la nouvelle instance du même morceau (voir la revue de la
// task 5, Important 2).
let sortant: Arrangement | null = null;
let sortantMinuterie: ReturnType<typeof setTimeout> | null = null;

/**
 * Crée le contexte (suspendu tant qu'aucun geste n'a eu lieu) et lance le
 * décodage en tâche de fond. Rien ne bloque : tant qu'un son n'est pas décodé,
 * il ne se joue simplement pas.
 */
export async function initAudio(
  blobs: Map<string, Blob>,
  onDecoded: (p: number) => void = () => {},
): Promise<void> {
  if (ctx) return;
  // Le contexte naît suspendu et le restera jusqu'au geste : c'est justement
  // pour ça qu'on peut tout décoder AVANT, pendant l'écran de chargement.
  const context = new AudioContext();
  ctx = context;
  const m = context.createGain();
  m.connect(context.destination);
  master = m;
  const mg = context.createGain();
  mg.gain.value = 0;
  mg.connect(m);
  musiqueGain = mg;

  let faits = 0;
  const charger = async (url: string): Promise<void> => {
    const blob = blobs.get(url);
    try {
      if (!blob) throw new Error(`Blob manquant pour ${url}`);
      tampons.set(url, await context.decodeAudioData(await blob.arrayBuffer()));
    } catch {
      /* un son manquant ne doit pas casser la scène */
    }
    onDecoded(++faits / AUDIO_URLS.length);
  };
  await Promise.all(AUDIO_URLS.map(charger));
  // Boucles et musique ne démarrent pas ici : elles sortent d'elles-mêmes au
  // déverrouillage, et tout est déjà décodé quand il arrive.
}

/** À appeler au premier geste : c'est lui qui autorise le son. */
export function unlockAudio(): void {
  if (!ctx || debloque) return;
  debloque = true;
  ctx.resume();
  demarrerBoucles();
  demarrerMusique(MUSIQUE_ATTENTE);
}

function demarrerBoucles(): void {
  if (!debloque || !ctx || !master) return;
  const context = ctx;
  const m = master;
  for (const clef of Object.keys(BOUCLES) as BoucleKey[]) {
    const url = BOUCLES[clef];
    if (boucles[clef] || !tampons.has(url)) continue;
    const buf = tampons.get(url);
    if (!buf) continue;
    const src = context.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    // Voir `LOOP_END_S` : `glisse`/`polaire` portent une marge de queue au-delà du point de
    // bouclage réel, pour boucler avant la zone que l'encodage Opus abîme. Les boucles du pack
    // n'ont pas cette entrée : `loopEnd` reste à son défaut (la durée entière du buffer).
    const loopEnd = LOOP_END_S[clef];
    if (loopEnd !== undefined) src.loopEnd = loopEnd;
    const g = context.createGain();
    // Le feu, la nappe polaire et la glisse démarrent muets : c'est la scène (`setAmbience`) ou
    // la glisse verrouillée (`setSkid`) qui les ouvre.
    g.gain.value = clef === "mer" ? NIVEAUX.mer : clef === ambiance ? NIVEAUX[clef] : 0;
    src.connect(g).connect(m);
    src.start();
    boucles[clef] = { gain: g };
  }
}

/**
 * Allume / éteint la musique. Les pistes s'enchaînent d'elles-mêmes ; couper
 * arrête la lecture plutôt que de la laisser tourner en sourdine, pour ne pas
 * reprendre au milieu d'un morceau.
 * Renvoie true si la musique est désormais active, null s'il n'y a aucune piste.
 */
export function toggleMusic(): boolean | null {
  // Sans piste déclarée, la touche n'a rien à commuter : `null` fait afficher
  // « aucune piste » plutôt qu'un état allumé qui ne produirait aucun son.
  if (!ctx || !musiqueGain || !Object.keys(MUSIQUE).length) return null;
  musiqueActive = !musiqueActive;
  if (musiqueActive) {
    // Rallumée à la main : on ne refait pas attendre dix secondes.
    demarrerMusique(0);
  } else {
    // Même coupure que `setZoneMusic(null)` — voir `arreterMusique`.
    arreterMusique();
  }
  return musiqueActive;
}

/**
 * L'état voulu, indépendamment du geste qui n'a peut-être pas encore eu lieu.
 * Faux s'il n'y a aucune piste : le HUD annonçait « ♪ musique » sur un dossier
 * vide, ce qui promettait quelque chose qui n'arriverait jamais.
 */
export const musicEnabled = (): boolean => musiqueActive && Object.keys(MUSIQUE).length > 0;

// Programme un départ si tout est réuni : le son est débloqué, la musique est voulue, la ZONE
// COURANTE porte une piste et elle est décodée, et rien ne joue ni n'est déjà programmé. Appelé
// au déblocage, à la fin d'un passage (la pause) et par `setZoneMusic` à l'arrivée dans une zone
// à thème — sans savoir dans quel ordre ces événements arriveront.
function demarrerMusique(attente: number): void {
  if (!debloque || !musiqueActive || actif || minuterie || !pisteZone) return;
  const url = MUSIQUE[pisteZone];
  if (!url || !tampons.has(url)) return;
  minuterie = setTimeout(() => {
    minuterie = null;
    lancerPiste();
  }, attente * 1000);
}

function lancerPiste(): void {
  if (!pisteZone || !ctx || !musiqueGain) return;
  // Reprend où on en était si c'est la piste qu'on vient de quitter avant qu'elle ait fini son
  // tour (voir `pisteEnCours`) ; sinon — première fois, ou fin naturelle déjà passée par
  // `onended` — repart de zéro. `pisteOffsetPause` est la position gelée au moment de la coupure,
  // PAS `ctx.currentTime - debutMusique` recalculé ici : cette dernière formule compterait le
  // temps d'horloge murale écoulé depuis le tout premier démarrage, silence de la zone inclus.
  const offset = pisteEnCours === pisteZone ? pisteOffsetPause : 0;
  jouerArrangement(pisteZone, offset, 0);
  if (!actif) return;
  // Fondu d'entrée long : la musique s'installe au lieu de tomber d'un bloc.
  const t = ctx.currentTime;
  musiqueGain.gain.cancelScheduledValues(t);
  musiqueGain.gain.setValueAtTime(0.0001, t);
  musiqueGain.gain.linearRampToValueAtTime(MUSIQUE_NIVEAU, t + MUSIQUE_FONDU);
}

/**
 * Lance un arrangement à un endroit donné du morceau. Si un autre joue, il
 * s'efface en même temps que celui-ci monte — les deux se croisent.
 */
function jouerArrangement(clef: string, offset: number, fondu: number): void {
  const url = MUSIQUE[clef];
  if (!url || !ctx || !musiqueGain) return;
  const buf = tampons.get(url);
  if (!buf) return;
  const context = ctx;
  const t = context.currentTime;

  // Un nœud sortant peut encore attendre son arrêt différé de `arreterMusique` (jusqu'à
  // `MUSIQUE_SORTIE` secondes) : le stopper tout de suite avant d'en lancer un nouveau évite qu'il
  // continue de jouer EN MÊME TEMPS que cette nouvelle instance du même morceau si la zone est
  // quittée puis retrouvée avant l'expiration du délai (voir la revue de la task 5, Important 2).
  if (sortantMinuterie) {
    clearTimeout(sortantMinuterie);
    sortantMinuterie = null;
  }
  if (sortant) {
    sortant.src.stop();
    sortant = null;
  }

  const gain = context.createGain();
  gain.gain.setValueAtTime(fondu > 0 ? 0.0001 : 1, t);
  if (fondu > 0) gain.gain.linearRampToValueAtTime(1, t + fondu);
  gain.connect(musiqueGain);

  const src = context.createBufferSource();
  src.buffer = buf;
  src.loop = false; // le morceau va au bout, puis se tait
  src.connect(gain);
  // On ne reprend jamais à moins de deux secondes de la fin : ce serait un
  // fondu d'entrée sur un morceau déjà terminé.
  const offsetDepart = Math.max(0, Math.min(offset, buf.duration - 2));
  src.start(t, offsetDepart);
  src.onended = () => {
    // Ne replanifie que si c'est bien la fin du morceau : ni une extinction,
    // ni l'arrangement qu'on vient de remplacer.
    if (!musiqueActive || actif?.src !== src) return;
    actif = null;
    // Le passage est allé à son terme : la prochaine reprise (après la pause) repart de zéro,
    // pas d'ici. Sans ça, `lancerPiste` la confondrait avec une interruption par sortie de zone
    // et essaierait de reprendre à la toute fin du morceau (voir `pisteEnCours`).
    pisteEnCours = null;
    pisteOffsetPause = 0;
    demarrerMusique(MUSIQUE_PAUSE);
  };

  if (actif) {
    const precedent = actif;
    precedent.gain.gain.cancelScheduledValues(t);
    precedent.gain.gain.setTargetAtTime(0, t, fondu / 3);
    setTimeout(() => precedent.src.stop(), fondu * 1000 + 300);
  }
  actif = { src, gain, clef };
  pisteEnCours = clef;
  // Ancre calée sur l'offset RÉELLEMENT joué (après bornage à `buf.duration - 2`), pas sur
  // l'offset demandé : sinon l'ancre et la lecture divergent, et c'est exactement cet écart qui
  // s'accumulait sur les reprises successives (voir la revue de la task 5, Important 1).
  debutMusique = t - offsetDepart;
}

/**
 * Coupe la musique en cours dans un fondu de sortie de `MUSIQUE_SORTIE` secondes, sans toucher à
 * `musiqueActive` ni à `pisteZone`/`pisteEnCours` — appelée par `toggleMusic` (l'auditeur coupe
 * avec "M") et `setZoneMusic(null)` (la zone n'a rien à offrir) : les deux gestes coupent
 * exactement de la même façon, seul le déclencheur diffère.
 *
 * Fige `pisteOffsetPause` sur la position RÉELLEMENT jouée à l'instant de la coupure — c'est elle,
 * pas une horloge murale qui continuerait de courir pendant l'absence, que `lancerPiste` relira à
 * la prochaine reprise (voir la revue de la task 5, Important 1).
 *
 * Retient le nœud sortant dans l'état du MODULE (`sortant`/`sortantMinuterie`), pas seulement dans
 * la fermeture locale d'un `setTimeout` : si la musique redémarre avant l'expiration du délai,
 * `jouerArrangement` le stoppe immédiatement plutôt que de le laisser jouer en même temps que la
 * nouvelle instance du même morceau (voir la revue de la task 5, Important 2).
 */
function arreterMusique(): void {
  if (minuterie) {
    clearTimeout(minuterie);
    minuterie = null;
  }
  if (!ctx || !musiqueGain || !actif) return;
  const t = ctx.currentTime;
  musiqueGain.gain.cancelScheduledValues(t);
  musiqueGain.gain.setTargetAtTime(0, t, MUSIQUE_SORTIE / 3);
  pisteOffsetPause = Math.max(0, t - debutMusique);
  sortant = actif;
  actif = null; // avant le stop : l'`ended` qui suit ne doit rien replanifier
  sortantMinuterie = setTimeout(() => {
    sortant?.src.stop();
    sortant = null;
    sortantMinuterie = null;
  }, MUSIQUE_SORTIE * 1000);
}

// --- sons ponctuels ---------------------------------------------------------

function jouer(
  clef: BankKey,
  { gain = 1, hauteur = 1 }: { gain?: number; hauteur?: number } = {},
): void {
  if (!ctx || !debloque || !master) return;
  const liste = BANQUE[clef];
  const url = liste[(Math.random() * liste.length) | 0];
  const buf = url ? tampons.get(url) : undefined;
  if (!buf) return;

  const src = ctx.createBufferSource();
  src.buffer = buf;
  // Variante ET hauteur tirées au hasard : sans ça, cinq échantillons en boucle
  // s'entendent au bout de dix secondes.
  src.playbackRate.value = hauteur * (0.92 + Math.random() * 0.16);
  const g = ctx.createGain();
  g.gain.value = gain * (0.85 + Math.random() * 0.3);
  src.connect(g).connect(master);
  src.start();
}

/** Choisit l'échantillon et son niveau pour chaque matière. `glace-fine` partage le son de
 *  `glace` — comme elle partage déjà sa friction (`locomotion.ts`) : ce n'est pas encore une
 *  matière de RENDU distincte (Task 7 lui donnera son propre visuel de craquelure), donc pas
 *  encore un son distinct non plus. */
function pasDe(sol: TerrainMaterial): { clef: BankKey; gain: number } {
  switch (sol) {
    case "sable":
      return { clef: "pasSable", gain: 0.75 };
    case "neige":
      // Étouffé : un pas de neige n'a pas le mordant sec d'un pas de glace.
      return { clef: "pasNeige", gain: 0.85 };
    case "glace":
    case "glace-fine":
      return { clef: "pasGlace", gain: 0.95 };
    case "herbe":
      return { clef: "pasHerbe", gain: 0.9 };
  }
}

/** Un pas. Chaque matière tire sa propre variante ET sa propre hauteur au hasard, comme le reste
 *  du module (voir `jouer`) — cinq matières pour trois échantillons chacun au minimum (herbe et
 *  sable en ont cinq, neige et glace trois) : sans ce tirage la répétition s'entendrait en
 *  quelques pas, pas en dix secondes. */
export const step = (sol: TerrainMaterial = "herbe"): void => {
  const { clef, gain } = pasDe(sol);
  jouer(clef, { gain });
};

export const jump = (): void => jouer("saut", { gain: 0.8 });
/** Réception : le poids suit la vitesse de chute. */
export const land = (force = 1): void => jouer("reception", { gain: 0.55 * force });
export const enterWater = (): void => jouer("entreeEau", { gain: 0.9 });
export const leaveWater = (): void => jouer("sortieEau", { gain: 0.7 });
export const swimStroke = (): void => jouer("brasse", { gain: 0.55 });
/** Le sifflement de la lame. Déclenché sur la frame de frappe, pas sur la touche. */
export const attack = (): void => jouer("attaque", { gain: 0.65 });
export const pop = (): void => jouer("pop", { gain: 0.8 });
export const openChest = (): void => jouer("coffre", { gain: 0.9 });
export const closeChest = (): void => jouer("coffreFerme", { gain: 0.9 });
export const openDoor = (): void => jouer("porte", { gain: 0.85 });
export const closeDoor = (): void => jouer("porteFerme", { gain: 0.85 });

/**
 * La glace fine (Task 7, `world/thin-ice.ts`) : `crack()` prévient, `shatter()` marque la
 * rupture, `plunge()` accompagne la chute. Les trois passent par `jouer()` comme le reste du
 * module — `plunge`/`shatter` n'ont qu'une seule variante chacun dans `BANQUE`, `jouer()` la joue
 * donc à chaque appel (avec sa propre hauteur aléatoire, comme tout le reste), exactement le même
 * chemin que `jump`/`land`/`enterWater` plus haut.
 */
export const crack = (): void => jouer("craquement", { gain: 0.8 });
/** Jouée juste avant que `hero.ts` fasse tomber le héros à l'eau (`enterWater`, réutilisé tel
 *  quel) : le bruit de la glace qui cède, distinct du `plunge()` qui suit d'une fraction de
 *  seconde. */
export const shatter = (): void => jouer("rupture", { gain: 0.95 });
/** Le plongeon À TRAVERS la glace, à la place du `entreeEau` générique : c'est la même chute dans
 *  l'eau que partout ailleurs (`hero.ts` réutilise `enterWater`), seul le son change — passé en
 *  paramètre plutôt que réimplémenté. */
export const plunge = (): void => jouer("ploufGlace", { gain: 0.95 });

/**
 * Bascule la NAPPE d'ambiance ; les boucles concernées se croisent en fondu. `nom` était borné à
 * `Ambiance` ("jour"/"nuit") tant que seul le cycle jour/nuit l'appelait ; depuis Task 4 de l'île
 * de neige, une zone (`Zone.nappe`, `world/zones.ts`) l'appelle aussi avec son propre nom —
 * "polaire" pour `ZONE_POLAIRE`. Task 6 lui donne enfin sa propre nappe (`amb-polaire.ogg`,
 * `BOUCLES.polaire`) : avant ce travail, "polaire" ne correspondait à aucune clef connue et le
 * corps ci-dessous se contentait d'éteindre jour/nuit avec grâce, un silence déjà audible en
 * l'attendant.
 *
 * Ne pilote QUE la nappe, depuis Task 5 : la musique obéit séparément à `setZoneMusic`, plus bas.
 * Une zone porte une nappe et une musique qui ne partagent pas forcément le même nom (la polaire :
 * "polaire" contre "neige"), donc les confondre ferait chercher dans `MUSIQUE` une clef qui n'a
 * jamais existé.
 */
export function setAmbience(nom: string): void {
  ambiance = nom;
  if (!ctx) return;
  const t = ctx.currentTime;
  const jourB = boucles.jour;
  const nuitB = boucles.nuit;
  if (!jourB || !nuitB) return;
  jourB.gain.gain.setTargetAtTime(nom === "jour" ? NIVEAUX.jour : 0, t, 1.2);
  nuitB.gain.gain.setTargetAtTime(nom === "nuit" ? NIVEAUX.nuit : 0, t, 1.2);
  // Garde défensive, comme pour `jourB`/`nuitB` plus haut : si `amb-polaire.ogg` n'a pas pu être
  // décodé (`initAudio` avale silencieusement un échantillon manquant), `boucles.polaire` reste
  // `undefined` et cet appel n'a rien à piloter, plutôt que de planter la scène. `setSkid` a la
  // même garde, pour la même raison.
  const polaireB = boucles.polaire;
  if (polaireB) polaireB.gain.gain.setTargetAtTime(nom === "polaire" ? NIVEAUX.polaire : 0, t, 1.2);
}

/**
 * Bascule la MUSIQUE sur celle que réclame la zone courante (`Zone.musique`, `world/zones.ts`).
 * `null` veut dire silence : une zone sans thème (`ZONE_LARGE`) doit éteindre la musique en
 * fondu, pas la couper net — la même sortie que `toggleMusic` (elles partagent `arreterMusique`),
 * mais SANS toucher `musiqueActive`, qui appartient à l'auditeur (la touche "M"), pas à la
 * géographie. Idempotent sur la clef courante : `main.ts` n'appelle ceci qu'au changement de zone
 * (`applyZone`), mais un appel répété avec la même clef ne doit rien redéclencher.
 *
 * Reprend au même endroit du morceau qu'on l'ait quitté, mais par DEUX mécanismes distincts — pas
 * un seul —, chacun correct pour sa propre raison :
 * - Fondu croisé direct (`actif` encore non nul, plus bas) : l'offset se calcule EN DIRECT,
 *   `ctx.currentTime - debutMusique`. Valable ici parce que la lecture n'a jamais été interrompue
 *   depuis que `debutMusique` a été posée — aucun silence à soustraire, l'horloge murale et le
 *   temps réellement joué avancent ensemble.
 * - Redémarrage à froid (rien ne joue, via `lancerPiste`) : l'offset relit `pisteOffsetPause`,
 *   figée par `arreterMusique` sur la position RÉELLEMENT jouée au moment de la coupure. La même
 *   formule en direct serait fausse ici : le temps d'horloge murale écoulé depuis la coupure
 *   inclut le silence de l'absence, que le morceau, lui, n'a pas joué (voir la revue de la task 5,
 *   Important 1) — c'est précisément pour ce chemin que `pisteOffsetPause` existe.
 *
 * Seule exception commune aux deux, déjà vraie avant cette task : on ne reprend jamais à moins de
 * deux secondes de la fin (`jouerArrangement`), pour ne pas lancer un fondu d'entrée sur un
 * morceau déjà terminé.
 */
export function setZoneMusic(clef: string | null): void {
  if (clef === pisteZone) return;
  pisteZone = clef;
  // Pas encore débloqué : rien à faire ici, `unlockAudio` lira `pisteZone` lui-même au geste.
  if (!ctx || !musiqueGain) return;

  if (clef === null) {
    // Sortie d'une zone à thème : `arreterMusique` laisse `pisteEnCours`/`debutMusique` intacts et
    // fige `pisteOffsetPause` — c'est la mémoire du point de reprise si on revient avant que la
    // piste ait fini son tour (voir `lancerPiste`).
    arreterMusique();
    return;
  }

  if (!musiqueActive) return; // coupée à la main : la zone attendra que "M" la rallume

  if (minuterie) {
    clearTimeout(minuterie);
    minuterie = null;
  }
  if (actif) {
    // Rare tant qu'une seule zone porte un thème, mais on respecte la même règle que jour/nuit :
    // deux pistes ne jouent jamais en même temps, elles se croisent — reprise au même endroit du
    // morceau.
    jouerArrangement(clef, ctx.currentTime - debutMusique, MUSIQUE_BASCULE);
    return;
  }
  // Rien ne joue : on part tout de suite. L'attente de dix secondes (`MUSIQUE_ATTENTE`) n'a de
  // sens qu'au tout premier geste de la partie, pas à chaque arrivée en terrain balisé — sinon la
  // musique entrerait dix secondes APRÈS l'arrivée plutôt qu'à l'arrivée.
  demarrerMusique(0);
}

/**
 * Le foyer s'entend d'autant plus qu'on en est près. Pas de vrai panner : une
 * atténuation par la distance suffit et ne coûte qu'un gain.
 */
export function setFireDistance(d: number): void {
  const feu = boucles.feu;
  if (!feu || !ctx) return;
  const v = Math.max(0, 1 - d / PORTEE_FEU) ** 2;
  feu.gain.gain.setTargetAtTime(NIVEAUX.feu * v, ctx.currentTime, 0.15);
}

/**
 * La glisse : un son TENU, pas un déclenchement — jamais `jouer()`.
 *
 * Task 6 pilotait `intensite` en continu (0..1) sur le DÉSACCORD entre la vitesse et l'entrée — un
 * dérapage en virage que la glace de l'époque (friction quasi nulle, mais encore dirigeable)
 * permettait. Task 7b a remplacé cette glace-là par une glisse VERROUILLÉE (la règle de Pokémon,
 * `glissementSuivant`, `world/locomotion.ts`) : soit on glisse, direction figée, entrée ignorée,
 * soit on ne glisse pas — il n'y a plus de désaccord à mesurer entre les deux. `hero.ts` appelle
 * donc `setSkid` avec 0 ou 1 seulement, jamais une valeur intermédiaire : `intensite` reste un
 * `number` (pas un booléen) uniquement parce que `Math.max(0, Math.min(1, ...))` ci-dessous
 * l'accepte sans problème et qu'un futur appelant pourrait redevenir continu sans changer cette
 * signature.
 *
 * `setTargetAtTime` lisse l'image par image en un vrai fondu continu — sans lui, un signal 0/1
 * changerait le gain instantanément et on entendrait un CLIC au lieu d'un son qui monte et qui
 * descend en douceur au verrouillage et à l'arrêt.
 */
export function setSkid(intensite: number): void {
  const glisse = boucles.glisse;
  if (!glisse || !ctx) return;
  const v = NIVEAUX.glisse * Math.max(0, Math.min(1, intensite));
  glisse.gain.gain.setTargetAtTime(v, ctx.currentTime, 0.12);
}

/**
 * Un bêlement, `semitones` au-dessus de sa hauteur naturelle : chaque mouton a
 * sa voix, et elle monte à mesure qu'on l'agace. Transposer un enregistrement
 * par la vitesse de lecture le raccourcit d'autant — ici c'est un cadeau, un
 * mouton pressé bêle plus court.
 */
export const bleat = (semitones = 0): void =>
  jouer("belement", { hauteur: 2 ** (semitones / 12), gain: 0.5 });

// --- Grota ------------------------------------------------------------------
// Il a une vraie voix : quatre prises, une par réplique. Le bandeau en a besoin
// de la DURÉE, pas seulement du déclenchement — c'est elle qui cadence la
// frappe du texte. Une réplique de neuf secondes écrite en une seconde et demie
// laisserait le panda parler devant un texte déjà fini.
let voixEnCours: AudioBufferSourceNode | null = null;

/**
 * Lance la réplique `i` et renvoie sa durée en secondes, ou 0 si la prise n'est
 * pas encore décodée — auquel cas le bandeau reprend sa cadence par défaut.
 * Toute réplique en cours est coupée : on ne se superpose pas à soi-même.
 */
export function sayLine(i: number): number {
  stopLine();
  if (!ctx || !debloque || !master) return 0;
  const url = VOIX[i];
  const buf = url ? tampons.get(url) : undefined;
  if (!buf) return 0;

  const src = ctx.createBufferSource();
  src.buffer = buf;
  const g = ctx.createGain();
  g.gain.value = 0.95;
  src.connect(g).connect(master);
  src.start();
  voixEnCours = src;
  src.onended = () => {
    if (voixEnCours === src) voixEnCours = null;
  };
  return buf.duration;
}

/** Couper la parole : on passe à la suite, ou on s'éloigne. */
export function stopLine(): void {
  if (!voixEnCours) return;
  try {
    voixEnCours.stop();
  } catch {
    /* déjà terminée */
  }
  voixEnCours = null;
}

/**
 * Validation d'une réplique : le « toc » de bois. Monté un peu en hauteur pour
 * qu'on n'y entende plus un pas mais un bloc frappé — à sa vitesse d'origine,
 * détaché de la marche, il traînait encore le poids d'une semelle.
 */
export const ding = (): void => jouer("suivant", { gain: 0.5, hauteur: 1.35 });
