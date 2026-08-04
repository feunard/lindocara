import type { Clip } from "@lindocara/hd2d/billboard.js";
import type { MoodConfig } from "@lindocara/hd2d/mood.js";
import type { TextureSpec } from "@lindocara/hd2d/textures.js";
import type { Zone } from "./world/zones.js";

// Tous les réglages du labo au même endroit : c'est ce fichier qu'on triture pour faire bouger
// le monde sans aller fouiller dans le reste. `hd2d/config.ts` a déjà pris RENDER/POSTFX/
// CLOUD_SHADOW/SPRITE_STRETCH — ce qui reste ici est proche du CONTENU (l'île, le héros, les
// ambiances), pas du moteur de rendu.

// Rendu plafonné : au-delà, on brûle du GPU pour rien et la vitesse de jeu ne change pas (tout
// est en delta-time). Mettre 0 pour laisser filer.
export const TARGET_FPS = 60;

export interface WorldSettings {
  size: number;
  seed: number;
  /** Hauteur d'un palier d'élévation, en unités monde (1 tuile = 1 unité). */
  levelHeight: number;
  /** L'eau affleure l'herbe du palier 0 : juste assez dessous pour que le sol se dessine
   *  par-dessus, pas assez pour créer une marche. Une case est de l'herbe de palier 0 ou de
   *  palier 1, jamais un entre-deux. */
  waterLevel: number;
  /** 0 = aucune marche ne se gravit à pied : toute falaise se saute. C'est ce qui donne son rôle
   *  au saut. Mettre 1 pour remonter un palier en marchant. */
  maxStep: number;
}

export const WORLD: WorldSettings = {
  size: 72, // côté de la grille de tuiles — assez large pour quatre îles
  seed: 20260801,
  levelHeight: 0.9,
  waterLevel: -0.05,
  maxStep: 0,
};

/** Le point d'apparition du héros — sorti ici (Task 10) pour que `main.ts` ET
 *  `scripts/build-map.ts` partagent la MÊME valeur : le script en a besoin pour décider la
 *  clairière du spawn et la position du feu (`world/props.ts`, `decidePlacements`) exactement
 *  comme le fait `populate` au chargement — deux copies auraient tôt ou tard divergé. */
export const SPAWN: readonly [number, number] = [-2, 4];

/** L'île gelée. Au nord, hors de portée à pied : le couloir qui l'en sépare est de l'eau, et
 *  c'est voulu — on arrive sur la banquise essoufflé, et la musique change à ce moment-là. */
export const NORD = { x: 0, z: -26, r: 7.5 } as const;

/** La zone polaire, autour de `NORD` — voir `world/zones.ts` (Task 4 de l'île de neige). Rayon
 *  élargi de 3 unités au-delà du littoral gelé (`NORD.r`) : l'ambiance doit s'installer PENDANT la
 *  traversée à la nage, avant que le héros ne pose le pied sur la banquise, sinon le changement de
 *  nappe et le premier pas dans la neige arriveraient à la même image et l'un masquerait l'autre. */
export const ZONE_POLAIRE: Zone = {
  nom: "polaire",
  centre: [NORD.x, NORD.z],
  rayon: NORD.r + 3,
  // Le thème généré par Task 5 (`public/music/neige.ogg`, déclaré sous cette même clef dans
  // `MUSIQUE`, `core/audio.ts`). `applyZone` (`main.ts`) le fait obéir à `setZoneMusic`.
  musique: "neige",
  // Le souffle polaire généré par Task 6 (`public/sfx/amb-polaire.ogg`, déclaré sous cette même
  // clef dans `BOUCLES`, `core/audio.ts`). `applyZone` (`main.ts`) le fait obéir à `setAmbience`,
  // qui éteint désormais les deux nappes du sud ET joue celle-ci à l'arrivée sur la banquise.
  nappe: "polaire",
  // L'eau glacée consomme le souffle deux fois plus vite (Task 7, la glace fine).
  souffle: 2,
};

/** La zone par défaut : tout le reste du monde. Rayon infini et EN DERNIER dans `ZONES` — c'est le
 *  filet qui capte tout point qu'aucune zone plus spécifique n'a pris (voir `zoneAt`,
 *  `world/zones.ts`). */
export const ZONE_LARGE: Zone = {
  nom: "large",
  centre: [0, 0],
  rayon: Number.POSITIVE_INFINITY,
  musique: null,
  nappe: "jour",
  souffle: 1,
};

/** L'ordre EST la priorité (voir `zoneAt`) : la polaire d'abord, la zone par défaut en dernier. */
export const ZONES: readonly Zone[] = [ZONE_POLAIRE, ZONE_LARGE];

