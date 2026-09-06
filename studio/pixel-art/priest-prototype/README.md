# Prêtre · Prototype — LCPixel

Le Prêtre est un personnage raster dessiné dans le style **LCPixel**, avec la méthode
d'interpolation hors ligne de l'Assassin V2. Cette révision simplifie son costume à partir
du dessin fourni le 6 septembre à 18:47 : cheveux et barbe sombres, manteau court ivoire,
croix dorée, cuir brun, bâton de bois avec anneau et orbe dorée. Le corps reste lisible
à la caméra du jeu, à côté de la Rôdeuse, de l'Assassin V2 et du Gardien runique.

## Style et sources

La [charte LCPixel](../../styles/lcpixel/STYLE.md) fixe proportions, dimensions natives,
contours, ombres, détails, visages, armes, vue, palette et interdictions. Son profil JSON
est injecté par `studio.py sprite`, en génération simple comme en lot. Les références
sont contrôlées par empreinte avant la génération. `--character priest-prototype`
ajoute l'identité et sa référence ; `--no-theme` reste une dérogation explicite de recherche.

Les seules sources actives sont dans `sources/simplified/`. Les dessins acceptés, les
prompts réellement employés et leur provenance sont conservés dans ce dossier.
`generation.json` décrit aussi les corrections de main et les témoins de pose de la
révision précédente. Les anciens fichiers de dessin ont été retirés ; ils restent
récupérables dans Git, sans fallback dans le moteur ou dans le constructeur d'atlas.

L'outil d'image intégré a créé les dessins. Le générateur local du projet produit lui aussi
des images fixes ; aucun des deux ne fournit un contrat temporel d'animation. Un nom de
style ou un prompt ne garantit pas à lui seul la cohérence. Les vues canoniques, la palette
figée et la revue des clips restent nécessaires.

## Ce qui causait les défauts

- La tête était effacée puis recollée par rectangle, avec une partie du col. La jonction
  pouvait dessiner une barre sous le menton.
- Le recalage ramenait le bassin à une position imposée et séparait les échelles du
  torse et des jambes. Des poses déjà trop droites perdaient encore leur mouvement.
- La détection de couleur confondait parfois le bas de la chevelure avec le cou :
  séparer la barbe après réduction de palette déplaçait ce repère jusqu'aux yeux.
- Le sommet du bâton levé modifiait la fenêtre de recherche du crâne.
- Utiliser le bassin de l'idle pour la phase aérienne d'une foulée faisait descendre
  certaines vues latérales/arrière au lieu de les laisser monter.

## Construction du mouvement

1. Séparer les dessins par action et vue. La course comporte huit clés par vue, dans
   l'ordre contact, appui, passage, envol, puis le deuxième pas. Les deux gestes levés
   du trois-quarts avant ont été dessinés séparément pour corriger la main du bâton.
2. Retirer le fond magenta et reconstruire un canvas fixe de 256 × 256. Une densité
   uniforme est calibrée pour chaque source ; aucune normalisation indépendante du
   torse, des jambes ou de la boîte englobante de chaque frame.
3. Garder la peinture complète tête–cou–corps. Déduire le repère du cou de la proportion
   du crâne, sans le faire dépendre de la connexion des couleurs de la barbe.
   Les appuis se calent sur le sol ; l'envol monte depuis les appuis voisins de la course.
4. Utiliser le flux bidirectionnel OpenCV DIS partagé avec l'Assassin V2. Les repères du
   cou, du buste, du bassin et de l'orbe guident les grands déplacements. Les pixels sont
   déplacés avant leur mélange, puis remis dans la palette fixe de 48 couleurs.
5. Compléter les poses trop raides par un mouvement de buste extrait de la course
   approuvée de l'Assassin V2 : rotation et déplacement des épaules relativement au bassin.
   Seules ces trajectoires numériques sont transférées, jamais son dessin. Une
   transformation continue de la peinture supérieure conserve les longueurs et la jonction
   du cou, s'atténue aux hanches et laisse les pieds en place. Le bâton suit son bras.
   Tout est précalculé ; `reference-motion.json` est une source figée.
6. Calculer les raccords dernière/première frame et les banques de transition, puis rogner
   chaque clip une seule fois autour de son union. Reconstruire l'ancre (128,190) et conserver
   192/2,34 pixels par tuile dans toutes les directions et actions.

Le runtime conserve la cadence liée à la distance : une boucle de course couvre 1,4 tuile
à 3,65625 tuiles/s. Un changement de direction conserve la phase ; les vues miroir transfèrent
un demi-cycle. Huit banques raccordent course, impulsion, réception, départ et arrêt.
Aucune IA, aucun calcul de flux optique et aucune cible de rendu par acteur pendant la partie.

## États et sorts

