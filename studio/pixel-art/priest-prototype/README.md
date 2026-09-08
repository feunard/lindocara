# Prêtre · Prototype — LCPixel

Le dessin simplifié approuvé reste inchangé : cheveux et barbe sombres, manteau ivoire,
croix dorée, cuir brun et bâton à anneau doré. La [charte LCPixel](../../styles/lcpixel/STYLE.md)
verrouille proportions, contours, palette, perspective et détails autorisés.

## Diagnostic et méthode

Les anciennes clés générées répétaient presque le même appui. Certaines vues latérales
gardaient la même jambe devant pendant presque tout le cycle. L'interpolation ajoutait
des intermédiaires sans créer le transfert du poids manquant. Le correctif précédent
ne transférait que trois valeurs du Rogue : rotation et déplacement du haut du corps.

Un essai de membres découpés et pilotés par un squelette a été rejeté visuellement :
les contraintes géométriques passaient, mais le résultat ressemblait à une marionnette.
Ce code est retiré. La course utilise maintenant la même méthode raster que le Rogue V2 :

1. Partir de dessins du personnage **entier**. Le Rogue fournit des témoins de poses ;
   le canon approuvé et la charte LCPixel fournissent l'identité du Prêtre.
2. Sélectionner six poses par vue : contact, passage et suspension de chaque jambe.
   La face regarde réellement le joueur. La gauche prend la droite comme référence de
   mouvement ; haut gauche prend bas gauche, et haut droite prend bas droite.
   Les cinq peintures directionnelles validées restent les références de mouvement.
   `sources/locomotion/clips.json` décrit les sources et leur ordre temporel.
   Les trois vues reprises ont chacune six peintures dédiées, avec le bâton dans la
   main anatomique gauche. `sources/locomotion/direction-revision.json` conserve les
   prompts exacts et les références utilisées par l'outil d'image intégré.
3. `run_poses.py` applique une seule densité d'image par planche, puis translate chaque
   peinture entière dans le canvas commun. Une édition isolée retrouve la densité de
   son canvas de référence. Aucun membre n'est étiré, tourné ou collé séparément.
   La densité est calculée sur la hauteur médiane du corps des six clés sélectionnées,
   du crâne aux semelles, hors bâton : 96,5 pixels dans la pose fléchie de course.
   La largeur des cheveux n'est plus utilisée comme substitut de taille corporelle.
   Les huit canons debout restent autour de 106 pixels. Flexion des genoux et suspension
   conservent leur variation naturelle ; aucune image n'est agrandie séparément pour
   remplir une boîte. Le rapport d'auteur conserve les mesures source et la densité.
   Dans le profil gauche, l'avant-bras passe sur la ceinture : sa couleur brune faussait
   l'ancre et faisait sauter tout le personnage latéralement. La peinture entière suit
   maintenant l'excursion horizontale de tête de la droite validée, réfléchie ; le
   dessin de la tête et des membres reste solidaire, sans découpe ni déformation.
4. Le même flux optique bidirectionnel OpenCV DIS que le Rogue V2 construit les
   intermédiaires, y compris le raccord dernière clé → première clé. Les 36 images
   finales conservent exactement les six clés à la palette approuvée de 48 couleurs.
5. Les sorts et la mort utilisent des poses peintes avec le bâton dans la main gauche.
   Les nouvelles vues ont des clés dédiées ; le même outil construit les
   raccords course, saut et réception à partir des nouvelles poses.
6. Chaque atlas est rogné sur l'union du clip. Le manifest reconstruit le canvas
   256 × 256 et son ancre (128,190), à 192/2,34 pixels par tuile. `compact_atlas.py`
   déduplique uniquement les cellules RGBA strictement identiques. `frameIndices`
   adresse les cellules physiques ; les indices temporels et les sockets restent logiques.

L'interpolation accompagne les mouvements déjà dessinés ; elle ne sait pas inventer
un bon pas depuis une pose immobile. Aucun squelette, flux optique ou modèle IA ne
tourne en partie. Aucun pixel du Rogue n'entre dans le build du Prêtre.

Une boucle couvre **1,8 tuile**, soit **492,3 ms** à la vitesse normale de **3,65625 tuiles/s**.
La phase suit la distance réelle, y compris en diagonale, et survit aux changements de
direction. Le Prêtre utilise huit vues complètes, sans miroir ni décalage de phase runtime.
Huit banques raccordent départ, arrêt,
saut en course et réception, avec respectivement 6, 6, 10 et 6 images.

Le Prêtre active `groundedFootprint` dans le renderer : la petite marge dessinée devant
l'ancre se replie au sol, car un plan vertical la plaçait sous le terrain et coupait les
bottes. Le buste reste vertical. Deux triangles sont ajoutés, sans texture ni passe
supplémentaire. Les autres personnages conservent leur géométrie.