/** Les trois seuils de la glace fine (Task 7) — voir `@lindocara/engine/hd2d/thin-ice.js` pour la mécanique pure et
 *  `world/hero.ts` pour le câblage. La charge s'accumule PAR CASE, tant que le héros y reste :
 *  traverser la couronne perpendiculairement (`GLACE_FINE_LARGEUR` dans `island.ts`, 0.9 unité) à
 *  pleine vitesse (`HERO.speed`) prend ~0.2s sur une même case, largement sous `seuilCraquement` —
 *  un franchissement perpendiculaire reste donc sûr par construction. C'est s'attarder dessus
 *  (longer le rivage gelé au lieu de le traverser, faire des allers-retours) qui charge une case.
 *  - `seuilCraquement` (0.5s) : le temps posé avant que le premier craquement prévienne — assez
 *    court pour qu'on l'entende avant d'avoir eu le temps de dériver sur deux ou trois cases.
 *  - `seuilRupture` (1.4s) : encore 0.9s de charge après le craquement avant que la case cède —
 *    le temps d'un demi-tour et de deux pas, pas un piège qui referme instantanément.
 *  - `regel` (6s) : assez long pour laisser le temps de s'éloigner puis de revenir par un autre
 *    chemin sans la retrouver déjà regelée, assez court pour qu'un aller-retour dans la même
 *    exploration la retrouve intacte plutôt qu'un trou définitif (voir le spec, section « La
 *    glace fine » : « dans un labo, réessayer est tout ce qu'on y fait »).
 */
export const GLACE_FINE = { seuilCraquement: 0.5, seuilRupture: 1.4, regel: 6 } as const;

/** Chute de neige (Task 8 de l'île de neige, `main.ts`) — un `createPetalFall` recoloré/redensifié
 *  (voir `packages/hd2d/src/particles.ts`, `PetalFallOptions.color`/`count`/`size`). */
export interface ChuteNeigeSettings {
  /** Rayon autour du héros que couvrent les flocons — pas toute la zone : un champ centré sur la
   *  caméra coûte ce qu'il doit, en couvrir toute l'île serait invisible (hors du cadre la
   *  plupart du temps) et cher pour rien. */
  radius: number;
  /** Hauteur de la colonne de chute, en unités monde au-dessus du point suivi. */
  height: number;
  count: number;
  size: number;
  color: number;
}
export const NEIGE_CHUTE: ChuteNeigeSettings = {
  radius: 15,
  height: 9,
  // Vérifié à l'écran (voir le rapport de la task) : à 320/0.11 les flocons se distinguaient à
  // peine de jour, blancs sur la neige elle-même — relevés à 480/0.16 pour rester lisibles sans
  // désigner tout le ciel comme neigeux (`color` reste un blanc à peine teinté de bleu, pas un
  // blanc pur, pour garder un soupçon de contraste sur le sol clair).
  count: 480,
  size: 0.16,
  color: 0xdceeff,
};

/** Souffle visible du héros (Task 8) — de petites bouffées à hauteur de tête, un lot recyclé en
 *  rond dans `world/hero.ts` (même motif que les ondes de nage). Nommé "haleine" et non "souffle"
 *  pour ne pas se confondre avec `HeroInput.souffleTaux`/`Hero.breath`, qui désignent la RÉSERVE
 *  d'air en apnée (Task 7) — un concept sans rapport, malgré le mot français partagé. */
export interface HaleineSettings {
  /** Secondes entre deux bouffées quand on ne marche pas (à l'arrêt, en l'air, en glissant sur la
   *  glace) : quelqu'un qui respire ne s'arrête pas de respirer. En marchant/courant, c'est la
   *  cadence des PAS elle-même qui déclenche chaque bouffée (`hero.ts`, `PAS_TOUS_LES`) — ce
   *  minuteur-ci ne tourne alors jamais assez longtemps pour se déclencher lui-même. */
  reposInterval: number;
  /** Durée de vie d'une bouffée, secondes. */
  vie: number;
  /** Taille du lot recyclé — jamais d'allocation en cours de partie. */
  count: number;
  /** Hauteur monde d'une bouffée. */
  taille: number;
  /** Décalage vertical au-dessus des pieds, approximant la hauteur de tête. */
  hauteurTete: number;
  /** Décalage horizontal dans le sens où le héros regarde — la bouffée sort devant le visage. */
  avant: number;
  /** Vitesse d'ascension, unités par seconde. */
  montee: number;
  /** Facteur d'expansion en fin de vie (0 = taille d'origine à la fin, 1 = taille doublée). */
  expansion: number;
  /** Opacité au moment de l'émission ; décroît ensuite linéairement jusqu'à 0. */
  opaciteInitiale: number;
}
export const HALEINE: HaleineSettings = {
  reposInterval: 2.2,
  vie: 0.9,
  count: 5,
  // Vérifié à l'écran (voir le rapport de la task) : à 0.4/1.55/0.75 la bouffée se distinguait à
  // peine du sprite du héros — relevée en taille et en opacité, et rehaussée pour sortir de la
  // hauteur du HAUT de la tête (`HERO.size · (1 − HERO.foot)` ≈ 1.82), pas de la poitrine.
  taille: 0.55,
  hauteurTete: 1.8,
  avant: 0.22,
  montee: 0.5,
  expansion: 1.4,
  opaciteInitiale: 0.88,
};

