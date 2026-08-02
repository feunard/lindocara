// Échantillons du pack Free Fantasy SFX (TomMusic), joués par WebAudio.
//
// Les variantes "Chain" des pas sont choisies exprès : le héros porte une
// armure, et le cliquetis fait la moitié du travail. Chaque déclenchement tire
// une variante au hasard ET une hauteur légèrement différente — sans ça, cinq
// échantillons en boucle s'entendent au bout de dix secondes.

type BankKey =
  | "pasHerbe"
  | "pasSable"
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
  | "suivant";

const BANQUE: Record<BankKey, readonly string[]> = {
  pasHerbe: [1, 2, 3, 4, 5].map((i) => `/sfx/step-grass-${i}.ogg`),
  pasSable: [1, 2, 3, 4, 5].map((i) => `/sfx/step-sand-${i}.ogg`),
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
};

type Ambiance = "jour" | "nuit";

// Deux arrangements du même morceau, un par heure du jour. Ils ne font PAS la
// même durée : les faire tourner en phase laisserait la version nuit jouer une
// minute après la fin de l'autre, puis se superposer à la relance. Un seul
// joue donc à la fois, et changer d'heure reprend l'autre au même endroit du
// morceau, en fondu croisé.
// Aucune piste pour l'instant : les arrangements essayés étaient sous droits, et
// les avoir en local pour bricoler n'est pas la même chose que les servir depuis
// une URL publique. Toute la mécanique reste en place — il suffit de déposer des
// fichiers dans `public/music/` et de les déclarer ici :
//
//   const MUSIQUE: Record<string, string> = { jour: "/music/jour.ogg", nuit: "/music/nuit.ogg" }
//
// Les deux clés sont attendues : le morceau se croise en fondu au basculement
// jour/nuit, et les deux arrangements avancent au même endroit du morceau. Une
// piste unique se déclare donc deux fois, avec la même URL.
const MUSIQUE: Record<string, string> = {};

// Les répliques de Grota, une prise par ligne. Elles ne passent pas par
// `jouer()` : celui-ci tire une variante et une hauteur au hasard, ce qui est
// exactement ce qu'il ne faut pas faire à une voix.
const VOIX = [1, 2, 3, 4].map((i) => `/voice/grota-${i}.ogg`);

const BOUCLES: Record<Ambiance | "mer" | "feu", string> = {
  jour: "/sfx/amb-day.ogg",
  nuit: "/sfx/amb-night.ogg",
  mer: "/sfx/amb-sea.ogg",
  feu: "/sfx/fire.ogg",
};

/** Tout ce que le son a besoin de charger — l'écran de chargement le pèse. */
export const AUDIO_URLS: readonly string[] = [
  ...Object.values(BANQUE).flat(),
  ...VOIX,
  ...Object.values(BOUCLES),
  ...Object.values(MUSIQUE),
];

const NIVEAUX: Record<Ambiance | "mer" | "feu", number> = {
  jour: 0.5,
  nuit: 0.5,
  mer: 0.22,
  feu: 0.5,
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
  clef: Ambiance;
}

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
const tampons = new Map<string, AudioBuffer>(); // url -> AudioBuffer
const boucles: Partial<Record<Ambiance | "mer" | "feu", Boucle>> = {};
let debloque = false;
let ambiance: Ambiance = "jour";
let musiqueGain: GainNode | null = null; // niveau d'ensemble : allumage, extinction, fondu
let actif: Arrangement | null = null; // l'arrangement qui joue
let debutMusique = 0; // instant du contexte correspondant à l'offset 0 du morceau
// Allumée d'entrée : elle démarrera au premier geste, en même temps que le
// reste du son — un navigateur n'autorise rien avant.
let musiqueActive = true;
let minuterie: ReturnType<typeof setTimeout> | null = null;

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
  for (const clef of Object.keys(BOUCLES) as (Ambiance | "mer" | "feu")[]) {
    const url = BOUCLES[clef];
    if (boucles[clef] || !tampons.has(url)) continue;
    const buf = tampons.get(url);
    if (!buf) continue;
    const src = context.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const g = context.createGain();
    // Le feu et la nappe de nuit démarrent muets : c'est la scène qui les ouvre.
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
  const context = ctx;
  const mg = musiqueGain;
  musiqueActive = !musiqueActive;
  if (musiqueActive) {
    // Rallumée à la main : on ne refait pas attendre dix secondes.
    demarrerMusique(0);
  } else {
    if (minuterie) clearTimeout(minuterie);
    minuterie = null;
    mg.gain.cancelScheduledValues(context.currentTime);
    mg.gain.setTargetAtTime(0, context.currentTime, MUSIQUE_SORTIE / 3);
    const sortant = actif;
    actif = null; // avant le stop : l'`ended` qui suit ne doit rien replanifier
    setTimeout(() => sortant?.src.stop(), MUSIQUE_SORTIE * 1000);
  }
  return musiqueActive;
}

