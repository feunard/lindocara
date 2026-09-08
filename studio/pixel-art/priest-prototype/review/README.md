# Revue du 8 septembre 2026 — huit vues du Prêtre LCPixel

Cette révision part de la validation explicite du créateur : haut, bas, bas droite,
bas gauche et droite sont les références de mouvement. Gauche est reprise depuis droite,
haut gauche depuis bas gauche, et haut droite depuis bas droite. Les trois anciennes
planches refusées sont retirées. La précédente revue des diagonales arrière est remplacée.

Six dessins complets par vue, puis 36 intermédiaires précalculés avec le même flux
bidirectionnel que le Rogue V2. Le bâton reste dans la main anatomique gauche ; aucun
miroir runtime, aucun membre découpé. Les [paires de référence](paired-keys.png) montrent
les nouvelles poses à côté de leurs références validées, à densité native.

La largeur des cheveux ne règle plus la taille du personnage : les six poses sélectionnées
partagent une densité calculée sur la hauteur médiane du corps, hors bâton. Les canons
debout restent à environ 106 pixels. Les courses fléchies mesurent entre **95,5 et 97,3
pixels** de hauteur médiane selon la vue, contre des diagonales arrière allant auparavant
jusqu'à 118 pixels depuis l'ancre. La flexion et la suspension ne sont pas normalisées
image par image. Le profil gauche suit l'excursion horizontale de la droite : la couleur
de la main sur le bâton contaminait le repère de ceinture et décalait le corps d'environ
dix pixels. La correction translate toute la peinture, sans recoller la tête.

![Prêtre, Rôdeuse, Assassin V2 et Gardien runique](lineup.png)

## Témoins examinés

Les captures utilisent Chrome, le renderer HD-2D, sa caméra normale et la vitesse de
3,65625 tuiles/s. La revue visuelle porte sur les captures successives, les clés peintes
et leurs intermédiaires. Enregistrer une vidéo ne constitue pas à lui seul un contrôle
perceptuel.

- [Course dans les huit directions](run-review.png) : transfert entre jambes, buste,
  bras mesurés, tête solidaire du corps et bâton. Les jambes ne sont plus des morceaux
  tournés séparément. Les cinq directions validées gardent leurs dessins sources.
- [Saut et réception](jump-review.png) : départ depuis la phase de course courante,
  montée, apex, descente et retour à la course.
- [Comparaison avec le Rogue V2](comparison.png), à taille du jeu puis agrandie.
- [Repères des clés peintes](studio-trajectories.png). Les points servent à examiner
  le recalage ; ils ne représentent pas des os ou des pieds cachés calculés.
- [Enregistrement à vitesse normale](all-directions.webm), pour rejouer les changements
  de direction dans le moteur.
- Les 36 images des trois boucles : [gauche](left-36-frames.png),
  [haut gauche](upper-left-36-frames.png), [haut droite](upper-right-36-frames.png).
- [Virages successifs](turn-detail.png) : captures à 1/60 seconde et contrôle de la
  phase sur seize changements de direction. Elle progresse de la distance parcourue
  divisée par 1,8, sans remise à zéro ; les virages peuvent ralentir le déplacement.

`yarn priest:review` recrée les séquences complètes sous
`artifacts/priest-prototype/runtime-review/` : 12 captures de course, 10 de saut,
8 par sort et 10 de mort par direction, ainsi que dégâts, nage, planeur et groupe de quatre.
Les cinq sorts et la mort sont inchangés dans cette révision ; les nouvelles captures
et le contrôle des sockets vérifient leur intégration avec les locomotions recalculées.

## Contrôles

- `yarn verify` complet : lint, typage, tests de tous les
  packages, migrations, catalogues/cartes/musiques, validateurs Prêtre et Assassin,
  build puis démarrage de l'artefact compilé.
- Sept tests d'auteur : clés peintes conservées exactement, fermeture interpolée du
  cycle, deux contacts distincts, densité de la face, stabilité du repère de cou après
  réduction de palette, échelle commune des sorts, reconstruction exacte de l'atlas
  dédupliqué, tailles directionnelles, foulées compactes et absence du saut latéral
  causé par la confusion entre main et ceinture dans le profil gauche.
- Validateur : 18 états/huit directions, 32 raccords de boucle, extrémités des banques
  de transitions, pose de mort finale stable, sources et atlas hashés, palette et alpha.
  La CI contrôle aussi la taille corporelle dans les cellules runtime reconstruites.
- 48 départs de projectile : Trait radiant et Soin, huit directions et délais simulés
  de 0/100/200 ms. Le premier point affiché rejoint l'orbe à moins de 0,000001 tuile.
- Atelier : 18 clips chargés au début, milieu et terme, avec overlays, sans exception.
- Le build repart des sources figées, sans génération IA ni texture du Rogue.
- Les **1 728 images** d'idle, dégâts, cinq sorts et mort sont identiques à celles du
  commit `9e4b6c07`, après reconstruction de chaque cellule dans son canvas natif.
  Les cinq planches de mouvement validées sont identiques à l'octet. Seuls la course et
  ses dérivés aériens/aquatiques/de transition ont été recalculés. Les textures du Rogue
  V2 sont inchangées ; son validateur de compatibilité V1 et les tests du renderer passent.
- Textures partagées : **224,5 Mio RGBA**, dimension maximale 4096 pixels. Aucun calcul
  de squelette, génération IA ou interpolation d'images pendant la partie.
- Charte LCPixel : 28 références verrouillées. Les nouvelles orientations du Prêtre
  respectent la main gauche ; les références du Rogue V2, Gardien runique et Rôdeuse
  sont inchangées. La charte interdit les miroirs qui changent une arme de main.

## Limites de la validation

Le flux optique peut assouplir des contours pendant un croisement ou une occlusion,
particulièrement à fort grossissement. Il ne corrige pas une mauvaise pose source.
Les indicateurs d'images et les tests ne prouvent ni une biomécanique exacte ni une
perfection perceptuelle. La comparaison animée à taille normale reste nécessaire lors
de chaque changement de poses, de vitesse ou de caméra.