/** Traces de pas dans la neige (Task 8) — des décalques posés à plat, un lot recyclé en rond dans
 *  `world/hero.ts` (même motif que les ondes de nage). Ne se posent que sur la matière "neige"
 *  (`hero.ts` teste `TerrainMaterial` au moment du pas) : sur la glace, glisser n'est pas marcher,
 *  et une trace sur la glace n'aurait de toute façon aucun sens. */
export interface TracesSettings {
  /** Taille du lot recyclé — jamais d'allocation en cours de partie. */
  count: number;
  /** Durée de vie d'une trace, secondes, avant de s'effacer. */
  vie: number;
  /** Taille monde d'une trace. */
  taille: number;
  /** Décalage latéral, en unités monde, qui alterne pied gauche/pied droit d'un pas à l'autre. */
  ecart: number;
  /** Opacité au moment de la pose ; décroît ensuite linéairement jusqu'à 0. */
  opaciteInitiale: number;
}
export const TRACES: TracesSettings = {
  count: 24,
  vie: 4.5,
  taille: 0.4,
  ecart: 0.14,
  opaciteInitiale: 0.7,
};

/** La vapeur de la source chaude (Task 10 de l'île de neige, `world/props.ts`) — un lot recyclé en
 *  rond, même motif que le souffle du héros (`HALEINE` ci-dessus) : une émission CONTINUE plutôt
 *  qu'au rythme des pas, puisque la source fume en permanence, pas seulement quand on marche.
 *  Contrairement à la flaque de lumière de la source (qui suit `MOODS.*.fire` et s'éteint de jour,
 *  voir `main.ts`, `pushMood`), la vapeur reste visible à toute heure — de la buée ne disparaît pas
 *  au lever du jour. Le spec suggère qu'elle monte plus vite quand il fait plus froid dans la
 *  fiction ; en pratique ce couplage n'est pas modélisé, `montee` est un réglage unique jugé à
 *  l'écran. */
export interface VapeurSourceSettings {
  /** Taille du lot recyclé — jamais d'allocation en cours de partie. */
  count: number;
  /** Durée de vie d'une bouffée, secondes. */
  vie: number;
  /** Taille monde d'une bouffée. */
  taille: number;
  /** Rayon du disque, autour de la source, où une bouffée peut naître. */
  rayon: number;
  /** Vitesse d'ascension, unités par seconde. */
  montee: number;
  /** Facteur d'expansion en fin de vie (0 = taille d'origine à la fin, 1 = taille doublée). */
  expansion: number;
  /** Opacité au moment de l'émission ; décroît ensuite linéairement jusqu'à 0. */
  opaciteInitiale: number;
  /** Secondes entre deux bouffées : une émission continue, pas cadencée sur un événement (pas de
   *  pas, pas de souffle) — la source fume tout le temps. */
  emission: number;
}
export const VAPEUR_SOURCE: VapeurSourceSettings = {
  count: 14,
  vie: 2.6,
  taille: 0.6,
  rayon: 0.35,
  montee: 0.55,
  expansion: 1.6,
  opaciteInitiale: 0.5,
  emission: 0.2,
};

/** Aurore boréale (Task 9 de l'île de neige) — le canal `MoodConfig.aurora` (`@lindocara/hd2d`)
 *  vaut 0 dans les deux ambiances du labo (`MOODS` plus bas) : c'est `main.ts` qui l'allume, en
 *  zone polaire ET de nuit seulement, avec son propre fondu d'entrée/sortie de zone — indépendant
 *  du fondu jour/nuit de `MOOD_FADE`, qui ne connaît pas la position du héros. */
export const AURORE = {
  /** Secondes pour atteindre pleine intensité en entrant dans la zone polaire de nuit (et pour
   *  s'éteindre en la quittant ou au lever du jour). */
  fade: 2.2,
};

/** Pulse de blizzard (Task 9) — le canal `MoodConfig.fogPulse` vaut 0 dans les deux ambiances du
 *  labo, pour la même raison qu'`AURORE` ci-dessus. La rafale elle-même réutilise la mécanique de
 *  bourrasque des props (`world/props.ts`, `windPhase`) : sa phase se déduit de la position du
 *  héros, pour qu'elle TRAVERSE la zone au lieu de resserrer le brouillard partout à la fois. */