Les 18 clips couvrent les états réellement utilisés : idle, run, start, stop, jump,
jump-run, fall, land, land-run, hurt, swim, glide, death et les cinq sorts.
Cinq vues dessinées couvrent les huit directions du moteur. Start lit la banque de stop
à l'envers et partage sa texture. Les fins d'impulsion, d'apex et de réception sont identiques
aux débuts des états suivants ; la mort termine sur un dessin immobile.

| Sort | Déclenchement | Récupération | Clip |
| --- | ---: | ---: | --- |
| Trait radiant | 140 ms | 185 ms | radiant-bolt |
| Soin | 240 ms | 600 ms | mend |
| Téléportation | 180 ms | 420 ms | blink |
| Prière | 320 ms | 640 ms | prayer |
| Nova divine | 400 ms | 700 ms | divine-nova |

Les événements serveur et `combatActionFrameIndex` restent l'autorité pour anticipation,
déclenchement et récupération. L'orbe **dorée** fournit le point d'émission par frame.
Le renderer projette ce point avec la même caméra, le même pivot et la même élévation
que le personnage. Le projectile confirmé part de l'arme puis rejoint la trajectoire
serveur. Les dégâts, soins, collisions et créations de projectiles restent côté serveur.

## Régénérer et vérifier

Depuis la racine, avec Yarn 4 et uv :

```sh
yarn style:check
yarn priest:authoring:check
yarn priest:build
yarn priest:check
yarn assassin:check
yarn verify
```

Sur cette machine Windows, utiliser `corepack yarn` si Yarn n'est pas installé directement.
La reconstruction complète des atlases ne demande ni GPU, ni clé, ni génération IA :
les PNG sources acceptés suffisent. NumPy, OpenCV et Pillow sont épinglés dans les scripts.
Les hashes de sources et de textures permettent de contrôler la reproductibilité.

Changer le dessin est une opération d'auteur distincte : relire LCPixel, fournir la
planche de cohérence et la vue canonique, enregistrer le prompt et revoir le résultat.
Les futurs modèles de prompt se préparent avec
`python studio/pixel-art/priest-prototype/author_prompts.py` dans le dossier ignoré
`artifacts/priest-prototype/prompt-templates/`, sans écraser l'historique des dessins acceptés.
Pour une modification volontaire du canon :

```sh
uv run studio/pixel-art/priest-prototype/source_tools.py --canonical
uv run --with numpy==2.5.2 --with pillow==12.3.0 studio/pixel-art/priest-prototype/palette.py
# Revue visuelle du canon avant de renouveler les empreintes :
uv run studio/styles/lcpixel/build_reference.py
```

Ces commandes redéfinissent les références ; elles ne font pas partie du rebuild habituel.

Le validateur contrôle les 18 états, cinq lignes/huit directions, dimensions, alpha binaire,
palette, ancres, sources, boucles, banques, fins de mort, mouvements de buste et sockets
de libération. Les tests d'auteur contrôlent notamment que la palette ne déplace pas le cou
et que le mouvement du buste ne déplace pas les pieds plantés.

Les textures restent sous 4096 pixels et sous le budget de 176 Mio RGBA décodés, partagé
par tous les Prêtres. Les diagnostics et sources ne sont pas chargés comme textures en jeu.

## Voir les animations

```sh
yarn priest:studio
# http://localhost:5330/studio/pixel-art/priest-prototype/
yarn dev
# http://localhost:5273/?preview=priest
yarn priest:review
```

La preview d'atelier montre les huit vues à l'échelle du jeu et agrandies : scrubber,
cadence, vitesse, banques, image précédente, ancre, orbe et trajectoires de tête/buste/bassin/pieds.
Les marqueurs de pieds correspondent aux deux côtés de l'image et ne prétendent pas
identifier un pied anatomique pendant une occlusion.

La preview moteur utilise le vrai contrôleur et le vrai renderer. WASD : mouvement ;
Espace : saut/planeur ; 1–5 : sorts ; H : dégâts ; K : mort ; R : remise à zéro ;
T : parcours des directions ; N : eau ; flèches : caméra ; P : pause ; [ / ] : cadence.
Elle permet la comparaison avec les trois autres héros à la caméra normale.

`priest:review` utilise Playwright et Chrome installé. Il capture course, saut, cinq sorts,
mort, nage, planeur et groupe de quatre Prêtres, ainsi qu'une vidéo à vitesse normale,
dans `artifacts/priest-prototype/runtime-review/`. Il contrôle aussi 48 départs de projectiles
(2 sorts × 8 directions × délais de 0/100/200 ms). `--quick` limite la capture à la
comparaison ; `--launches` ajoute les contrôles de départ sans le parcours complet.

La [revue visuelle](review/README.md) garde les témoins examinés. Les métriques ne certifient
pas à elles seules des appuis physiquement exacts. Au fort grossissement, quelques contours
intermédiaires restent plus souples que les clés dessinées, comme avec la méthode de l'Assassin V2.
