# Reboot HD-2D — design d'ensemble

Date : 2026-08-02
Statut : validé en brainstorming, north star des cinq chantiers

## Objectif

lindocara abandonne son rendu 2D vue de dessus (PixiJS) pour le **HD-2D** : des sprites pixel art
Tiny Swords plantés dans une scène 3D éclairée — la recette d'Octopath Traveler. Le rendu, le modèle
de carte, la collision, les verbes de déplacement et le langage visuel de toute l'application sont
repris. Ce qui a de la valeur aujourd'hui — les classes, les talents, l'interpréteur d'événements, la
persistance, l'admission, les rooms, le multijoueur en ligne — survit intact.

La preuve de faisabilité existe : `~/git/poc-hd-2d`, ~4 800 lignes de JS sur Three.js, tenu à 60 fps,
documenté en détail dans son `README.md` (qui recense aussi une quinzaine de pièges déjà rencontrés
— le lire avant de toucher au rendu).

## Décisions de cadrage

| Sujet | Décision |
| --- | --- |
| Migration | **Aucune.** Zéro carte en production, bac à sable. Le contenu se ré-authore dans le nouvel éditeur. |
| Modèle de terrain | **Heightfield.** Une case porte un niveau et une matière ; parois, bordures, écume et collision sont dérivées, jamais authorées. |
| Unité de simulation | **Le pixel** (`TILE_SIZE = 64`), inchangé. Le rendu divise par 64 pour ses unités monde. |
| Forme d'une carte | Grille bornée `cols × rows`, mer autour. Les entrées/sorties restent des événements typés. |
| Axe vertical | Sur le fil et dans l'état autoritatif dès le départ ; **aucune règle de combat ne le lit.** Le combat reste planaire. |
| Orientation des sprites | **Profil seul**, miroité selon le signe de la direction. L'orientation est une donnée dans `hd2d` pour qu'un passage ultérieur à des feuilles 4-directions ne touche qu'une sélection de texture. |
| Arbre de composants | **Un seul**, sombre. `ui/tiny-swords/` est supprimé, la barrière CSS avec. |
| État du jeu pendant la bascule | **Éteint** entre S2 et S3. Le labo porte la preuve pendant ce temps. |

## Architecture cible

### Le graphe de packages

```
@lindocara/engine    pur — règles, modèle de carte, simulation, collision, protocole, i18n
@lindocara/hd2d      pur Three.js — pipeline, billboards, mailleur de terrain, mood/ciel/
                     nuages, particules, loader pesé en octets
@lindocara/renderer  l'adaptateur : SceneSample / WorldInfo → scène hd2d
@lindocara/ui        le seul arbre de composants, sombre
@lindocara/server    inchangé dans sa forme, suit engine
@lindocara/client    shell React, HUD, store, réseau
@lindocara/editor    outils de création — sa scène EST hd2d
@lindocara/catalog   assets
@lindocara/testing   fixtures
apps/lab             le témoin
apps/main            le jeu
```

Direction des dépendances : `engine ← {server, renderer, lab}`, `hd2d ← {renderer, lab}`,
`{renderer, ui} ← {client, editor}`. `hd2d` ne dépend de rien du dépôt. Le graphe reste acyclique.

### `@lindocara/hd2d` ne connaît pas lindocara

C'est la frontière qui porte tout le reste. `hd2d` reçoit une **description** de terrain, des
billboards, des lumières, une ambiance et une caméra. Il ne sait pas ce qu'est un joueur, un monstre,
un butin, un snapshot ou une room. Cette ignorance est ce qui rend le même package utilisable par le
jeu, par l'éditeur et par le labo — et ce qui empêche le rendu de redevenir un monolithe de 5 000
lignes qui sait tout.

Ce que `hd2d` expose, en gros : le pipeline de rendu (cible MSAA dédiée à la géométrie, tilt-shift
séparable piloté par la position verticale à l'écran, bloom, étalonnage **après** `OutputPass`,
vignette), les billboards (plans strictement verticaux, pivotés sur les pieds, étirés pour compenser
la plongée, normales bombées, calque de contre-jour, appoint de lumière calculé à la main pour les
sources placées derrière), le mailleur de terrain (blocs, parois, autotiling par masque de voisinage,
mer à profondeur, écume glissée sous les cases de terre), le mixeur d'ambiances jour/nuit, la
couverture nuageuse qui multiplie l'albédo, les particules, et le loader pesé en octets.