export const BLIZZARD = {
  /** Secondes pour que l'effet s'installe/se retire en entrant/sortant de la zone polaire. */
  fade: 1.5,
  /** Période d'une rafale complète, secondes. */
  periode: 9,
  /** Fraction MAXIMALE dont la portée du brouillard (`fog.far`) se resserre au pic d'une rafale. */
  intensite: 0.4,
  /** Seuil (0..1) que le signal de rafale doit franchir EN CROISSANT pour compter comme le début
   *  d'une bourrasque (voir `main.ts`, déclenchement de `gust()`) — pas chaque image où le signal
   *  reste fort. Le milieu de l'oscillation : assez tôt pour que le son précède le pic visuel plutôt
   *  que de le suivre. */
  seuilSon: 0.5,
  /** Intervalle plancher (s) entre deux déclenchements du son de rafale — filet de sécurité si le
   *  franchissement du seuil pouvait se redéclencher rapidement ; à `periode` = 9 s le
   *  franchissement naturel n'arrive qu'une fois par cycle, donc ce plancher ne joue normalement
   *  aucun rôle, il ne fait que garantir qu'un futur réglage de `periode` plus courte ne puisse pas
   *  mitrailler le son. */
  intervalleSonMin: 3,
};

export interface CameraSettings {
  fov: number;
  distance: number;
  pitch: number;
  height: number;
  follow: number;
  zoom: { min: number; max: number };
  yawRange: number;
  yawReturn: number;
  fogFar: number;
  lookAhead: number;
  lookAheadLag: number;
  shake: { land: number; decay: number; frequency: number };
}

export const CAMERA: CameraSettings = {
  fov: 22, // FOV court = quasi-orthographique = look maquette
  distance: 40,
  pitch: 38 * (Math.PI / 180), // angle au-dessus de l'horizon
  height: 1.2, // point visé au-dessus des pieds du héros
  follow: 6, // vitesse de rattrapage de la caméra
  zoom: { min: 16, max: 78 },
  yawRange: 20 * (Math.PI / 180), // débattement de la rotation, de part et d'autre
  yawReturn: 6, // vitesse de retour à 0 quand on relâche
  // Le brouillard suit le zoom, sinon il noierait toute l'île dès qu'on recule. Mais le suivre
  // À L'IDENTIQUE (exposant 1 des deux côtés) rend le dézoom parfaitement neutre : on verrait la
  // même image, en plus petit. Le plan PROCHE reste donc proportionnel — le héros garde
  // exactement sa netteté à tous les zooms — pendant que le plan LOINTAIN grandit moins vite. La
  // bande de brouillard se resserre à mesure qu'on recule : l'île se dissout par les bords, et la
  // maquette gagne son lointain.
  fogFar: 0.38, // 1 = brouillard neutre au zoom, 0 = brouillard figé en absolu
  // La caméra devance légèrement le héros dans sa direction de course : elle respire au lieu de
  // le coller.
  lookAhead: 1.4, // unités monde à pleine vitesse
  lookAheadLag: 2.5, // vitesse à laquelle ce décalage se met en place
  // Secousse à la réception d'un saut et aux explosions.
  shake: { land: 0.09, decay: 9, frequency: 34 },
};