## États et sorts

Les 18 clips couvrent idle, run, start, stop, jump, jump-run, fall, land, land-run, hurt,
swim, glide, death et les cinq sorts. Huit vues dessinées conservent la main anatomique
gauche dans chaque direction. Les cinq vues avec miroirs restent disponibles pour les
personnages à équipement symétrique, comme l'Assassin V2.
Start partage l'atlas de stop en lecture inverse. Les extrémités des raccords aériens
sont identiques ; les deux dernières images de mort sont fixes.

| Sort | Libération | Récupération |
| --- | ---: | ---: |
| Trait radiant | 140 ms | 185 ms |
| Soin | 240 ms | 600 ms |
| Téléportation | 180 ms | 420 ms |
| Prière | 320 ms | 640 ms |
| Nova divine | 400 ms | 700 ms |

Les événements serveur restent l'autorité. Un socket par image suit l'orbe dessinée.
Le projectile confirmé part de cette position puis rejoint la trajectoire serveur.
Dégâts, soins, collisions et règles de déplacement n'ont pas changé.

## Reconstruire et tester

Depuis la racine avec Yarn 4 et uv ; utiliser `corepack yarn` sur cette machine Windows :

```sh
yarn priest:build
yarn priest:authoring:check
yarn priest:check
yarn assassin:check
yarn verify
```

Le rebuild ne demande ni GPU ni génération d'images. Les versions Python sont épinglées.
Le manifest porte hashes, dimensions, sockets, durées et banques. Le rapport d'auteur
séparé conserve les six clés et leurs recalages sans les charger pendant une partie.
Les textures sont partagées entre tous les Prêtres, avec un plafond de 256 Mio RGBA
pour huit vues indépendantes et une dimension maximale de 4096 pixels. La suppression
des doublons et du remplissage par direction limite le surcoût des trois vues supplémentaires.

Les anciennes planches de course et leur extraction de mouvement sont retirées.
Leur provenance reste dans `sources/simplified/generation.json` et Git. Les nouvelles
peintures et prompts exacts sont dans `sources/locomotion/` ; `sources/handedness/`
contient les nouveaux canons et actions qui remplacent les images retournées.
Les essais rejetés sont ignorés, sans dépendance du build ni fallback runtime.

Changer le canon reste une opération d'auteur : `author_prompts.py` prépare les prompts
LCPixel pour les vues canoniques et actions. Après revue d'un nouveau dessin, revoir la
sélection et le recalage des clés, puis les empreintes LCPixel. Une génération d'image n'est
pas reproductible à l'octet ; la reconstruction depuis les sources acceptées l'est.

`uv run studio/pixel-art/priest-prototype/prepare_handedness.py` reconstruit les quatre
nouveaux canons depuis leur turnaround et nettoie uniquement les lignes de grille dans
les marges vides d'une source de cast. Refaire ensuite `uv run studio/styles/lcpixel/build_reference.py`
si les références ont intentionnellement changé, puis le build et les contrôles ci-dessus.
La charte interdit maintenant les miroirs qui inversent un équipement asymétrique.

## Preview

```sh
yarn priest:studio
# http://localhost:5330/studio/pixel-art/priest-prototype/
# http://localhost:5330/studio/pixel-art/priest-prototype/compare.html
yarn dev
# http://localhost:5273/?preview=priest
yarn priest:review
```

Pour examiner une seule vue avant intégration : `uv run studio/pixel-art/priest-prototype/build.py --pilot back-quarter`,
puis ouvrir l'URL de comparaison imprimée. Le clip candidat est joué à sa vraie cadence
à côté de la même orientation du Rogue. Il ne remplace aucune texture runtime du jeu.

L'atelier présente les huit vues à taille normale et agrandies : cadence, scrubber, banques,
image précédente, ancre et orbe. Les repères montrent le recalage des clés peintes ; ils
ne reconstruisent pas un squelette ni les appuis cachés. La comparaison place le Rogue V2 à côté du Prêtre,
à leurs cadences propres ou avec les phases alignées.

La preview moteur utilise le contrôleur réel : WASD, Espace (saut/planeur), 1–5 (sorts),
H (dégâts), K (mort), R (reset), T (directions), N (eau), flèches (caméra), P (pause).
`priest:review` capture huit directions, saut, cinq sorts, mort, nage, planeur et groupe
de quatre ; il contrôle 48 départs de projectile avec différents délais réseau.

La [revue visuelle](review/README.md) conserve les témoins examinés. Les contrôles
numériques ne certifient pas le naturel perçu ni l'absence de glissement des pieds. À fort
grossissement, le flux optique peut modifier des pixels de contour entre deux clés ;
les rotations, chevauchements et croisements de jambes doivent rester sous revue visuelle.