### `apps/lab` — le témoin

Le labo **ne dépend que de `engine` + `hd2d`**. Pas de React, pas de serveur, pas de réseau. Trois
conséquences, et elles sont toutes les trois recherchées :

1. il prouve la simulation *et* le rendu hors ligne, en une page ;
2. il reste honnête — il consomme exactement le même code que le jeu, donc une expérimentation qui y
   marche marche dans le jeu. Une copie figée du PoC dériverait en deux semaines et ne témoignerait
   plus de rien ;
3. il permet à S2 d'exister avant S3 : le nouveau modèle de terrain et la nouvelle collision se
   voient à l'écran pendant que le jeu attend son renderer.

Il porte aussi le **harnais de charge** (voir Risques).

## Le modèle de carte

```ts
interface MapData {
  cols: number
  rows: number
  /** Un niveau par case. -1 = eau, 0..N = paliers. */
  levels: LevelGrid
  /** Une matière par case ; dérivée du niveau par défaut. */
  materials: MaterialGrid
  elements: MapElement[]   // placement au quart de case, conservé
  spawn: { col: number; row: number }
}
```

L'encodage des deux grilles (codec run-length, tampon typé, borne d'octets) est une décision de S2,
pas de ce document : il dépend de la taille de carte visée et du plafond de corps JSON. La contrainte
qui vaut dès maintenant est celle de `parseTileLayer` aujourd'hui — le décodeur ne lève jamais, il
refuse.

**Tout le reste est dérivé, jamais authoré** : parois de falaise, bordures autotilées, écume du
rivage, mer, et la collision. L'auteur dit « ici c'est élévation 2 », le moteur s'occupe du reste.
Le nombre de paliers n'est plus plafonné à trois.

Disparaissent : `tileset.ts`, `tile-layer-codec.ts`, `tile-brush.ts`, `autotile.ts`,
`map-migrate.ts`, `tilemap-codec.ts`, toute la logique d'escaliers, et la palette de terrain de
l'éditeur.

Survivent intacts : les événements authorés et leur interpréteur, l'état d'aventure (interrupteurs,
variables, sélection de page), le graphe d'aventures, les quêtes, la persistance héros fencée par
epoch, l'admission, `PartyRoom` / `WorldRoom` / `PresenceRoom`.

## Collision et simulation

Le modèle du PoC porté dans `engine`, donc partagé serveur ↔ prédiction. La règle qui fait que
`step()` existe en un seul exemplaire vaut identiquement ici : deux copies synchronisées à la main
rendent la prédiction impossible à réparer.

- `maxStep = 0` — rien ne se gravit à pied. Le saut franchit **un** palier et jamais deux ; les
  descentes sont libres, avec gravité ; coyote time de 120 ms.
- L'empreinte du héros est **un disque décalé vers le fond** (un billboard dessine son corps vers le
  haut de l'écran, donc vers le fond ; une empreinte centrée sur ses pieds le laisse chevaucher les
  murs derrière lui). Le relief est testé sur le disque, pas sur son centre. Le rayon doit rester
  **sous la demi-case** : au-delà, le disque mord en permanence les cases voisines.
- Les props portent des **colliders circulaires** en grille spatiale — rayon au tronc, pas au
  feuillage.
- Chaque axe est testé séparément : on glisse le long des obstacles au lieu de coller.
- **La règle qui sauve** : un déplacement est accepté s'il est valide **ou** s'il n'aggrave pas un
  chevauchement déjà présent. Sans elle, atterrir au pied d'une falaise — disque mordant encore la
  case du dessus — cimente le personnage sur place, y compris pour s'en éloigner. Le sol sous le
  centre n'est jamais assoupli, sinon on gravirait une falaise en la poussant.
- La nage : vitesse réduite, saut désactivé, souffle compté, noyade → retour au point d'entrée. On se
  hisse sur une rive de plain-pied, jamais sur une falaise.