export interface HeroSettings {
  speed: number;
  /** Une friction et un plafond de vitesse par matière (Task 3 de l'île de neige) — l'entrée
   *  ACCÉLÈRE, la matière FREINE, et c'est la même équation pour l'herbe, la neige et la glace.
   *  Ordre qui fait le jeu : `glace ≪ herbe < neige`. L'herbe est réglée pour rester indiscernable
   *  de l'ancien modèle instantané (voir `@lindocara/engine/hd2d/locomotion.js`) ; la neige freine plus ET plafonne
   *  plus bas — on y peine des deux façons à la fois ; la glace freine à peine — on garde son élan
   *  et un virage dérape au lieu de pivoter sec. Indexé par `TerrainMaterial`, mais seules ces
   *  trois matières changent le déplacement : `sable` retombe sur `herbe`, `glace-fine` retombe
   *  sur `glace` via `frictionPour`/`vitesseMaxPour` (locomotion.ts). */
  friction: { herbe: number; neige: number; glace: number };
  /** Multiplicateur de `speed` par matière, au-dessus de la friction — c'est lui qui fait
   *  PLAFONNER plus bas dans la neige, pas seulement freiner plus fort pour l'atteindre. */
  vitesseSol: { herbe: number; neige: number; glace: number };
  /** Empreinte au sol, la même pour le relief et pour les props. */
  radius: number;
  /** Décalage du centre vers le FOND (-Z). Le sprite est un plan vertical : son corps se dessine
   *  vers le haut de l'écran, donc vers le fond. Une empreinte centrée sur ses pieds paraissait
   *  posée devant lui, et le laissait chevaucher les murs situés derrière. Portée totale : 0.45
   *  vers le nord, 0.15 vers le sud, 0.30 sur les côtés (0.15 + 0.30 doit rester sous la
   *  demi-case, sinon on mord les voisines). */
  offset: number;
  frame: { cols: number; rows: number };
  anims: {
    idle: Clip;
    run: Clip;
    /** La feuille ne contient pas de saut : on fige une pose de course. */
    air: { row: number; frame: number };
    /** La feuille porte quatre attaques (lignes 2 à 5), une par diagonale, plus deux de dos.
     *  Seule celle-ci est de profil comme `idle` et `run` : le `setFlip` du billboard couvre donc
     *  l'autre sens, comme pour la course. Les trois premières frames arment le coup, la lame ne
     *  part qu'à `strike`. */
    attack: Clip & { strike: number };
  };
  /** Apex = speed² / (2·gravity) = 1.35 unité : un palier (0.9) avec de la marge, jamais deux.
   *  Gravité forte pour garder le saut nerveux (~0.6 s en l'air). */
  jump: { speed: number; gravity: number; coyote: number };
  /** Nage : on avance moins vite, on ne saute pas, et le souffle est compté. */
  swim: {
    speed: number;
    breath: number;
    /** Enfoncement sous la surface — le plan d'eau masque le sprite. */
    depth: number;
    /** Fraction de palier qu'on peut escalader depuis l'eau. */
    climb: number;
  };
  /** Hauteur monde d'une frame de 192px. */
  size: number;
  /** Bas du sprite (ombre peinte comprise) mesuré à 135 px sur 192 : position des pieds dans la
   *  frame, en partant du bas (0..1). */
  foot: number;
}

export const HERO: HeroSettings = {
  speed: 4.2,
  // Réglés et vérifiés dans `packages/engine/test/hd2d/hero-friction.test.ts` — voir `@lindocara/engine/hd2d/locomotion.js` pour la
  // formule et le rapport de la Task 3 pour le détail des calculs.
  //  - herbe (80) : assez haute pour que 2 images d'entrée suffisent à dépasser 90 % de la
  //    vitesse de pointe, et 2 images de relâchement à retomber sous 10 % — c'est la définition
  //    opérationnelle d'« indiscernable de l'ancien modèle instantané ».
  //  - neige (130) : encore plus haute que l'herbe — on peine à ACCÉLÉRER — et son `vitesseSol`
  //    plafonne aussi plus bas — on peine aussi à ATTEINDRE sa vitesse de pointe. Les deux jouent
  //    ensemble, pas l'un à la place de l'autre.
  //  - glace (0.35) : quasi nulle. `exp(-0.35 · 1) ≈ 0.70` : une seconde après avoir relâché les
  //    touches, on glisse encore aux deux tiers de sa vitesse — largement de quoi déraper en
  //    tournant et ne jamais s'arrêter net.
  friction: { herbe: 80, neige: 130, glace: 0.35 },
  // Multiplicateur de `speed`, PAR-DESSUS la friction : sur l'herbe on atteint `speed` pile, mais
  // sur la neige l'équilibre plafonne à 55 % de `speed` — pas seulement plus lentement à
  // l'atteindre. La glace ne réduit pas le plafond : seule sa friction quasi nulle la distingue.
  vitesseSol: { herbe: 1, neige: 0.55, glace: 1 },
  radius: 0.3,
  offset: 0.15,
  frame: { cols: 6, rows: 8 },
  anims: {
    idle: { row: 0, frames: 6, fps: 7 },
    run: { row: 1, frames: 6, fps: 12 },
    air: { row: 1, frame: 1 },
    attack: { row: 2, frames: 6, fps: 15, strike: 3 },
  },
  jump: { speed: 9, gravity: 30, coyote: 0.12 },
  swim: { speed: 0.45, breath: 11, depth: 0.5, climb: 0.5 },
  size: 2.6,
  foot: 0.3,
};

export interface GrotaSettings {
  at: readonly [number, number];
  frame: { cols: number; rows: number; frames: number; fps: number };
  size: number;
  foot: number;
  radius: number;
  reach: number;
}

