# Revue du 8 septembre 2026 — huit vues du Prêtre LCPixel

Cette revue remplace celle de la course articulée, rejetée par l'utilisateur pour son
effet de marionnette. Les tests de longueur des os ne validaient pas le mouvement perçu.
Le squelette et les pièces peintes sont supprimés du pipeline.

La course part de six dessins complets par vue. L'interpolation bidirectionnelle est celle
du Rogue V2. Cette version remplace la face de course oblique, les diagonales arrière à
grandes enjambées et les miroirs qui inversaient la main du bâton. Huit vues indépendantes
couvrent maintenant les déplacements et les actions, avec le bâton dans la main gauche.

La correction de `back-quarter` reprend maintenant les poses de la haut gauche acceptée,
converties vers la droite, avec une correction peinte de la main du bâton. La précédente
inclinaison exagérée et les enjambées trop ouvertes sont remplacées. Un premier essai
plus serré avait figé les jambes ; il a été écarté avant intégration. La source finale
conserve les six flexions distinctes de la référence. L'ordre des clés est décalé d'un
demi-cycle à l'édition pour conserver l'alternance anatomique ; aucun miroir runtime.
Le recalage entier évite toujours la confusion ceinture/botte. La tête suit l'excursion
horizontale de la haut gauche, avec moins de deux pixels natifs d'écart sur un cycle.

![Prêtre, Rôdeuse, Assassin V2 et Gardien runique](lineup.png)

## Témoins examinés

Les captures utilisent Chrome, le renderer HD-2D, sa caméra normale et la vitesse de
3,65625 tuiles/s. La revue visuelle porte sur les captures successives, les clés peintes
et leurs intermédiaires. Enregistrer une vidéo ne constitue pas à lui seul un contrôle
perceptuel.

- [Course dans les huit directions](run-review.png) : transfert entre jambes, buste,
  bras mesurés, tête solidaire du corps et bâton. Les jambes ne sont plus des morceaux
  tournés séparément. La vue de face utilise six nouvelles peintures réellement frontales.
- [Saut et réception](jump-review.png) : départ depuis la phase de course courante,
  montée, apex, descente et retour à la course.
- [Comparaison avec le Rogue V2](comparison.png), à taille du jeu puis agrandie.
- [Repères des clés peintes](studio-trajectories.png). Les points servent à examiner
  le recalage ; ils ne représentent pas des os ou des pieds cachés calculés.
- [Enregistrement à vitesse normale](all-directions.webm), pour rejouer les changements
  de direction dans le moteur.
- [Deux diagonales hautes, course et saut](rear-engine.png), à l'échelle du moteur,
  et [36 images de chaque boucle](rear-36-frames.png), pour examiner les intermédiaires.
- [Virages successifs](turn-detail.png) : captures à 1/60 seconde et contrôle de la
  phase sur huit changements de direction. Elle progresse de la distance parcourue
  divisée par 1,8, sans remise à zéro ; les virages peuvent ralentir le déplacement.

`yarn priest:review` recrée les séquences complètes sous
`artifacts/priest-prototype/runtime-review/` : 12 captures de course, 10 de saut,
8 par sort et 10 de mort par direction, ainsi que dégâts, nage, planeur et groupe de quatre.
Les cinq sorts et la mort ont aussi été examinés sur des planches de captures successives.

## Contrôles

- `yarn verify` complet : lint, typage, tests de tous les
  packages, migrations, catalogues/cartes/musiques, validateurs Prêtre et Assassin,
  build puis démarrage de l'artefact compilé.
- Six tests d'auteur : clés peintes conservées exactement, fermeture interpolée du
  cycle, deux contacts distincts, densité de la face, stabilité du repère de cou après
  réduction de palette, échelle commune des sorts, reconstruction exacte de l'atlas
  dédupliqué et absence du saut de tête causé par le mauvais recalage arrière.
- Validateur : 18 états/huit directions, 32 raccords de boucle, extrémités des banques
  de transitions, pose de mort finale stable, sources et atlas hashés, palette et alpha.
- 48 départs de projectile : Trait radiant et Soin, huit directions et délais simulés
  de 0/100/200 ms. Le premier point affiché rejoint l'orbe à moins de 0,000001 tuile.
- Atelier : 18 clips chargés au début, milieu et terme, avec overlays, sans exception.
- Le build repart des sources figées, sans génération IA ni texture du Rogue.
- Les 3 808 images des sept autres directions sont identiques à celles du commit
  `4cb0698f`, après reconstruction de chaque cellule dans son canvas natif. Les sorts,
  idle, dégâts et mort de la haut droite sont également inchangés. Seuls la course et
  ses dérivés aériens/aquatiques/de transition ont été recalculés. Les textures du Rogue
  V2 sont inchangées ; son validateur de compatibilité V1 et les tests du renderer passent.
- Textures partagées : **233,9 Mio RGBA**, dimension maximale 4096 pixels. Aucun calcul
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