### Sur le fil

La position gagne une **hauteur**, une vitesse verticale et un **état de locomotion**
(`ground` / `air` / `swim`). `step()` le prend en argument comme il prend déjà `LifeState`, et **la
file de commandes est vidée à chaque transition de locomotion** — même règle que la vie, pour la même
raison : un lot de commandes rejoué à cheval sur deux états est une désynchronisation que rien dans
le protocole ne signale. La prédiction doit épingler chaque vitesse de locomotion contre le serveur,
comme `prediction.test.ts` le fait déjà pour la vitesse de fantôme.

Le combat reste **strictement planaire**. Aucune portée, aucune capsule, aucun projectile, aucun
chiffre de classe ou de talent n'est touché. Un combat en 3D reste possible plus tard : la hauteur
est déjà sur le fil, donc rien ne sera à re-migrer.

## Le langage visuel

Un seul arbre de composants. Noir, texte blanc. Le bandeau de dialogue du PoC est le modèle : pas de
cadre, un noir dont les deux bords se fondent dans la scène, texte blanc, centré dans la moitié basse
de l'écran. `ui/tiny-swords/` est supprimé, et la barrière CSS
`:not(:where([data-slot], .editor-root *))` disparaît avec lui — elle n'existait que pour arbitrer
deux palettes qui ne coexistent plus.

## Les chantiers

| | Livrable | État du jeu |
| --- | --- | --- |
| **S1** | `@lindocara/hd2d` extrait du PoC en TypeScript + `apps/lab` qui reproduit le PoC à l'identique + le harnais de charge | intact, encore sur Pixi |
| **S2** | Nouveau modèle de carte + collision/saut/nage dans `engine`, serveur autoritatif, prédiction ; **prouvé dans le labo** | éteint |
| **S3** | `renderer` réécrit en adaptateur hd2d ; les 5 228 lignes de Pixi retirées | rallumé, en HD-2D |
| **S5** | La scène de l'éditeur sur hd2d — WYSIWYG réel avec le jeu | — |
| **S4** | Le langage visuel sombre, parallélisable avec S3 (React, pas de WebGL) | — |

Chaque chantier a son spec et son plan.

## Risques et ce qu'on en fait

- **Les 60 fps sous charge réelle.** Le PoC affiche un héros, une trentaine de props et une île. Le
  jeu affiche quatre joueurs, des monstres, des projectiles, des effets de combat, du butin et une
  carte entière. C'est le vrai inconnu du chantier, et un budget GPU découvert insuffisant en S3
  coûterait très cher. → **un harnais de charge dans le labo dès S1**, qui peuple la scène au niveau
  du jeu et mesure au compteur (méthode de mesure GPU dans le `CLAUDE.md` du PoC).
- **Tester un renderer WebGL.** jsdom ne fait pas tourner Three.js. → le mailleur de terrain, les math
  d'ambiance, la sélection d'autotile, la collision et le loader sont testables purement et le
  seront ; le reste se vérifie en captures Playwright, comme le PoC le fait déjà. La collision et la
  simulation, elles, restent testées comme aujourd'hui — c'est de l'`engine` pur.
- **Le pack SFX (371 Mo) hors dépôt et son texte de licence absent.** → même discipline que le PoC :
  `sync-assets`, seuls les fichiers utilisés commités, et la question de licence tranchée avant toute
  diffusion publique.
- **Les sprites de profil.** Une attaque vers le nord se lira mal. Décision assumée ; l'orientation
  est une donnée dans `hd2d` dès S1 pour qu'un passage à des feuilles 4-directions — générables via
  `~/git/pixel-art-model` — ne touche qu'une sélection de texture.
- **La taille du bundle.** Three.js pèse plus que PixiJS. Mesuré en S1, arbitré si le chiffre surprend.

## Hors périmètre

- Le combat en 3D (capsules et projectiles à extension verticale). Décision (C) : possible plus tard,
  la hauteur est déjà sur le fil.
- Les feuilles de sprites 4-directions. Note pour plus tard, pas un engagement.
- L'observabilité par room, restée en suspens depuis la migration Alepha. Inchangée par ce chantier.