// Grota, le panda, arrive à la Task 12 — mais c'est du réglage, il vit avec les autres dès
// maintenant. Il vit sur le mamelon de la PETITE ÎLE du sud (`ILES[2]` dans `island.ts`) — celle
// qu'on n'atteint qu'à la nage. Un ermite qu'il faut aller chercher vaut mieux qu'un ermite sur
// le chemin.
export const GROTA: GrotaSettings = {
  // Au centre du mamelon, pas sur son bord : un sprite au ras de l'arête déborderait dans le vide.
  at: [2.2, 24.5],
  // Feuille Panda_Idle : 10 frames de 256 px. Mesuré frame par frame, le corps occupe 94 px de
  // haut et son bas est TOUJOURS à 172 — c'est le ballant du repos, il ne décolle pas. Les pieds
  // sont donc à (256 - 172) / 256.
  frame: { cols: 10, rows: 1, frames: 10, fps: 8 },
  size: 3.4, // hauteur monde d'une frame : donne un panda de 1,25 unité
  foot: (256 - 172) / 256,
  radius: 0.34, // on ne lui marche pas dessus
  reach: 2.6, // distance à laquelle on peut lui parler
};

export interface SnowNpcSettings {
  at: readonly [number, number];
  /** Largeur/hauteur du sprite : contrairement à la feuille de Grota (une frame parmi
   *  plusieurs sur un pack Tiny Swords), c'est un sprite GÉNÉRÉ à une seule pose (Task 12 de
   *  l'île de neige, voir `world/snow-npc.ts`) — pas d'animation à jouer, donc pas de
   *  `frame`/`Clip` comme `GrotaSettings`, seulement l'aspect de l'image traitée. */
  aspect: number;
  size: number;
  foot: number;
  radius: number;
  reach: number;
}

// Nanuq, l'habitant de la banquise (Task 12 de l'île de neige) : même machinerie que Grota —
// il ne bouge pas, il ne se bat pas, il se tourne vers qui l'approche, et `F` ouvre LE MÊME
// bandeau (`world/snow-npc.ts` réutilise `Dialog`/`sayLine`, ce n'est pas un second système).
// Posé sur la neige de l'île du nord, au sud-ouest du lac gelé — assez près du débarcadère de la
// source chaude (`sourceX/sourceZ = NORD.x - 2, NORD.z + 5`, `world/props.ts`, à 2,5 unités d'ici)
// pour qu'on le croise vite après la traversée à la nage, mais hors de sa clairière réservée
// (rayon 2). À 4,6 unités du centre du lac (`NORD`, rayon `LAC_R` 2,5 + couronne de glace fine
// 0,9, voir `island.ts`) — large marge sur la glace fine — et à plus de dix du monticule de saut
// (`NORD.x + 4.5, NORD.z - 3.5`). La position n'est pas déduite à l'aveugle : le semis des
// sapins/stalagmites de la Task 11 est tiré au hasard, donc choisie en interrogeant
// `window.lab.colliders.all` à l'écran (le rapport de la task documente la méthode) pour retenir
// une case à plus de 1,5 unité de tout collider existant et entièrement entourée de terre.
export const NANUQ: SnowNpcSettings = {
  at: [-3.5, -23],
  // Sprite généré (Task 12) : `apps/lab/public/tex/habitant.png`, 100x127, traité par
  // `scripts/sprite.py` (détourage/recadrage/densité, 10 couleurs opaques — même palette que
  // `sapin-neige.png`/`stalagmite.png`, la Task 11 avait déjà établi cette densité comme la
  // bonne pour l'île du nord). Provenance et jugement des variantes dans le rapport de la task.
  aspect: 100 / 127,
  // 127 px / 2.65 unité ≈ 48 px/unité — la même densité de référence que `sapin-neige.png`
  // (142 px / 2.9 unité ≈ 49) et `stalagmite.png` (Task 11) : un personnage généré à côté
  // d'accessoires générés doit tomber sur la même échelle qu'eux, pas seulement sur celle de
  // Grota (un asset de pack, pas comparable directement).
  size: 2.65,
  // Marge de recadrage de `scripts/sprite.py` (2 px par défaut) sur une image de 127 px de
  // haut : les pieds touchent quasiment le bas du cadre, contrairement à Grota (une frame de
  // feuille avec du vide peint au-dessus de la tête).
  foot: 0.02,
  radius: 0.32, // on ne lui marche pas dessus, comme Grota (0.34) — stature comparable
  reach: 2.6, // même portée de parole que Grota : une seule convention pour tout le labo
};

export interface WaterSettings {
  /** 0.12 fait de la mer un miroir : à cette échelle le lobe spéculaire du soleil couvre le
   *  cadre entier et l'écran vire au blanc laiteux — une nappe, pas des reflets. Il faut une
   *  surface franchement rugueuse pour que la lumière se casse en éclats au lieu de s'étaler. */
  roughness: number;
  /** Un sommet toutes les deux unités : le dégradé de profondeur s'étale sur sept cases, il n'a
   *  pas besoin de plus. */
  segment: number;
  /** Distance en cases sur laquelle l'eau passe de la teinte de haut-fond à celle du large. */
  depthRange: number;
}