/**
 * L'état voulu, indépendamment du geste qui n'a peut-être pas encore eu lieu.
 * Faux s'il n'y a aucune piste : le HUD annonçait « ♪ musique » sur un dossier
 * vide, ce qui promettait quelque chose qui n'arriverait jamais.
 */
export const musicEnabled = (): boolean => musiqueActive && Object.keys(MUSIQUE).length > 0;

// Programme un départ si tout est réuni : le son est débloqué, la musique est
// voulue, la piste est décodée, et rien ne joue ni n'est déjà programmé. Appelé
// au déblocage ET à la fin du décodage, sans savoir lequel arrivera en premier.
function demarrerMusique(attente: number): void {
  if (!debloque || !musiqueActive || actif || minuterie) return;
  const pistes = Object.values(MUSIQUE);
  // Aucune piste : `every` sur une liste vide répond vrai, et on programmerait
  // un départ toutes les trente secondes pour ne rien jouer.
  if (!pistes.length || !pistes.every((u) => tampons.has(u))) return;
  minuterie = setTimeout(() => {
    minuterie = null;
    lancerPiste();
  }, attente * 1000);
}

function lancerPiste(): void {
  jouerArrangement(ambiance, 0, 0);
  if (!actif || !ctx || !musiqueGain) return;
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
function jouerArrangement(clef: Ambiance, offset: number, fondu: number): void {
  const url = MUSIQUE[clef];
  if (!url || !ctx || !musiqueGain) return;
  const buf = tampons.get(url);
  if (!buf) return;
  const context = ctx;
  const t = context.currentTime;

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
  src.start(t, Math.max(0, Math.min(offset, buf.duration - 2)));
  src.onended = () => {
    // Ne replanifie que si c'est bien la fin du morceau : ni une extinction,
    // ni l'arrangement qu'on vient de remplacer.
    if (!musiqueActive || actif?.src !== src) return;
    actif = null;
    demarrerMusique(MUSIQUE_PAUSE);
  };

  if (actif) {
    const sortant = actif;
    sortant.gain.gain.cancelScheduledValues(t);
    sortant.gain.gain.setTargetAtTime(0, t, fondu / 3);
    setTimeout(() => sortant.src.stop(), fondu * 1000 + 300);
  }
  actif = { src, gain, clef };
  debutMusique = t - offset;
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

/** Un pas. `sol` vaut 'herbe' ou 'sable'. */
export const step = (sol: "herbe" | "sable" = "herbe"): void =>
  jouer(sol === "sable" ? "pasSable" : "pasHerbe", { gain: sol === "sable" ? 0.75 : 0.9 });

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

/** Bascule l'ambiance ; les deux nappes se croisent en fondu. */
export function setAmbience(nom: Ambiance): void {
  ambiance = nom;
  if (!ctx) return;
  const t = ctx.currentTime;

  // On reprend l'autre arrangement au même endroit du morceau, en fondu croisé.
  if (actif && actif.clef !== nom) jouerArrangement(nom, t - debutMusique, MUSIQUE_BASCULE);

  const jourB = boucles.jour;
  const nuitB = boucles.nuit;
  if (!jourB || !nuitB) return;
  jourB.gain.gain.setTargetAtTime(nom === "jour" ? NIVEAUX.jour : 0, t, 1.2);
  nuitB.gain.gain.setTargetAtTime(nom === "nuit" ? NIVEAUX.nuit : 0, t, 1.2);
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