export const WATER: WaterSettings = {
  roughness: 0.46,
  segment: 2,
  depthRange: 7,
};

export const MOOD_FADE = 2.2; // secondes de transition

export const MOODS: Record<"day" | "night", MoodConfig> = {
  day: {
    exposure: 1.0,
    sky: { top: "#3d8fd0", horizon: "#a8dced", glow: "#fff4d2", glowStrength: 0.5, stars: 0 },
    // Pas de couleur ici : le brouillard prend celle de l'horizon du ciel. Deux teintes voisines
    // mais distinctes dessinaient une ligne franche là où la mer lointaine rencontre la voûte.
    fog: { near: 34, far: 86 },
    sun: { color: "#fff2d0", intensity: 2.6, position: [-18, 22, 12] },
    // Contre-jour rasant, pris du côté OPPOSÉ au soleil. Les normales des sprites sont bombées à
    // gauche et à droite : une lumière latérale n'allume donc qu'une de leurs deux arêtes, et
    // c'est exactement le liseré cherché.
    rim: { color: "#cfe6ff", intensity: 0.85, position: [17, 12, -8] },
    hemi: { sky: "#bfe6ff", ground: "#6b7a4a", intensity: 1.15 },
    fire: 1.1,
    clouds: 0.34, // profondeur de l'ombre des nuages
    // Volontairement SOMBRES et saturées. En clair, la mer part au blanc : c'est un plan
    // horizontal, il prend le soleil de plein fouet, et ACES désature tout ce qui monte vers les
    // hautes lumières. Un turquoise pâle finissait en nappe grise ; le même turquoise deux tons
    // plus bas garde sa teinte une fois éclairé.
    water: { shallow: "#1eab99", deep: "#08365c", sparkle: 1.0 },
    motes: 0.5, // pollen en suspension
    fireflies: 0,
    bloom: { strength: 0.38, threshold: 0.78 },
    grade: { saturation: 1.14, lift: 0.0 },
    // Aurore et pulse de blizzard (Task 9 de l'île de neige) : deux phénomènes de la banquise, à 0
    // dans les DEUX ambiances du labo — jour comme nuit ne changent pas d'un pixel. C'est
    // `main.ts` qui les allume, en zone polaire seulement (voir `AURORE`/`BLIZZARD`,
    // `applyAurora`/le pulse du brouillard) sans passer par une troisième paire jour/nuit.
    aurora: 0,
    fogPulse: 0,
  },
  // Nuit « à la Minecraft » : la lumière globale est crevée, et ce qui éclaire vraiment, c'est le
  // foyer. Loin de lui, c'est presque noir.
  //
  // C'est exactement le modèle de Minecraft, sans avoir à le simuler : la clarté d'un bloc y vaut
  // le max entre la lumière du ciel — au plus bas la nuit — et celle des sources posées, qui
  // décroît avec la distance. Ici la somme des deux fait la même chose : une lune juste assez
  // forte pour que les silhouettes et les ombres portées existent encore, et un feu dont la
  // décroissance en 1/d² creuse le noir dès qu'on s'en écarte de quelques pas.
  night: {
    // Sous-exposer est plus juste que de baisser chaque lumière une par une : c'est le levier qui
    // fait vraiment « nuit », le reste ne fait que la teinter.
    exposure: 0.72,
    sky: { top: "#02040c", horizon: "#080e1e", glow: "#8ea6ff", glowStrength: 0.22, stars: 1 },
    // Resserré : au-delà, il n'y a de toute façon plus rien à voir. Le lointain se referme sur le
    // noir au lieu de garder un halo bleu qui trahirait un brouillard éclairé par personne.
    fog: { near: 24, far: 62 },
    // Clair de lune réduit à ce qu'il doit être : de quoi lire une silhouette et porter une
    // ombre, pas de quoi éclairer une clairière. Même quadrant que le soleil : une lune venue du
    // nord jetterait les ombres vers la caméra, et toute la scène partirait de travers. Trop bas
    // (0.34), l'île disparaissait purement et simplement. 0.62 laisse deviner les silhouettes
    // sans jamais éclairer quoi que ce soit — c'est le minimum pour que le noir raconte encore un
    // paysage.
    sun: { color: "#8aa6f5", intensity: 0.62, position: [-15, 21, 10] },
    // Le contre-jour aussi : à 0.5 il détourait chaque sprite d'un liseré bleu, partout, y
    // compris au fond du noir — plus rien n'était sombre.
    rim: { color: "#6c88ee", intensity: 0.12, position: [16, 11, -9] },
    hemi: { sky: "#0e1730", ground: "#04060d", intensity: 0.55 },
    // Compense la chute de l'ambiance : la flaque du foyer doit rester au même niveau qu'avant,
    // c'est tout le reste qui descend autour d'elle.
    fire: 13,
    clouds: 0.1,
    water: { shallow: "#062430", deep: "#01060f", sparkle: 0.5 },
    motes: 0,
    fireflies: 1,
    bloom: { strength: 0.78, threshold: 0.38 },
    // Aucun lift : relever les noirs, c'est précisément ce qu'il ne faut pas faire ici — c'est ce
    // qui empêchait la nuit d'être noire.
    grade: { saturation: 1.0, lift: 0.0 },
    // Voir le commentaire du même champ dans `day` : 0 ici aussi, la nuit du sud n'a pas d'aurore.
    aurora: 0,
    fogPulse: 0,
  },
};

// L'azimut du soleil oscille lentement : les ombres balaient l'île, et c'est la démonstration la
// plus directe que l'éclairage est calculé, pas peint. Le débattement reste dans le quadrant
// d'origine — de l'autre côté, les ombres partiraient vers la caméra et la scène entière
// basculerait.
export const SUN_DRIFT = { amplitude: 22 * (Math.PI / 180), period: 96 };

// --- textures ---------------------------------------------------------------------------------
// `hd2d` ne connaît aucune URL de contenu, seulement la politique de filtrage (voir
// `textures.ts`, `textureFiltering`) : c'est ici, au labo, que vit le catalogue. Les quatre
// tilesets et l'écume sont des atlas — échantillonnés par sous-rectangles, sans mipmaps (voir
// `TextureSpec.atlas`) ; le reste sont des feuilles de sprites, filtrées normalement.
export const TEXTURE_URLS: readonly TextureSpec[] = [
  { url: "/tex/tileset-lvl0.png", atlas: true },
  { url: "/tex/tileset-lvl1.png", atlas: true },
  { url: "/tex/tileset-lvl2.png", atlas: true },
  { url: "/tex/tileset-sand.png", atlas: true },
  // Surfaces générées (Task 2 de l'île de neige) sur la géométrie Tiny Swords d'origine — voir
  // `scripts/compose-tileset.py`. `atlas: true` est impératif comme pour les autres tilesets :
  // avec des mipmaps, les niveaux inférieurs mélangent les tuiles voisines et font baver les
  // bordures (voir `docs/hd2d-rendering.md`).
  { url: "/tex/tileset-neige.png", atlas: true },
  { url: "/tex/tileset-glace.png", atlas: true },
  { url: "/tex/water.png" },
  { url: "/tex/foam.png", atlas: true },
  { url: "/tex/warrior.png" },
  { url: "/tex/splash.png" },
  // --- props, troupeau, décor (Task 12) ---------------------------------------------------------
  { url: "/tex/tree.png" },
  { url: "/tex/rocks.png" },
  { url: "/tex/fire.png" },
  { url: "/tex/campfire-base.png" },
  { url: "/tex/deco-01.png" },
  { url: "/tex/deco-02.png" },
  { url: "/tex/deco-03.png" },
  { url: "/tex/deco-04.png" },
  { url: "/tex/deco-05.png" },
  { url: "/tex/deco-06.png" },
  { url: "/tex/bush-1.png" },
  { url: "/tex/bush-2.png" },
  { url: "/tex/bush-3.png" },
  { url: "/tex/bush-4.png" },
  { url: "/tex/sheep.png" },
  { url: "/tex/explosion.png" },
  // --- props enneigés (Task 11 de l'île de neige) : générés, une seule frame chacun -------------
  { url: "/tex/sapin-neige.png" },
  { url: "/tex/stalagmite.png" },
  // --- Grota, le coffre, la maison, l'intérieur ---------------------------------------------------
  { url: "/tex/panda.png" },
  // Nanuq, l'habitant de la banquise (Task 12 de l'île de neige) : sprite généré, une seule
  // frame comme sapin-neige/stalagmite ci-dessus — voir `world/snow-npc.ts`.
  { url: "/tex/habitant.png" },
  { url: "/tex/chest-closed.png" },
  { url: "/tex/chest-open.png" },
  { url: "/tex/house-front.png" },
  { url: "/tex/house-side.png" },
  { url: "/tex/house-roof.png" },
  { url: "/tex/interior-floor.png" },
  { url: "/tex/interior-wall.png" },
  { url: "/tex/rug.png" },
  { url: "/tex/hearth.png" },
  { url: "/tex/cupboard.png" },
  { url: "/tex/bed.png" },
  { url: "/tex/table.png" },
  { url: "/tex/sakura.png" },
];
